# Sentinel's Journal

## 2024-05-22 - [Worker] Insecure Direct Object Reference in KV Namespaces
**Vulnerability:** The Cloudflare Worker implementation exposed all bound KV namespaces via a generic `/:namespace/:slug` route. This meant any internal KV namespace (e.g., `KV_SECRETS`) bound to the worker was publicly accessible if the attacker guessed the namespace name.
**Learning:** Dynamic resource mapping (like `/:namespace` -> `KV_NAMESPACE`) is convenient but dangerous if it bypasses explicit access controls.
**Prevention:** Always implement an allowlist for dynamic resource access. In this case, `ALLOWED_NAMESPACES` environment variable was added to restrict access to only intended public namespaces.

## 2024-05-23 - [Core] Local File Inclusion / Path Traversal in readFrontMatter
**Vulnerability:** The `readFrontMatter` utility allowed reading any local file accessible by the runtime user if no path sanitization was applied by the consumer. Attackers could exploit this using path traversal patterns (e.g., `../../etc/passwd`) or absolute paths if input to this function was user-controlled.
**Learning:** File reading utilities in libraries should offer built-in boundary enforcement, as consumers often fail to implement robust sanitization themselves before passing paths down.
**Prevention:** Added a `baseDir` configuration option to `ParseOptions` that verifies the fully resolved absolute target path securely falls within the specified base directory using proper path separator checking (to avoid prefix-matching directory escapes).
