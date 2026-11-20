---
"@chiballc/utils": patch
"kibao": patch
---

Report what a request can rely on. `event.context.vars.state` and `kibaoReadiness(event)` return `loaded` (the latest read succeeded), `stale` (an earlier read succeeded and a later one failed or timed out, so the last good values are in use) or `none` (nothing read yet on this isolate, for example because the startup wait timed out). The new `kibao.requireReady` option (default off) answers `503` with `Retry-After` while the state is `none`, except for `/bao-proxy`, `/_nuxt` and configured prefixes.
