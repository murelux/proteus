# Sentinel's Journal

## 2024-05-22 - [Worker] Insecure Direct Object Reference in KV Namespaces
**Vulnerability:** The Cloudflare Worker implementation exposed all bound KV namespaces via a generic `/:namespace/:slug` route. This meant any internal KV namespace (e.g., `KV_SECRETS`) bound to the worker was publicly accessible if the attacker guessed the namespace name.
**Learning:** Dynamic resource mapping (like `/:namespace` -> `KV_NAMESPACE`) is convenient but dangerous if it bypasses explicit access controls.
**Prevention:** Always implement an allowlist for dynamic resource access. In this case, `ALLOWED_NAMESPACES` environment variable was added to restrict access to only intended public namespaces.

## 2024-03-06 - [File System] Path Traversal in File Reading
**Vulnerability:** The `readFileContent` function in `@quill/proteus` accepted user-supplied paths without restricting them to a base directory. While this is typical for utility functions, if a developer passed a raw user-supplied path directly into `readFrontMatter`, an attacker could supply `../../etc/passwd` to read arbitrary files from the host server.
**Learning:** Functions that read files and may be used with user input should provide an opt-in or default mechanism to enforce a secure directory jail or base path to prevent path traversal / LFI.
**Prevention:** Added a `baseDir` property to `ParseOptions` that uses `node:path` to resolve paths and checks if the relative path `rel.startsWith("..")` or is an absolute path.
