import type { KibaoConfig, KibaoTestConfig } from "./types";
import { consola } from "consola";

const console = consola.withTag("kibao");

const warning = [
  "!!! KIBAO TEST FIXTURE ACTIVE !!!",
  "OpenBao loading is bypassed: no remote credentials or variables will be requested.",
  "Reason: kibao.test.enabled=true and kibao.test.vars is configured.",
  "Injected values are synthetic and must never be used by a deployed application.",
].join(" ");

export function getTestVars(config: Partial<KibaoConfig["kibao"]>): KibaoTestConfig["vars"] | undefined {
  if (!config.test?.enabled || !config.test.vars) {
    return undefined;
  }

  console.warn(warning);
  return config.test.vars;
}
