# Kibao Exports

Kibao is delivered by the root package rather than a standalone installation. The module entry point is `@chiballc/utils/kibao`; its public runtime entry point is `@chiballc/utils/kibao/runtime`. Each snippet uses imports from its surrounding entry-point section unless it shows a deep runtime path.

## Module entry point

```ts
import Kibao from "@chiballc/utils/kibao";
```

### `default: Kibao`

The default export is the Nuxt module. Register it directly or use its package subpath string in `modules`. It resolves configuration, reads configured OpenBao groups, updates Nuxt runtime configuration, creates type templates, and installs the client and Nitro integrations unless disabled.

```ts
export default defineNuxtConfig({
  modules: ["@chiballc/utils/kibao"],
});
```

### `PublicKibaoConfig`

`PublicKibaoConfig` is the type augmentation applied to Nuxt public runtime configuration. It includes the general Kibao settings but restricts `openbao` to the public credentials group.

```ts
import type { PublicKibaoConfig } from "@chiballc/utils/kibao";

const publicConfig: PublicKibaoConfig = { kibao: useRuntimeConfig().public.kibao };
```

The module also augments Nuxt's `RuntimeConfig` with the full `KibaoConfig` shape and `PublicRuntimeConfig` with `PublicKibaoConfig`. `KibaoConfig`, `OpenBaoOptions`, `KibaoVars`, and `KibaoTestConfig` are module configuration types used by that augmentation and are made available to Nuxt through the module's generated imports.

### `KibaoConfig`

`KibaoConfig` has a `kibao` object. Its `disabled` flag stops all module setup. Its `serverOnly` flag omits the browser plugin and proxy route. `openbao` describes one or both credential groups. `vars` holds loaded values. `test` enables fixture values. `server.bao` is the OpenBao origin and `server.base` is the application server URL retained in runtime configuration.

```ts
export default defineNuxtConfig({
  kibao: {
    disabled: false,
    serverOnly: false,
    openbao: {},
    vars: { FEATURE_FLAG: "enabled" },
    server: { bao: "https://bao.example.com", base: "https://app.example.com" },
  },
});
```

Configuration types are emitted at `@chiballc/utils/kibao/runtime/types`. Nuxt and Nitro auto-imports use that entry; the module's `types.d.mts` is Nuxt module metadata.

### `OpenBaoOptions`

`OpenBaoOptions` is a partial record of `public` and `private` access levels to `KibaoCredentials`. It permits configuring either access level independently.

```ts
const openbao: OpenBaoOptions = {
  public: {
    baseURL: "https://bao.example.com",
    location: { path: "v1/app/data/public" },
    token: "yes_this_ok_to_be_public_token",
  },
};
```

### `KibaoVars`

`KibaoVars` is a string-to-string record for loaded variable values.

```ts
const vars: KibaoVars = { NUXT_PUBLIC_API_ORIGIN: "https://api.example.com" };
```

### `KibaoTestConfig`

`KibaoTestConfig` has a required `enabled` flag and optional public/private `vars` fixtures. Fixtures bypass OpenBao only when `enabled` is true.

```ts
const test: KibaoTestConfig = {
  enabled: true,
  vars: { public: { NUXT_PUBLIC_API_ORIGIN: "https://example.test" } },
};
```

## Runtime entry point

```ts
import { getAllVars, getSecrets, KIBAO_DEFAULT_MAX_RESPONSE_BYTES } from "@chiballc/utils/kibao/runtime";
```

### `KibaoAccess`

`KibaoAccess` is the literal union `"public" | "private"`. It identifies whether a secret group may be exposed through public runtime configuration.

```ts
const access: KibaoAccess = "private";
```

### `Environments`

`Environments` accepts the standard `staging`, `development`, and `production` values while allowing the project's smart-string extension for custom environment names.

```ts
const environment: Environments = "production";
```

### `Location`

`Location` identifies a KV location either as `{ app, environment }` or as a literal OpenBao `{ path }`.

```ts
const byApp: Location = { app: "storefront", environment: "production" };
const byPath: Location = { path: "v1/storefront/data/production/public" };
```

### `SecretFrom`

`SecretFrom` combines a `Location` with the OpenBao `baseURL` used to fetch it.

```ts
const source: SecretFrom = {
  baseURL: "https://bao.example.com",
  location: { path: "v1/storefront/data/production/public" },
};
```

### `KibaoRoleCredentials`

`KibaoRoleCredentials` describes AppRole authentication: `bao.role.id`, `bao.secret.id`, and an optional namespace. The namespace defaults to `root`.

```ts
const role: KibaoRoleCredentials = {
  bao: { role: { id: process.env.BAO_ROLE_ID! }, secret: { id: process.env.BAO_SECRET_ID! } },
  namespace: "tenant-a",
};
```

### `KibaoTokenCredentials`

`KibaoTokenCredentials` describes token authentication: a token with a public or private attestation prefix and an optional namespace. The namespace defaults to `root`.

```ts
const token: KibaoTokenCredentials = {
  token: "is_private_access_s.abc123",
  namespace: "tenant-a",
};
```

### `KibaoCredentials`

`KibaoCredentials` combines `SecretFrom` with exactly one supported authentication form: AppRole credentials or token credentials.

```ts
const credentials: KibaoCredentials = {
  baseURL: "https://bao.example.com",
  location: { app: "storefront", environment: "production" },
  token: "yes_this_ok_to_be_public_s.abc123",
};
```

### `KibaoRequestOptions`

`KibaoRequestOptions` accepts an `AbortSignal` and an optional `maxResponseBytes` limit. The limit can be stricter than the default but cannot exceed it.

```ts
const controller = new AbortController();
const options: KibaoRequestOptions = { signal: controller.signal, maxResponseBytes: 16 * 1024 };
```

### `KibaoLoginResponse`

`KibaoLoginResponse` describes the AppRole login response shape: an `auth.client_token` string. `getKibaoToken` is generic over this shape for compatible response extensions.

```ts
const response: KibaoLoginResponse = { auth: { client_token: "s.abc123" } };
```

### `KIBAO_DEFAULT_MAX_RESPONSE_BYTES`

`KIBAO_DEFAULT_MAX_RESPONSE_BYTES` is the 65,536-byte response limit. Kibao reads response streams incrementally and rejects an oversized response before parsing it as JSON.

```ts
const defaultLimit = KIBAO_DEFAULT_MAX_RESPONSE_BYTES; // 65_536
```

### `KIBAO_DEFAULT_NAMESPACE`

`KIBAO_DEFAULT_NAMESPACE` is the string `"root"`, used when credentials do not specify an OpenBao namespace.

```ts
const namespace = KIBAO_DEFAULT_NAMESPACE; // "root"
```

### `PUBLIC_TOKEN_ATTESTATION`

`PUBLIC_TOKEN_ATTESTATION` is `"yes_this_ok_to_be_public_"`. Prefixing a token with it explicitly marks the fetched group as suitable for browser exposure.

```ts
const publicToken = `${PUBLIC_TOKEN_ATTESTATION}${process.env.BAO_PUBLIC_TOKEN}`;
```

### `PRIVATE_TOKEN_ATTESTATION`

`PRIVATE_TOKEN_ATTESTATION` is `"is_private_access_"`. Prefixing a token with it explicitly marks the token as private.

```ts
const privateToken = `${PRIVATE_TOKEN_ATTESTATION}${process.env.BAO_PRIVATE_TOKEN}`;
```

### `getSecrets`

`getSecrets(credentials, access?, options?)` authenticates when needed, reads one KV group, and returns its `vars` plus access level. It accepts cancellation and an optional response-size limit. Network failures, malformed responses, and response-size failures use sanitized Kibao request errors.

```ts
const { vars } = await getSecrets(credentials, "private", {
  signal: AbortSignal.timeout(2_000),
  maxResponseBytes: 32 * 1024,
});
```

### `getKibaoToken`

`getKibaoToken(credentials, options?)` performs the AppRole login request and returns the OpenBao token and resolved namespace. It accepts only AppRole credentials combined with a base URL.

```ts
const { token, namespace } = await getKibaoToken({
  baseURL: "https://bao.example.com",
  bao: { role: { id: "role-id" }, secret: { id: "secret-id" } },
});
```

### `getKibaoHeaders`

`getKibaoHeaders(credentials, options?)` returns `Headers` containing `X-Vault-Namespace` and `X-Vault-Token`. With AppRole credentials it obtains a token first; with token credentials it removes the attestation prefix before creating the header.

```ts
const { headers } = await getKibaoHeaders(credentials, { signal: AbortSignal.timeout(2_000) });
headers.get("X-Vault-Token");
```

### `autoEnv`

`autoEnv(access?, updateEnv?)` resolves the configured server URL and requested credentials from environment and configuration, reads that group, and optionally writes its values to the process environment. The default access group is public and `updateEnv` defaults to true.

```ts
await autoEnv(); // loads public variables and writes them to the environment
const privateVars = await autoEnv("private", false); // reads without writing
```

### `getAllVars`

`getAllVars(openbao, options?)` reads configured access groups concurrently, with a four-second budget and at most one retry per group. It returns a partial public/private record, skipping groups that are absent or fail to load.

```ts
const groups = await getAllVars(openbao, { baseURL: "https://bao.example.com" });
console.log(groups.public, groups.private);
```

### `createStartupLatch` and `isStartupComplete`

`createStartupLatch(run, options?)` shares the initial attempt and caches success. A `false` result or a rejection permits a later request to retry with capped exponential backoff. Retries return `undefined` to callers; an optional `background` callback receives a non-rejecting promise for runtime lifetime management. Options include `retryAfterMs` (1,000), `maxRetryAfterMs` (30,000), and an injectable `now` clock.

`isStartupComplete(openbao, vars, serverURL?)` reports whether every access with credentials and a resolvable server has an own property in the returned variables. Server resolution follows `getAllVars`, including environment overrides.

Both helpers are available from `@chiballc/utils/kibao/runtime/utils`.

### `crawlVarsFromEnv`

`crawlVarsFromEnv()` gathers recognized `KIBAO_*`, `OPENBAO_*`, `NUXT_KIBAO_*`, and `NUXT_OPENBAO_*` environment variables into the names Kibao uses for configuration.

```ts
process.env.OPENBAO_SERVER_BAO = "https://bao.example.com";
const overrides = crawlVarsFromEnv();
// { NUXT_KIBAO_SERVER_BAO: "https://bao.example.com" }
```

### `getEnvSereverURL`

`getEnvSereverURL()` returns the configured OpenBao server URL from `NUXT_KIBAO_SERVER_BAO`, `NUXT_PUBLIC_KIBAO_BAO_SERVER_URL`, or `DEFAULT_BAO_BASE_URL`. The exported name includes the `Serever` spelling and must be used exactly as published.

```ts
process.env.NUXT_KIBAO_SERVER_BAO = "https://bao.example.com";
getEnvSereverURL(); // "https://bao.example.com"
```

### `reconsileConfig`

`reconsileConfig(options, runtimeConfig)` merges module options, Nuxt runtime configuration, and recognized environment overrides into the effective Kibao configuration. The exported name includes the `reconsile` spelling and must be used exactly as published.

```ts
const config = reconsileConfig(
  { openbao: {}, serverOnly: true },
  { kibao: { openbao: {}, server: { bao: "https://bao.example.com" } } },
);
```

### `setEnv`

`setEnv({ vars })` writes values to both `process.env` and `std-env`. It creates a minimal process environment when a bundler has removed one.

```ts
setEnv({ vars: { API_ORIGIN: "https://api.example.com" } });
process.env.API_ORIGIN; // "https://api.example.com"
```

### `applyRuntimeConfigEnv`

`applyRuntimeConfigEnv(vars, runtimeConfig?)` applies loaded `NUXT_*` values to matching paths that already exist in a runtime configuration object. It does not create missing paths.

```ts
const runtimeConfig = { public: { apiOrigin: "" } };
applyRuntimeConfigEnv({ NUXT_PUBLIC_API_ORIGIN: "https://api.example.com" }, runtimeConfig);
runtimeConfig.public.apiOrigin; // "https://api.example.com"
```

## Deep runtime entry points

The `@chiballc/utils/kibao/runtime/*` export maps individual runtime files. These are public package paths, but the module normally registers them for you.

### `runtime/test`: `getTestVars`

`getTestVars(config)` returns configured test fixtures only when both `config.test.enabled` and `config.test.vars` are present. Otherwise it returns `undefined` and Kibao performs its normal OpenBao path.

```ts
const fixtures = getTestVars({
  test: { enabled: true, vars: { private: { API_TOKEN: "synthetic" } } },
});
```

### `runtime/server/utils`: `injectVars`

`injectVars({ app })` installs Nitro hooks that load values, update environment and runtime configuration, and expose a refreshable `{ data, refresh }` payload on request context. It also handles the supported Cloudflare request hooks.

```ts
export default defineNitroPlugin((app) => injectVars({ app }));
```

### `runtime/app/plugin`: default Nuxt plugin

The default export from `runtime/app/plugin` is Kibao's browser plugin. It exposes `$vars.data` and `$vars.refresh()` to Nuxt applications and loads public values through the proxy route when they have not already been injected.

```ts
const { $vars } = useNuxtApp();
console.log($vars?.data.NUXT_PUBLIC_API_ORIGIN);
await $vars?.refresh();
```

### `runtime/server/routes/bao-proxy`: default route

The default export from `runtime/server/routes/bao-proxy` is the H3 route handler for `/bao-proxy/**`. It forwards requests to `kibao.server.bao` and logs the upstream response status and duration.

```ts
// Installed automatically by Kibao when serverOnly is false.
const response = await $fetch("/bao-proxy/v1/storefront/data/production/public");
```

### `runtime/server/plugins/0.aplugin`: default Nitro plugin

The default export from `runtime/server/plugins/0.aplugin` is the Nitro plugin that invokes `injectVars` for the running Nitro application.

```ts
// Installed automatically by Kibao during module setup.
// Import this deep entry only when you are composing Nitro manually.
import "@chiballc/utils/kibao/runtime/server/plugins/0.aplugin";
```
