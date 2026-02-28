# Sentinel's Journal

## 2024-05-22 - [Worker] Insecure Direct Object Reference in KV Namespaces
**Vulnerability:** The Cloudflare Worker implementation exposed all bound KV namespaces via a generic `/:namespace/:slug` route. This meant any internal KV namespace (e.g., `KV_SECRETS`) bound to the worker was publicly accessible if the attacker guessed the namespace name.
**Learning:** Dynamic resource mapping (like `/:namespace` -> `KV_NAMESPACE`) is convenient but dangerous if it bypasses explicit access controls.
**Prevention:** Always implement an allowlist for dynamic resource access. In this case, `ALLOWED_NAMESPACES` environment variable was added to restrict access to only intended public namespaces.
