# @chiballc/utils

## 2.6.4

### Patch Changes

- 8c6a3c9: Report what a request can rely on. `event.context.vars.state` and `kibaoReadiness(event)` return `loaded` (the latest read succeeded), `stale` (an earlier read succeeded and a later one failed or timed out, so the last good values are in use) or `none` (nothing read yet on this isolate, for example because the startup wait timed out). The new `kibao.requireReady` option (default off) answers `503` with `Retry-After` while the state is `none`, except for `/bao-proxy`, `/_nuxt` and configured prefixes.

## 2.6.3

### Patch Changes

- d9117e8: Keep Kibao's first OpenBao read alive on Cloudflare Workers and bound the requests that wait for it.

  The startup latch now registers every attempt, the first included, with the runtime's `waitUntil` (from `event.waitUntil`, `event.context.waitUntil`, `event.context.cloudflare.context`, or the execution context or Durable Object of the `cloudflare:queue`, `cloudflare:scheduled` and `cloudflare:durable:init` hooks), so a client that cancels the first request no longer strands the read for every later request on the isolate. Callers wait for the shared attempt for at most `startupWaitMs` (default 5 s, slightly above the 4 s read budget); a read that has not settled by then is dropped, reported with a warning, and the next request starts a fresh one. `createStartupLatch` accepts the same bound as `waitMs`, plus an `onTimeout` callback. Values already read stay available when a later refresh fails. Behaviour on Node is unchanged apart from the wait bound.

## 2.6.2

### Patch Changes

- e0568d4: Emit Kibao configuration types in a dedicated runtime entry and point Nuxt and Nitro type auto-imports at that entry. Fix unresolved OpenBaoOptions imports in built consumers.

## 2.6.1

### Patch Changes

- b6dd0c3: Recover incomplete Kibao startup reads on later requests with capped backoff. Read access documents concurrently with a shared four-second budget per access and one retry, preserving successful documents and keeping recovery off the request path.

## 2.6.0

### Minor Changes

- e4dbeb5: Add `@chiballc/utils/images`: a runtime-agnostic image rendition module. One `ImageTransformer` interface with adapters for the Cloudflare Workers Images binding, `ipx` on Node and `Bun.Image` on Bun, selected by build target through `workerd`/`bun`/`node` export conditions (or explicit `/cloudflare`, `/node`, `/bun` entries), header probing with input, pixel, dimension and output limits, unstorage-backed cache layers (Workers Cache API and R2, or LRU and disk) with single-flight creation, and Nuxt/Nitro modules that alias `#chiballc/images` from the Nitro preset. `ipx` and `unstorage` are optional peer dependencies.

## 2.5.3

### Patch Changes

- Allow Vite 8 as a peer dependency for the service worker plugin.

## 2.5.2

### Patch Changes

- Kibao: generate `ParsedKibaoNuxtConfig`/`ParsedKibaoNitroConfig` as intersection types instead of interfaces extending `KibaoConfig["kibao"]`. Interfaces cannot extend indexed access types, and Nuxt 4.6+ passes type templates to the Vue SFC compiler, which failed builds on the invalid declaration.

## 2.5.0

### Minor Changes

- 0a37731: Add declarative object-form Ho3 controllers with one-or-many routes while retaining scoped callback composition.

- Run route middleware for ordinary handlers, preserve OpenAPI typing for readonly middleware arrays, install generated 405 handlers before controller wildcards, and retain exact-path `all` handlers as concrete routes.

## 2.4.0

### Minor Changes

- 332cc47: Add relative nested controller composition with inherited middleware environments and ordered wildcard handling.

## 2.3.0

### Minor Changes

- 5f3adfa: Add the `@chiballc/utils/ho3` entry point for typed Hono middleware, handlers, controllers, and application composition.

## 2.2.22

### Patch Changes

- Allow callers to configure Kibao's bounded response size while keeping the 64 KiB default.
