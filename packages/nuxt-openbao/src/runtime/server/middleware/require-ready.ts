import { createError, defineEventHandler, setResponseHeader } from "h3";
import { useRuntimeConfig } from "nitropack/runtime";
import { kibaoReadiness } from "../utils";
import type { KibaoRequireReady } from "../../types";

const ALWAYS_EXEMPT = ["/bao-proxy", "/_nuxt"];
const DEFAULT_RETRY_AFTER_SECONDS = 2;

function matches(path: string, prefix: string) {
  return path === prefix || path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`);
}

/**
 * Registered first among the middleware when `kibao.requireReady` is set. Nitro swallows errors thrown by `request`
 * hooks, so the refusal is made here, after Kibao's hook has settled and before any route runs.
 */
export default defineEventHandler((event) => {
  const option = useRuntimeConfig(event).kibao?.requireReady;
  if (!option) return;
  const { exclude = [], retryAfter = DEFAULT_RETRY_AFTER_SECONDS }: KibaoRequireReady = option === true ? {} : option;
  const path = event.path.split("?")[0] || "/";
  if ([...ALWAYS_EXEMPT, ...exclude].some((prefix) => matches(path, prefix))) return;
  if (kibaoReadiness(event) !== "none") return;
  setResponseHeader(event, "retry-after", retryAfter);
  throw createError({
    statusCode: 503,
    statusMessage: "Service Unavailable",
    message: "The service is starting up. Try again in a moment.",
    data: { code: "KIBAO_NOT_READY" },
  });
});
