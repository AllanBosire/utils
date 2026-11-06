---
"@chiballc/utils": patch
"kibao": patch
---

Recover incomplete Kibao startup reads on later requests with capped backoff. Read access documents concurrently with a shared four-second budget per access and one retry, preserving successful documents and keeping recovery off the request path.
