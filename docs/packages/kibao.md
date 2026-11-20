# Kibao

Kibao is a Nuxt module that reads public and private variables from OpenBao and applies them to Nuxt runtime configuration. It is provided by the root package's `@chiballc/utils/kibao` export; it is not installed as a standalone `kibao` package.

For an entry for every module, runtime, type, constant, and deep runtime export, see the [Kibao API reference](/reference/kibao).

```bash
pnpm add @chiballc/utils
```

## Configure OpenBao access

Register the module entry point and provide one or both access levels. Public variables are made available in Nuxt's public runtime configuration. Private variables remain server-side.

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ["@chiballc/utils/kibao"],
  kibao: {
    openbao: {
      public: {
        baseURL: "https://bao.example.com",
        location: { app: "storefront", environment: "production" },
        token: "yes_this_ok_to_be_public_example-token",
      },
      private: {
        baseURL: "https://bao.example.com",
        location: { path: "v1/storefront/data/production/private" },
        token: "is_private_access_example-token",
      },
    },
  },
});
```

Public tokens must be explicitly prefixed with `yes_this_ok_to_be_public_`. Private tokens can be prefixed with `is_private_access_`; tokens without either prefix are treated as private. Do not put a real private token or secret in client-side code or committed configuration.

Kibao also supports AppRole credentials using `bao.role.id` and `bao.secret.id`. It logs in to OpenBao, uses the returned token for the secret request, and keeps the configured namespace at `root` unless one is supplied.

## Runtime behavior

At module setup, Kibao loads configured OpenBao values, writes them to the server environment, and applies values to matching paths already present in runtime configuration. Browser code receives only the public group. Set `serverOnly: true` to prevent Kibao's browser plugin and proxy route from being registered.

Environment variables can override configuration. Kibao recognizes `NUXT_KIBAO_*`, `KIBAO_*`, and `OPENBAO_*` forms. The OpenBao server URL can be supplied through `NUXT_KIBAO_SERVER_BAO`, `NUXT_PUBLIC_KIBAO_BAO_SERVER_URL`, or `DEFAULT_BAO_BASE_URL`.

Startup reads access documents concurrently. Each access has a four-second budget covering AppRole login, the document read, and at most one retry after 250 ms. Successful documents remain available if another access fails. Missing credentials or a missing server are skipped rather than retried indefinitely.

The initial startup attempt is shared by waiting requests. If startup is incomplete, later traffic triggers a single background retry after a one-second backoff, doubling up to 30 seconds. Those requests do not wait for recovery; handlers must continue to reject operations that lack required configuration. Recovery stops once all readable accesses have loaded.

On Workers, every startup attempt, the first included, is registered with the runtime's `waitUntil` (taken from the request, or from the execution context of the queue and scheduled hooks and the Durable Object's state), so a client that cancels the request that started the read does not strand it for the requests after it. Cloudflare ties a subrequest to the request that started it; without this, a read begun by a request that is then cancelled can never settle, and every later request on that isolate would wait on it.

A request waits for the shared attempt for at most five seconds, slightly above the four-second read budget. Set `kibao.startupWaitMs` to change it. A read that has not settled by then is dropped with a warning, the request continues with the variables already loaded, and the next request starts a fresh read. Variables that were read successfully stay available if a later refresh fails or stalls.

### Readiness

A request that continued after the wait bound on a fresh isolate runs without variables. Kibao reports what a request can rely on as `event.context.vars.state`, or with `kibaoReadiness(event)` from `@chiballc/utils/kibao/runtime/server/utils`:

- `loaded`: the latest read succeeded;
- `stale`: something was read earlier and a later read failed, timed out, or left a document unread, so the last good values are in use;
- `none`: nothing has been read on this isolate yet, because the startup wait timed out or failed.

The state is live: a payload created before a background retry finishes reports the new state afterwards. To refuse requests while it is `none`, set `kibao.requireReady: true`. Kibao then answers `503` with `Retry-After: 2` (code `KIBAO_NOT_READY`) from a middleware registered first, except for `/bao-proxy` and `/_nuxt`. Pass an object to add `exclude` path prefixes (health checks, for example) or change `retryAfter` (seconds). `stale` and `loaded` requests are never refused. An application that needs its own response can leave the option off and check `kibaoReadiness(event)` in its own middleware instead.

## Request safety

The runtime helpers `getSecrets`, `getKibaoHeaders`, and `getKibaoToken` accept a caller-owned `AbortSignal`. Responses must be JSON and are streamed with a maximum size of 64 KiB. These low-level helpers do not retry failed network operations, and its transport errors avoid including credentials, tokens, URLs, or response bodies.

```ts
import { getSecrets } from "@chiballc/utils/kibao/runtime";

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 2_000);

try {
  const { vars } = await getSecrets(credentials, "private", {
    signal: controller.signal,
  });
  console.log(vars);
} finally {
  clearTimeout(timeout);
}
```

`maxResponseBytes` can make the response limit smaller, but cannot raise it above 64 KiB.

## Test fixtures

Use `kibao.test` only in controlled test environments. It injects fixture values without contacting OpenBao and does not expose private fixture values to public runtime configuration.

```ts
export default defineNuxtConfig({
  kibao: {
    test: {
      enabled: true,
      vars: {
        public: { NUXT_PUBLIC_API_ORIGIN: "https://example.test" },
        private: { API_TOKEN: "synthetic-test-token" },
      },
    },
  },
});
```

Never enable test fixture values in a deployed application.

## Complete API reference

The Nuxt module accepts `disabled`, `serverOnly`, `startupWaitMs`, `requireReady`, `openbao`, `vars`, `test`, and `server` configuration. `disabled` stops setup entirely. `serverOnly` prevents the client plugin and `/bao-proxy/**` route from being added. `startupWaitMs` bounds how long a request waits for the startup read. `openbao` is a public/private map of credentials. `vars` holds already-loaded values. `server.bao` is the OpenBao origin, while `server.base` is retained in the runtime configuration.

`KibaoConfig`, `PublicKibaoConfig`, `OpenBaoOptions`, `KibaoVars`, and `KibaoTestConfig` describe the module configuration and generated runtime shapes. `KibaoAccess` is `"public" | "private"`. `Location` accepts either `{ app, environment }` or `{ path }`. `KibaoCredentials` combines a location and base URL with either AppRole credentials or a token. `KibaoRequestOptions` accepts `signal` and `maxResponseBytes`. `KibaoRoleCredentials`, `KibaoTokenCredentials`, `KibaoLoginResponse`, `SecretFrom`, and `Environments` describe those constituent values.

The runtime entry point exports `getSecrets`, `getKibaoToken`, `getKibaoHeaders`, `autoEnv`, and `getAllVars`. `getSecrets` reads one access group. `getKibaoToken` obtains an AppRole token. `getKibaoHeaders` prepares authenticated OpenBao headers. `autoEnv` resolves one configured access group and can write it to the process environment. `getAllVars` reads every configured group. The constants `KIBAO_DEFAULT_MAX_RESPONSE_BYTES`, `KIBAO_DEFAULT_NAMESPACE`, `PUBLIC_TOKEN_ATTESTATION`, and `PRIVATE_TOKEN_ATTESTATION` expose the 64 KiB response ceiling, default namespace, and token prefixes.

The same runtime entry point also exports configuration helpers. `crawlVarsFromEnv` reads recognized Kibao environment variables. `getEnvSereverURL` returns the configured OpenBao server URL; its spelling is part of the exported API. `reconsileConfig` merges module options, Nuxt runtime configuration, and environment overrides. `setEnv` writes resolved values to `process.env` and `std-env`. `applyRuntimeConfigEnv` updates matching existing runtime-configuration paths from loaded values.

The `@chiballc/utils/kibao/runtime/*` wildcard exposes the individual runtime modules as well. `runtime/test` exports `getTestVars`, which returns configured fixture values only when tests are enabled. `runtime/server/utils` exports `injectVars`, the Nitro hook installer that loads values and places a refreshable payload in request context, including Cloudflare request contexts. `runtime/app/plugin`, `runtime/server/routes/bao-proxy`, and `runtime/server/plugins/0.aplugin` export the Nuxt plugin, proxy route, and Nitro plugin used internally by the module. These deep entry points are available for advanced integration, but normal applications should register `@chiballc/utils/kibao` and let the module install them.

The module generates Nuxt and Nitro type templates for loaded values. In application code, its client plugin provides `$vars.data` for public variables and `$vars.refresh()` to reload them. On the server, the module adds the `/bao-proxy/**` route when client access is enabled and a Nitro plugin that injects the loaded variables into request context.
