import { useRuntimeConfig } from "nitropack/runtime";
import { applyRuntimeConfigEnv, reconsileConfig, setEnv, crawlVarsFromEnv } from "../env";
import { createStartupLatch, getAllVars, isStartupComplete } from "../utils";
import { getTestVars } from "../test";
import { entries } from "@chiballc/utils";
import type { NitroApp } from "nitropack";
import type { KibaoConfig, KibaoVars } from "../types";
import type { H3Event } from "h3";
import { env } from "std-env";
import type { None } from "@chiballc/types";

const KIBAO_INJECTED_ENV = "__KIBAO_INJECTED";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    interface ProcessEnv {
      __KIBAO_INJECTED?: "true" | "false";
    }
  }
}

function needsEnvInjection() {
  if (typeof process === "undefined" || !process.env) {
    return true;
  }

  return process.env[KIBAO_INJECTED_ENV] !== "true" || env[KIBAO_INJECTED_ENV] !== "true";
}

function needsVarsInjection<T extends Record<string, unknown>>(obj: T | None) {
  if (!obj) {
    return true;
  }

  if (typeof obj !== "object") {
    throw new TypeError("Expected an object for vars injection");
  }

  return !obj[KIBAO_INJECTED_ENV] || obj[KIBAO_INJECTED_ENV] !== "true";
}

function isH3Event(event: unknown): event is H3Event {
  return !!event && typeof event === "object" && "context" in event && "node" in event;
}

function isCloudflareWorker() {
  return "WebSocketPair" in globalThis;
}

function createVarsPayload(vars: { readonly data: KibaoVars; refresh(refreshEvent?: H3Event): Promise<boolean> }) {
  return {
    [KIBAO_INJECTED_ENV]: "true",
    get data() {
      return { ...vars.data, [KIBAO_INJECTED_ENV]: "true" };
    },
    refresh: async (refreshEvent?: unknown) => vars.refresh(isH3Event(refreshEvent) ? refreshEvent : undefined),
  };
}

function attachCloudflareVars(
  event: Record<string, any>,
  vars: { readonly data: KibaoVars; refresh(refreshEvent?: H3Event): Promise<boolean> },
) {
  if (event.env && typeof event.env === "object") {
    Object.assign(event.env, vars.data);
  }

  if (needsVarsInjection(event.context?.vars)) {
    if (!event.context) {
      event.context = {};
    }

    event.context.vars = createVarsPayload(vars);
  }
}

export async function injectVars(options: { app: NitroApp }) {
  const init = (event?: H3Event) => {
    const config = event ? useRuntimeConfig(event) : useRuntimeConfig();
    let kibao: Partial<KibaoConfig["kibao"]> = config.kibao || config.public.kibao || {};
    kibao = reconsileConfig(crawlVarsFromEnv(), config);
    if (kibao?.disabled) {
      return;
    }

    const refresh = async (refreshEvent?: H3Event) => {
      const refreshConfig = refreshEvent ? useRuntimeConfig(refreshEvent) : config;
      const refreshKibao = reconsileConfig(crawlVarsFromEnv(), refreshConfig);
      const test = getTestVars(refreshKibao);
      const vars = test || (await getAllVars(refreshKibao.openbao || {}, { baseURL: refreshKibao.server?.bao }));

      for (const [_, _vars] of entries(vars)) {
        kibao.vars = {
          ...(kibao.vars || {}),
          ...(_vars || {}),
        } as KibaoVars;
        setEnv({ vars: { ..._vars, [KIBAO_INJECTED_ENV]: "true" } });
        applyRuntimeConfigEnv(_vars || {}, refreshConfig);
      }
      return Boolean(test) || isStartupComplete(refreshKibao.openbao, vars, refreshKibao.server?.bao);
    };

    return {
      get data() {
        return kibao.vars || {};
      },
      refresh,
    };
  };

  const vars = init();
  const ensureStartup = createStartupLatch<[event?: H3Event]>((event) => vars?.refresh(event), {
    background: (attempt, event) => {
      const cloudflare = event?.context?.cloudflare;
      const context =
        cloudflare && typeof cloudflare === "object" && "context" in cloudflare ? cloudflare.context : undefined;
      if (typeof event?.waitUntil === "function") event.waitUntil(attempt);
      else if (
        context &&
        typeof context === "object" &&
        "waitUntil" in context &&
        typeof context.waitUntil === "function"
      )
        context.waitUntil(attempt);
    },
  });
  if (!isCloudflareWorker()) void ensureStartup()?.catch(() => {});

  const intoContext = async (event: { context?: Record<string, any> }, origin: string) => {
    await ensureStartup(isH3Event(event) ? event : undefined);
    if (needsEnvInjection()) {
      const data = vars?.data || {};
      console.info(`injecting variables into ${origin} process`);
      setEnv({ vars: { ...data, [KIBAO_INJECTED_ENV]: "true" } });
    }

    if (needsVarsInjection(event.context?.vars)) {
      if (!event.context) {
        event.context = {};
      }

      if (!event.context.vars) {
        event.context.vars = {};
      }

      if (vars?.data) {
        event.context.vars = createVarsPayload(vars);
      } else {
        console.warn("No vars data available to inject into request context", vars);
      }
    }
  };

  const intoCloudflareContext = async (event: Record<string, any>, origin: string) => {
    await intoContext(event, origin);
    if (vars?.data) {
      attachCloudflareVars(event, vars);
    }
  };

  options.app.hooks.hook("request", (event) => intoContext(event, "request"));
  options.app.hooks.hook("cloudflare:queue", (event) => intoCloudflareContext(event, "cloudflare:queue"));
  options.app.hooks.hook("cloudflare:scheduled", (event) => intoCloudflareContext(event, "cloudflare:scheduled"));
  options.app.hooks.hook("cloudflare:durable:init", (event) => intoCloudflareContext(event, "cloudflare:durable:init"));
  // TODO: add explicit tests/coverage before enabling the remaining Nitro v2 Cloudflare hooks: cloudflare:email, cloudflare:tail, cloudflare:trace.
}
