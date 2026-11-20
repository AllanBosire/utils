# Changelog

## 2.0.10

### Patch Changes

- 8c6a3c9: Report what a request can rely on. `event.context.vars.state` and `kibaoReadiness(event)` return `loaded` (the latest read succeeded), `stale` (an earlier read succeeded and a later one failed or timed out, so the last good values are in use) or `none` (nothing read yet on this isolate, for example because the startup wait timed out). The new `kibao.requireReady` option (default off) answers `503` with `Retry-After` while the state is `none`, except for `/bao-proxy`, `/_nuxt` and configured prefixes.

## 2.0.9

### Patch Changes

- d9117e8: Keep Kibao's first OpenBao read alive on Cloudflare Workers and bound the requests that wait for it.

  The startup latch now registers every attempt, the first included, with the runtime's `waitUntil` (from `event.waitUntil`, `event.context.waitUntil`, `event.context.cloudflare.context`, or the execution context or Durable Object of the `cloudflare:queue`, `cloudflare:scheduled` and `cloudflare:durable:init` hooks), so a client that cancels the first request no longer strands the read for every later request on the isolate. Callers wait for the shared attempt for at most `startupWaitMs` (default 5 s, slightly above the 4 s read budget); a read that has not settled by then is dropped, reported with a warning, and the next request starts a fresh one. `createStartupLatch` accepts the same bound as `waitMs`, plus an `onTimeout` callback. Values already read stay available when a later refresh fails. Behaviour on Node is unchanged apart from the wait bound.

- Updated dependencies [d9117e8]
  - @chiballc/utils@2.6.3

## 2.0.8

### Patch Changes

- e0568d4: Emit Kibao configuration types in a dedicated runtime entry and point Nuxt and Nitro type auto-imports at that entry. Fix unresolved OpenBaoOptions imports in built consumers.

## 2.0.7

### Patch Changes

- b6dd0c3: Recover incomplete Kibao startup reads on later requests with capped backoff. Read access documents concurrently with a shared four-second budget per access and one retry, preserving successful documents and keeping recovery off the request path.

## 2.0.6

### Patch Changes

- fix the strict data checking that may be an issue for numbers or other data types

## 2.0.5

### Patch Changes

- Allow callers to configure Kibao's bounded response size while keeping the 64 KiB default.

## 2.0.4

### Patch Changes

- fix: cloudflare

## 2.0.3

### Patch Changes

- fix: cloudflare envs in hooks, eg queues

## 2.0.2

### Patch Changes

- bug fixes on serverless

## 2.0.1

### Patch Changes

- bug fix

## 2.0.0

### Major Changes

- chore: changeset
- e51cbdc: fix: getting config base url kibao

## 1.1.6

### Patch Changes

- chore: fix startup injection timing

## 1.1.5

### Patch Changes

- b79d3db: fix: sync OpenBao variables into Nuxt runtime config and refresh them during Nitro runtime requests

  Adds production and Cloudflare Worker coverage for build-time module visibility, runtime availability, and changed OpenBao values after the app is already running.

- c57c43e: chore: improve config on server

## 1.1.4

### Patch Changes

- fix: bugs

## 1.1.3

### Patch Changes

- fix: backend vars get public as well

## 1.1.2

### Patch Changes

- fix: server vars

## 1.1.1

### Patch Changes

- fix: configs
- ff1621d: chore: bug fix
- cc4636e: fix: remove dotenv
- 205e43e: fix: default server url

## v1.1.0

### 🚀 Enhancements

- Added kibao (5a4f882)

### 🩹 Fixes

- Ci (5d3e473)
- Ci (fd5d633)
- Ci (eaf29c0)
- Ci (f187e93)
- Publishing (2800395)
- BaseUrl (eda0cd8)
- Publish (b24e6a6)
- Ensure read from env (5306192)

### 🏡 Chore

- Init (2262a95)
- Update peek, isempty (6f11892)
- Bumped version (e024dd9)
- Update npm publish (a2b15f6)
- Add workflow dispatch to yml (2d6de66)
- Bump (205e43e)

### ❤️ Contributors

- Allan Bosire ([@PrimalDjinn](https://github.com/PrimalDjinn))
- PrimalDjinn <archiethebig@gmail.com>
