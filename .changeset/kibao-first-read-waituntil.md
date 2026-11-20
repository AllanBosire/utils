---
"@chiballc/utils": patch
"kibao": patch
---

Keep Kibao's first OpenBao read alive on Cloudflare Workers and bound the requests that wait for it.

The startup latch now registers every attempt, the first included, with the runtime's `waitUntil` (from `event.waitUntil`, `event.context.waitUntil`, `event.context.cloudflare.context`, or the execution context or Durable Object of the `cloudflare:queue`, `cloudflare:scheduled` and `cloudflare:durable:init` hooks), so a client that cancels the first request no longer strands the read for every later request on the isolate. Callers wait for the shared attempt for at most `startupWaitMs` (default 5 s, slightly above the 4 s read budget); a read that has not settled by then is dropped, reported with a warning, and the next request starts a fresh one. `createStartupLatch` accepts the same bound as `waitMs`, plus an `onTimeout` callback. Values already read stay available when a later refresh fails. Behaviour on Node is unchanged apart from the wait bound.
