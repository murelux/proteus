# Sentinel's Journal

## 2024-05-22 - [Worker] Insecure Direct Object Reference in KV Namespaces
**Vulnerability:** The Cloudflare Worker implementation exposed all bound KV namespaces via a generic `/:namespace/:slug` route. This meant any internal KV namespace (e.g., `KV_SECRETS`) bound to the worker was publicly accessible if the attacker guessed the namespace name.
**Learning:** Dynamic resource mapping (like `/:namespace` -> `KV_NAMESPACE`) is convenient but dangerous if it bypasses explicit access controls.
**Prevention:** Always implement an allowlist for dynamic resource access. In this case, `ALLOWED_NAMESPACES` environment variable was added to restrict access to only intended public namespaces.

## 2025-02-20 - [Reader] Path Traversal in Local File Reads
**Vulnerability:** The `readFrontMatter` and `readFrontMatterMany` functions allowed reading any local file accessible by the runtime process. An attacker who controls the `path` argument could exploit this to perform Local File Inclusion (LFI) and read sensitive files outside of the intended directory (e.g., `../../../../etc/passwd`).
**Learning:** Any file reading utility that accepts user-provided paths must implement directory traversal protection to restrict reads to an intended base directory.
**Prevention:** Introduce a `baseDir` option to strictly enforce that the target file path remains within the resolved base directory boundaries using absolute path comparisons.
