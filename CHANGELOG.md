# @chiballc/utils

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
