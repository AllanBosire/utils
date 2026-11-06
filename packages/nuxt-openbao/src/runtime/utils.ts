import type { OneOf, Prettify, SmartString } from "@chiballc/types";
import { joinURL } from "ufo";
import { $fetch } from "ofetch";
import { consola } from "consola";

import { entries, execute, hasOwnProperties } from "@chiballc/utils";
import type { OpenBaoOptions } from "./types";
import { crawlVarsFromEnv, getEnvSereverURL, reconsileConfig, setEnv } from "./env";

const console = consola.withTag("kibao-utils");

export type KibaoAccess = "public" | "private";
export type Location = OneOf<
  [
    {
      app: string;
      environment: Environments;
    },
    { path: string },
  ]
>;
export type SecretFrom = {
  location: Location;
  baseURL: string;
};
export type KibaoCredentials = Prettify<OneOf<[KibaoRoleCredentials, KibaoTokenCredentials]> & SecretFrom>;
export type KibaoRequestOptions = {
  signal?: AbortSignal;
  maxResponseBytes?: number;
};
export interface KibaoRoleCredentials {
  bao: {
    role: {
      id: string;
    };
    secret: {
      id: string;
    };
  };
  /** @default 'root' */
  namespace?: string;
}
export type Environments = SmartString<"staging" | "development" | "production">;
export interface KibaoTokenCredentials {
  /** A token must begin with an attestation, then the token as a string */
  token: SmartString<`${typeof PUBLIC_TOKEN_ATTESTATION}${string}` | `${typeof PRIVATE_TOKEN_ATTESTATION}${string}`>;
  /** @default 'root' */
  namespace?: string;
}

type OpenBaoKV2Response = {
  data: {
    data: Record<string, string>;
    metadata?: unknown;
  };
};

export const KIBAO_DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;

class KibaoRequestError extends Error {
  constructor(message: string, options?: { cause: any }) {
    super(message, options);
    this.name = "KibaoRequestError";
  }
}

function responseLimit(options?: KibaoRequestOptions) {
  const limit = options?.maxResponseBytes ?? KIBAO_DEFAULT_MAX_RESPONSE_BYTES;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new KibaoRequestError("The Kibao response limit is invalid.", { cause: limit });
  }
  return limit;
}

async function cancelResponseBody(body: ReadableStream<Uint8Array> | null | undefined) {
  try {
    await body?.cancel();
  } catch {
    // Cancellation is best effort after a terminal response error.
  }
}

async function cancelResponseReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  try {
    await reader.cancel();
  } catch {
    // Cancellation is best effort after a terminal response error.
  }
}

async function readJson<T>(response: Response, options?: KibaoRequestOptions): Promise<T> {
  const limit = responseLimit(options);
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > limit) {
    await cancelResponseBody(response.body);
    throw new KibaoRequestError("The Kibao response exceeds the allowed size.");
  }
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    await cancelResponseBody(response.body);
    throw new KibaoRequestError("The Kibao response is invalid.");
  }

  if (!response.body) {
    throw new KibaoRequestError("The Kibao response is invalid.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      if (options?.signal?.aborted) {
        throw new KibaoRequestError("The Kibao request was aborted.");
      }
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        throw new KibaoRequestError("The Kibao response exceeds the allowed size.");
      }
      chunks.push(value);
    }
  } catch (error) {
    await cancelResponseReader(reader);
    if (error instanceof KibaoRequestError) throw error;
    if (options?.signal?.aborted) throw new KibaoRequestError("The Kibao request was aborted.");
    throw new KibaoRequestError("The Kibao response could not be read.");
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    await cancelResponseReader(reader);
    throw new KibaoRequestError("The Kibao response is invalid.");
  }
}

async function requestJson<T>(url: string, init: Parameters<typeof $fetch.raw>[1], options?: KibaoRequestOptions) {
  responseLimit(options);
  let response: Response;
  try {
    response = await $fetch.raw(url, {
      ...init,
      ignoreResponseError: true,
      responseType: "stream",
      retry: 0,
      signal: options?.signal,
    });
  } catch {
    if (options?.signal?.aborted) throw new KibaoRequestError("The Kibao request was aborted.");
    throw new KibaoRequestError("The Kibao request failed.");
  }
  if (!response.ok) {
    await cancelResponseBody(response.body);
    throw new KibaoRequestError("The Kibao request failed.");
  }
  return readJson<T>(response, options);
}

function variablesFrom(response: unknown) {
  if (
    !hasOwnProperties(response, ["data"] as const, {
      allowNullish: false,
    })
  ) {
    throw new KibaoRequestError("The Kibao response is invalid.");
  }

  if (
    !hasOwnProperties(response.data, ["data"] as const, {
      allowNullish: false,
    })
  ) {
    throw new KibaoRequestError("The Kibao response is invalid.");
  }
  return response.data.data as Record<string, string | number>;
}

export async function getSecrets(
  credentials: KibaoCredentials,
  access: SmartString<KibaoAccess> = "public",
  options?: KibaoRequestOptions,
) {
  const { headers } = await getKibaoHeaders(credentials, options);

  let cache: Record<string, string> | undefined = undefined;
  const vars = () => {
    if (cache) {
      return cache;
    }

    cache = crawlVarsFromEnv();
    return cache;
  };
  const app = (function () {
    return credentials.location.app || vars()[`NUXT_KIBAO_OPENBAO_${access.toUpperCase()}_LOCATION_APP`];
  })();

  const environment = (function () {
    return (
      credentials.location.environment || vars()[`NUXT_KIBAO_OPENBAO_${access.toUpperCase()}_LOCATION_ENVIRONMENT`]
    );
  })();

  const lit_path = (function () {
    return credentials.location.path || vars()[`NUXT_KIBAO_OPENBAO_${access.toUpperCase()}_LOCATION_PATH`];
  })();

  const path = lit_path ? lit_path : app && environment ? joinURL("v1", app, "data", environment, access) : null;

  if (!path) {
    throw new KibaoRequestError("The Kibao request is invalid.");
  }

  const response = await requestJson<OpenBaoKV2Response>(
    joinURL(credentials.baseURL, path),
    {
      headers,
    },
    options,
  );

  return {
    vars: variablesFrom(response),
    access,
  };
}

export interface KibaoLoginResponse {
  auth: { client_token: string };
}

export const KIBAO_DEFAULT_NAMESPACE = "root";
export async function getKibaoToken<T extends KibaoLoginResponse>(
  credentials: KibaoRoleCredentials & Pick<SecretFrom, "baseURL">,
  options?: KibaoRequestOptions,
) {
  const namespace = credentials.namespace || KIBAO_DEFAULT_NAMESPACE;
  const response = await requestJson<T>(
    joinURL(credentials.baseURL, "v1/auth/approle/login"),
    {
      body: {
        role_id: credentials.bao.role.id,
        secret_id: credentials.bao.secret.id,
      },
      headers: {
        "X-Vault-Namespace": namespace,
      },
      method: "POST",
    },
    options,
  );

  if (
    !response ||
    typeof response !== "object" ||
    !("auth" in response) ||
    !response.auth ||
    typeof response.auth !== "object" ||
    !("client_token" in response.auth) ||
    typeof response.auth.client_token !== "string"
  ) {
    throw new KibaoRequestError("The Kibao response is invalid.", { cause: response });
  }

  return {
    token: response.auth.client_token,
    namespace,
  };
}

function clearAttestation(token: KibaoTokenCredentials["token"]) {
  if (token.startsWith(PUBLIC_TOKEN_ATTESTATION)) {
    return {
      type: "public" as const,
      token: token.slice(PUBLIC_TOKEN_ATTESTATION.length),
    };
  } else if (token.startsWith(PRIVATE_TOKEN_ATTESTATION)) {
    return {
      type: "private" as const,
      token: token.slice(PRIVATE_TOKEN_ATTESTATION.length),
    };
  } else {
    console.warn(
      "The token needs an attestation to determine whether the variables are exposed on the frontend or not. i.e. start with yes_this_ok_to_be_public_{token} or is_private_access_{token} it's currently set to private by default, but it's recommended to add the attestation for better security and clarity.",
    );
    return {
      type: "private" as const,
      token,
    };
  }
}

export const PUBLIC_TOKEN_ATTESTATION = "yes_this_ok_to_be_public_";
export const PRIVATE_TOKEN_ATTESTATION = "is_private_access_";
export async function getKibaoHeaders(credentials: KibaoCredentials, options?: KibaoRequestOptions) {
  const headers = new Headers();
  if (credentials.bao?.role?.id && credentials.bao?.secret?.id) {
    // eslint-disable-next-line no-var
    var { token, namespace } = await getKibaoToken(credentials, options);
  } else if (credentials.token) {
    // eslint-disable-next-line no-var
    var { token } = clearAttestation(credentials.token);
    // eslint-disable-next-line no-var
    var namespace = credentials.namespace || KIBAO_DEFAULT_NAMESPACE;
  } else {
    throw new KibaoRequestError("The Kibao credentials are invalid.");
  }

  headers.set("X-Vault-Namespace", namespace);
  headers.set("X-Vault-Token", token);
  return { headers };
}

export async function autoEnv(access: SmartString<KibaoAccess> = "public", updateEnv = true) {
  const baoConfig = reconsileConfig(null, null);
  if (!baoConfig.server?.bao) {
    throw new Error("Could not find openbao server.bao", {
      cause: baoConfig,
    });
  }

  const baoVars = await getSecrets(
    {
      baseURL: baoConfig.server.bao,
      location: baoConfig.openbao?.[access]?.location as Location,
      bao: baoConfig.openbao?.[access]?.bao as any,
      namespace: baoConfig.openbao?.[access]?.namespace,
      token: baoConfig.openbao?.[access]?.token as any,
    },
    access,
  );

  if (updateEnv) {
    setEnv(baoVars);
  }

  return baoVars;
}

const KIBAO_RETRY_DELAY_MS = 250;
const KIBAO_ACCESS_BUDGET_MS = 4e3;
function isPermanentKibaoFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return message === "The Kibao credentials are invalid." || message === "The Kibao request is invalid.";
}
async function getSecretsWithRetry(credentials: KibaoCredentials, access: SmartString<KibaoAccess>) {
  // One budget covers both attempts, so an OpenBao that accepts connections and never answers cannot hold a caller longer.
  const options = { signal: AbortSignal.timeout(KIBAO_ACCESS_BUDGET_MS) };
  try {
    return await getSecrets(credentials, access, options);
  } catch (error) {
    if (isPermanentKibaoFailure(error) || options.signal.aborted) throw error;
    await new Promise((resolve) => setTimeout(resolve, KIBAO_RETRY_DELAY_MS));
    return getSecrets(credentials, access, options);
  }
}
export async function getAllVars(openbao: OpenBaoOptions, options?: { baseURL?: string }) {
  const accesses = Array.from(entries(openbao)).filter(([, config]) => config);
  const settled = await Promise.all(
    accesses.map(async ([access, config]) => {
      if (!config) return undefined;
      const baseURL = options?.baseURL || getEnvSereverURL() || config.baseURL;
      if (!baseURL) {
        console.fatal("We could not determine the location of you openbao instance");
        return void 0;
      }
      const { result, error } = await execute(getSecretsWithRetry({ ...config, baseURL }, access));
      if (error) {
        console.error("Failed to fetch variables for access", access, "with error", error);
        return void 0;
      }
      return [access, result.vars] as const;
    }),
  );
  const _vars: Partial<Record<keyof OpenBaoOptions, Record<string, string | number>>> = {};
  for (const entry of settled) {
    if (entry) _vars[entry[0]] = entry[1];
  }
  return _vars;
}
function hasKibaoCredentials(config: KibaoCredentials) {
  return Boolean((config.bao?.role?.id && config.bao?.secret?.id) || config.token);
}
export function isStartupComplete(openbao: OpenBaoOptions | undefined, vars: object, serverURL?: string) {
  return Object.entries(openbao || {}).every(
    ([access, config]) =>
      !config ||
      Object.hasOwn(vars, access) ||
      !(serverURL || getEnvSereverURL() || config.baseURL) ||
      !hasKibaoCredentials(config),
  );
}
/** Share the initial read; retry incomplete startup on later traffic without holding those requests. */
export function createStartupLatch<A extends unknown[]>(
  run: (...args: A) => Promise<unknown> | unknown,
  {
    retryAfterMs = 1e3,
    maxRetryAfterMs = 3e4,
    now = Date.now,
    background,
  }: {
    retryAfterMs?: number;
    maxRetryAfterMs?: number;
    now?: () => number;
    background?: (attempt: Promise<unknown>, ...args: A) => void;
  } = {},
) {
  let current: Promise<unknown> | undefined;
  let notBefore = 0;
  let failures = 0;
  return (...args: A) => {
    if (current !== void 0) return failures === 0 ? current : void 0;
    if (now() < notBefore) return void 0;
    // Defer invocation so synchronous throws follow the same recovery path as rejected reads.
    const attempt = Promise.resolve().then(() => run(...args));
    current = attempt;
    const settle = (complete: unknown) => {
      if (complete !== false) {
        failures = 0;
        return;
      }
      failures += 1;
      notBefore = now() + Math.min(maxRetryAfterMs, retryAfterMs * 2 ** (failures - 1));
      if (current === attempt) current = void 0;
    };
    const first = failures === 0;
    attempt.then(settle, () => settle(false));
    if (first) return attempt;
    background?.(
      attempt.then(void 0, () => void 0),
      ...args,
    );
    return void 0;
  };
}
