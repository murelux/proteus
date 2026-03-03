# Sentinel's Journal

## 2024-05-22 - [Worker] Insecure Direct Object Reference in KV Namespaces
**Vulnerability:** The Cloudflare Worker implementation exposed all bound KV namespaces via a generic `/:namespace/:slug` route. This meant any internal KV namespace (e.g., `KV_SECRETS`) bound to the worker was publicly accessible if the attacker guessed the namespace name.
**Learning:** Dynamic resource mapping (like `/:namespace` -> `KV_NAMESPACE`) is convenient but dangerous if it bypasses explicit access controls.
**Prevention:** Always implement an allowlist for dynamic resource access. In this case, `ALLOWED_NAMESPACES` environment variable was added to restrict access to only intended public namespaces.

## 2025-03-03 - [CRITICAL] Path Traversal and SSRF Protection Bypass via Missing Options Argument
**Vulnerability:** A Local File Inclusion (LFI) path traversal vulnerability and SSRF protection bypass existed when using the `readFrontMatter` API. Remote URLs could not be read, and local file paths were not properly sanitized or restricted to the user-supplied `baseDir`.
**Learning:** The root cause was a failure to pass the user-supplied `options` argument from the public API (`readFrontMatter` in `src/index.ts`) down to the internal IO utility (`readFileContent` in `src/reader.ts`), and `readFileContent` lacked the implementation to actually enforce the `baseDir` restriction. This shows that having a configuration documented does not mean it's hooked up properly inside internal implementation layers.
**Prevention:** Always verify that security-related configurations (like `baseDir` and `allowRemoteUrls`) are correctly propagated through the entire call stack to the IO boundary. Always ensure that the functionality that relies on these configurations is implemented and thoroughly tested using edge cases like out-of-bounds relative paths.
