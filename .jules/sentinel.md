# Sentinel's Journal

## 2024-05-22 - [Worker] Insecure Direct Object Reference in KV Namespaces
**Vulnerability:** The Cloudflare Worker implementation exposed all bound KV namespaces via a generic `/:namespace/:slug` route. This meant any internal KV namespace (e.g., `KV_SECRETS`) bound to the worker was publicly accessible if the attacker guessed the namespace name.
**Learning:** Dynamic resource mapping (like `/:namespace` -> `KV_NAMESPACE`) is convenient but dangerous if it bypasses explicit access controls.
**Prevention:** Always implement an allowlist for dynamic resource access. In this case, `ALLOWED_NAMESPACES` environment variable was added to restrict access to only intended public namespaces.

## 2024-05-23 - [Reader] Path Traversal in Local File Reads
**Vulnerability:** The `readFileContent` function lacked boundaries for local file reads, making the library susceptible to path traversal/LFI vulnerabilities if user input was directly passed as the `path`.
**Learning:** Even utility libraries should provide robust "jail" options like `baseDir` to enforce access boundaries when dealing with file I/O on behalf of upstream applications.
**Prevention:** Implemented a `baseDir` option in `ParseOptions` that uses `node:path` to resolve and normalize paths, strictly enforcing that any read file resides within the allowed base directory.
