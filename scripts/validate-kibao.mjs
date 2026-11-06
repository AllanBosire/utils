import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

assertFile("dist/kibao/dist/module.mjs");
assertFile("dist/kibao/dist/types.d.mts");
assertFile("dist/kibao/dist/runtime/index.js");
assertFile("dist/kibao/dist/runtime/index.d.ts");
assertFile("dist/kibao/dist/package.json");

const moduleSource = readFileSync(resolve(root, "dist/kibao/dist/module.mjs"), "utf8");
assert(
  moduleSource.includes("../dist/runtime/env.js") && moduleSource.includes("../dist/runtime/utils.js"),
  "Expected Kibao module output to keep Nuxt module-builder's relative runtime imports",
);

const module = await import("@chiballc/utils/kibao");
assertType(module.default, "function", "@chiballc/utils/kibao default export");

const runtime = await import("@chiballc/utils/kibao/runtime");
assertType(runtime.default, "object", "@chiballc/utils/kibao/runtime default export");
assertType(runtime.getAllVars, "function", "@chiballc/utils/kibao/runtime getAllVars");
assertType(runtime.reconsileConfig, "function", "@chiballc/utils/kibao/runtime reconsileConfig");

const runtimeUtils = await import("@chiballc/utils/kibao/runtime/utils");
assertType(runtimeUtils.getKibaoHeaders, "function", "@chiballc/utils/kibao/runtime/utils getKibaoHeaders");

assertType(runtimeUtils.createStartupLatch, "function", "Kibao startup latch");
assertType(runtimeUtils.isStartupComplete, "function", "Kibao startup completion");

const runtimeEnv = await import("@chiballc/utils/kibao/runtime/env");
assertType(runtimeEnv.setEnv, "function", "@chiballc/utils/kibao/runtime/env setEnv");

function assertFile(path) {
  assert(existsSync(resolve(root, path)), `Missing ${path}`);
}

function assertType(value, expected, label) {
  assert(typeof value === expected, `${label} should be a ${expected}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
