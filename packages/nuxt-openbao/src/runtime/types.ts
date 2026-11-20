import type { Prettify, SmartString } from "@chiballc/types";
import type { KibaoAccess, KibaoCredentials } from "./utils";

export type OpenBaoOptions = Prettify<Partial<Record<SmartString<KibaoAccess>, KibaoCredentials>>>;

export interface KibaoVars {
  [key: string]: string | number;
}

export interface KibaoTestConfig {
  enabled: boolean;
  vars?: Partial<Record<KibaoAccess, KibaoVars>>;
}

/**
 * What a request can rely on, per isolate:
 * - `loaded`: the latest read succeeded;
 * - `stale`: an earlier read succeeded and a later one failed, timed out or was incomplete, so the last good values are in use;
 * - `none`: nothing has been read yet, because the startup wait timed out or failed.
 */
export type KibaoReadiness = "loaded" | "stale" | "none";

export interface KibaoRequireReady {
  /** Path prefixes that are served whatever the state, in addition to `/bao-proxy` and `/_nuxt`. */
  exclude?: string[];
  /**
   * Seconds sent in `Retry-After`.
   * @default 2
   */
  retryAfter?: number;
}

export interface KibaoConfig {
  kibao: {
    /** @default false */
    disabled?: boolean;
    /** @default false */
    serverOnly?: boolean;
    /**
     * Longest a request waits for the startup read, in milliseconds. A read that has not settled by then is dropped and
     * the next request starts a new one.
     * @default 5000
     */
    startupWaitMs?: number;
    /**
     * Answer `503` with `Retry-After` while the readiness is `none` (see `KibaoReadiness`), instead of letting the
     * request run without variables.
     * @default false
     */
    requireReady?: boolean | KibaoRequireReady;
    openbao: OpenBaoOptions;
    vars?: KibaoVars;
    test?: KibaoTestConfig;
    server?: {
      bao?: string,
      /** The server URL */
      base?: string
    }
  };
}
