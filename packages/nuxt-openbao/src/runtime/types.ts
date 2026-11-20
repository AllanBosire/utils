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
