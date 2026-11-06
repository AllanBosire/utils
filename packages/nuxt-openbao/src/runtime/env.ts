import { entries, keys } from "@chiballc/utils";
import { consola } from "consola";
import { defu } from "defu";
import type { KibaoConfig } from "./types";
import type { None } from "@chiballc/types";
import { env } from "std-env";

const console = consola.withTag("kibao-env");
type ModuleRuntimeOptions = Partial<KibaoConfig["kibao"]>;
type RuntimeConfigLike = Record<string, any> & {
  public?: Record<string, any>;
  kibao?: Partial<KibaoConfig["kibao"]>;
};
export function crawlVarsFromEnv(): Record<string, string> {
  const vars: Record<string, string> = {};
  if (typeof process === "undefined" || !process.env) {
    console.warn("No process object");
    return vars;
  }

  for (const key in process.env) {
    if (key.startsWith("KIBAO_")) {
      vars[`NUXT_${key}`] = process.env[key] as string;
      continue;
    }

    if (key.startsWith("OPENBAO_")) {
      vars[`NUXT_${key.replace("OPENBAO_", "KIBAO_OPENBAO_")}`] = process.env[key] as string;
      continue;
    }

    if (key.startsWith("NUXT_KIBAO_") || key.startsWith("NUXT_OPENBAO_")) {
      vars[key] = process.env[key] as string;
      continue;
    }
  }
  return vars;
}

// TODO: stack
function buildNestedObject(path: string[], value: string): any {
  if (path.length === 0) {
    return value;
  }

  const [head, ...rest] = path;

  if (!head) {
    throw new TypeError("Unexpected empty path segment in environment variable key");
  }

  return {
    [head]: buildNestedObject(rest, value),
  };
}

export function getEnvSereverURL(): string | undefined {
  if (typeof process === "undefined" || !process.env) {
    return undefined;
  }

  return (
    (
      process.env.NUXT_KIBAO_SERVER_BAO ||
      process.env.NUXT_PUBLIC_KIBAO_BAO_SERVER_URL ||
      process.env.DEFAULT_BAO_BASE_URL
    )?.trim() || undefined
  );
}

/** @see https://github.com/nitrojs/nitro/blob/v2/src/runtime/internal/utils.env.ts */
export function reconsileConfig<T extends RuntimeConfigLike>(
  options: ModuleRuntimeOptions | None,
  config: T | None,
): KibaoConfig["kibao"] {
  if (!config) {
    config = {} as any;
  }

  if (!config!.kibao) {
    config!.kibao = {} as any;
  }

  const moduleOptions = (options || {}) as ModuleRuntimeOptions;
  const publicKibao = (config?.public?.kibao || {}) as Partial<KibaoConfig["kibao"]>;

  let merged = defu(config!.kibao, {
    disabled: publicKibao.disabled ?? moduleOptions.disabled,
    serverOnly: publicKibao.serverOnly ?? moduleOptions.serverOnly,
    openbao: defu(publicKibao.openbao || {}, moduleOptions.openbao),
    vars: defu(publicKibao.vars || {}, moduleOptions.vars),
    test: publicKibao.test ?? moduleOptions.test,
    server: {
      bao: getEnvSereverURL() || publicKibao.server?.bao || moduleOptions.server?.bao,
      base: publicKibao.server?.base || moduleOptions.server?.base,
    },
  });

  const overrides = crawlVarsFromEnv();
  for (const key of keys(overrides)) {
    const value = overrides[key];
    if (!value) continue;
    if (key.startsWith("NUXT_KIBAO_")) {
      const path = key
        .replace("NUXT_KIBAO_", "")
        .split("_")
        .map((part) => part.toLowerCase());
      const obj = buildNestedObject(path, value);
      merged = defu(merged, obj);
    } else {
      console.warn(`Unknown environment variable ${key} with value ${value} is not applied to kibao configuration`);
    }
  }
  return merged as unknown as KibaoConfig["kibao"];
}

export function setEnv(kibao: { vars: Record<string, unknown> }) {
  if (typeof process === "undefined") {
    console.warn(
      "Injecting process because it does not exist, this may have been removed by a bundler - if so ignore this warning",
    );
    globalThis.process = {
      env: {},
    } as any;
  }

  if (!globalThis.process.env) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    globalThis.process.env = {};
  }

  for (const [key, val] of entries(kibao.vars)) {
    const value = typeof val === "string" ? val : JSON.stringify(val);
    process.env[key] = value;
    env[key] = value;
  }
}

export function applyRuntimeConfigEnv(vars: Record<string, string | number>, config?: RuntimeConfigLike | null) {
  if (!config || typeof config !== "object") {
    return;
  }

  for (const [key, value] of entries(vars)) {
    const paths = getRuntimeConfigPaths(key);
    for (const path of paths) {
      if (setExistingPath(config, path, value)) {
        break;
      }
    }
  }
}

function getRuntimeConfigPaths(key: string) {
  if (!key.startsWith("NUXT_")) {
    return [];
  }

  const parts = key.replace("NUXT_", "").split("_").filter(Boolean);
  const root = parts[0] === "PUBLIC" ? "public" : undefined;
  const segments = (root ? parts.slice(1) : parts).map((part) => part.toLowerCase());
  const candidates = getPathCandidates(segments);

  return candidates.map((path) => (root ? [root, ...path] : path));
}

function getPathCandidates(segments: string[]): string[][] {
  if (segments.length === 0) {
    return [];
  }

  const [first, ...rest] = segments;
  const tailCandidates = getPathCandidates(rest);
  const candidates: string[][] = tailCandidates.map((tail) => [first!, ...tail]);

  for (const tail of tailCandidates) {
    const [next, ...remaining] = tail;
    candidates.push([toCamelCase(first!, next!), ...remaining]);
  }

  candidates.push([toCamelCase(first!, ...rest)]);
  return candidates;
}

function toCamelCase(first: string, ...rest: string[]) {
  return [first, ...rest.map((part) => part.charAt(0).toUpperCase() + part.slice(1))].join("");
}

function setExistingPath(target: Record<string, any>, path: string[], value: string | number) {
  let current = target;
  for (const segment of path.slice(0, -1)) {
    if (!current || typeof current !== "object" || !(segment in current)) {
      return false;
    }
    current = current[segment];
  }

  const last = path[path.length - 1];
  if (!last || !current || typeof current !== "object" || !(last in current)) {
    return false;
  }

  try {
    current[last] = value;
    return true;
  } catch {
    return false;
  }
}
