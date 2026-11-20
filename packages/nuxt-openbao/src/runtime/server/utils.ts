import { useRuntimeConfig } from "nitropack/runtime";
import { applyRuntimeConfigEnv, reconsileConfig, setEnv, crawlVarsFromEnv } from "../env";
import { createStartupLatch, getAllVars, isStartupComplete } from "../utils";
import { getTestVars } from "../test";
import { entries } from "@chiballc/utils";
import type { NitroApp } from "nitropack";
import type { KibaoConfig, KibaoReadiness, KibaoVars } from "../types";
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

type KibaoVarsSource = {
  readonly data: KibaoVars;
  readonly state: KibaoReadiness;
  refresh(refreshEvent?: H3Event): Promise<boolean>;
};

/** The readiness a request can rely on, from the `event.context.vars` that Kibao injects. `none` when it is absent. */
export function kibaoReadiness(event: { context?: Record<string, any> }): KibaoReadiness {
  const state = event.context?.vars?.state;
  return state === "loaded" || state === "stale" ? state : "none";
}

function createVarsPayload(vars: KibaoVarsSource) {
  return {
    [KIBAO_INJECTED_ENV]: "true",
    get state() {
      return vars.state;
    },
    get data() {
      return { ...vars.data, [KIBAO_INJECTED_ENV]: "true" };
    },
    refresh: async (refreshEvent?: unknown) => vars.refresh(isH3Event(refreshEvent) ? refreshEvent : undefined),
  };
}

function attachCloudflareVars(event: Record<string, any>, vars: KibaoVarsSource) {
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

function resolveStartupWaitMs(value: unknown) {
  const waitMs = Number(value);
  return Number.isFinite(waitMs) && waitMs > 0 ? waitMs : undefined;
}

function callable(owner: unknown): owner is { waitUntil: (promise: Promise<unknown>) => void } {
  return !!owner && typeof owner === "object" && typeof (owner as { waitUntil?: unknown }).waitUntil === "function";
}

/**
 * Finds the runtime's `waitUntil` for the shapes Nitro hands to its hooks: an h3 event (`event.waitUntil`, Nitro's
 * `event.context.waitUntil`, `event.context.cloudflare.context`), the `{ context }` of `cloudflare:queue` and
 * `cloudflare:scheduled` (an `ExecutionContext`), and the Durable Object of `cloudflare:durable:init` (`ctx`).
 * It is bound to its owner, because Workers reject a detached `waitUntil`.
 */
function waitUntilOf(event: unknown): ((promise: Promise<unknown>) => void) | undefined {
  if (!event || typeof event !== "object") return undefined;
  const source = event as Record<string, any>;
  const owner = [source, source.context, source.context?.cloudflare?.context, source.ctx, source.state].find(callable);
  return owner ? (promise) => owner.waitUntil(promise) : undefined;
}

export async function injectVars(options: { app: NitroApp }) {
  const init = (event?: H3Event) => {
    const config = event ? useRuntimeConfig(event) : useRuntimeConfig();
    let kibao: Partial<KibaoConfig["kibao"]> = config.kibao || config.public.kibao || {};
    kibao = reconsileConfig(crawlVarsFromEnv(), config);
    if (kibao?.disabled) {
      return;
    }

    // Tracked per isolate and read live by every request, so it follows the latest read.
    let state: KibaoReadiness = "none";
    let everRead = false;
    const settleState = (complete: boolean) => {
      state = complete ? "loaded" : everRead ? "stale" : "none";
    };

    const refresh = async (refreshEvent?: H3Event) => {
      try {
        const complete = await load(refreshEvent);
        settleState(complete);
        return complete;
      } catch (error) {
        settleState(false);
        throw error;
      }
    };

    const load = async (refreshEvent?: H3Event) => {
      const refreshConfig = refreshEvent ? useRuntimeConfig(refreshEvent) : config;
      const refreshKibao = reconsileConfig(crawlVarsFromEnv(), refreshConfig);
      const test = getTestVars(refreshKibao);
      const vars = test || (await getAllVars(refreshKibao.openbao || {}, { baseURL: refreshKibao.server?.bao }));

      for (const [_, _vars] of entries(vars)) {
        if (_vars) everRead = true;
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
      get state() {
        return state;
      },
      refresh,
    };
  };

  const vars = init();
  const startupWaitMs = resolveStartupWaitMs(vars && useRuntimeConfig().kibao?.startupWaitMs);
  const ensureStartup = createStartupLatch<[event?: unknown]>(
    (event) => vars?.refresh(isH3Event(event) ? event : undefined),
    {
      ...(startupWaitMs === undefined ? {} : { waitMs: startupWaitMs }),
      // Every attempt, the first included, outlives the request that started it where the runtime allows.
      background: (attempt, event) => waitUntilOf(event)?.(attempt),
    },
  );
  if (!isCloudflareWorker()) void ensureStartup()?.catch(() => {});

  const intoContext = async (event: { context?: Record<string, any> }, origin: string) => {
    await ensureStartup(event);
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
