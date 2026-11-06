# Changelog

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
