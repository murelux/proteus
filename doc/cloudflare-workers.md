# Cloudflare Workers Guide

## Overview

Proteus deployed on Cloudflare Workers provides two core services:

1. **Markdown Front Matter Parsing API** — Accepts raw Markdown, returns structured JSON
2. **KV Content Query Service** — Article retrieval via KV namespaces, supporting multiple independent stores

## Deployment

### Prerequisites

- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
- Cloudflare account

### Basic Deployment

```bash
wrangler deploy
```

`wrangler.json` only contains the Worker name, entry point, and compatibility settings. **All KV bindings and environment variables are managed through the Cloudflare Dashboard** — nothing is committed to the config file.

---

## KV Namespaces

### Naming Convention

The Worker uses dynamic namespace resolution: the namespace name in the URL automatically maps to a `KV_*` environment binding.

| URL Namespace | Dashboard Binding | Description |
|---|---|---|
| `posts` | `KV_POSTS` | **Standard/Reserved** article storage |
| `content` | `KV_CONTENT` | General content storage |
| `pages` | `KV_PAGES` | Page data |
| `blog-posts` | `KV_BLOG_POSTS` | Blog posts (hyphens become underscores) |

Conversion rule: lowercase namespace name → uppercased with `KV_` prefix, hyphens `-` replaced by underscores `_`. 

> [!TIP]
> `KV_POSTS` is the recommended default for article content. The route `/posts/:slug` is built-in and always available if the binding is present.

### Namespace Name Rules

- Must start with a lowercase letter
- Only lowercase letters, digits, and hyphens are allowed
- Hyphens cannot be consecutive or appear at the start/end
- Maximum length: 64 characters

Valid examples: `content`, `blog-posts`, `my-kv-store`
Invalid examples: `UPPER`, `-leading`, `has.dot`, `has space`

### Creating KV Namespaces

```bash
# Create namespaces (note the IDs in the output)
wrangler kv namespace create "CONTENT"
wrangler kv namespace create "BLOG_POSTS"
```

### Binding via Dashboard

1. Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Go to **Workers & Pages** → select the `proteus` Worker
3. Click **Settings** → **Bindings**
4. Click **Add** → **KV Namespace**
5. Set the variable name to `KV_CONTENT` (or `KV_BLOG_POSTS`, etc.) and select the corresponding namespace
6. Save

You can add any number of KV bindings — the Worker discovers them automatically at runtime.

### Local Development

Use the `--kv` flag to bind KV namespaces locally without modifying the config file:

```bash
wrangler dev --kv KV_CONTENT=<namespace-id> --kv KV_BLOG_POSTS=<namespace-id>
```

---

## API Routes

### POST / — Front Matter Parsing

Send raw Markdown to the Worker and receive parsed structured data.

```bash
curl -X POST https://proteus.<your-subdomain>.workers.dev \
  -H "Content-Type: text/plain" \
  -d '---
title: Hello World
tags: [typescript, rust]
---
# Content here'
```

Response:

```json
{
  "format": "yaml",
  "data": { "title": "Hello World", "tags": ["typescript", "rust"] },
  "content": "# Content here",
  "isEmpty": false
}
```

Constraints:
- Maximum request body size: 1 MB
- Accepted Content-Types: `text/*`, `application/json`, `application/x-www-form-urlencoded`
- Automatic format detection for YAML / JSON / TOML

### GET /:namespace/:slug — Direct KV Lookup

Reads data directly from KV using the slug as the key.

```bash
curl https://proteus.<your-subdomain>.workers.dev/content/hello-world
```

### GET /:namespace/by-slug/:slug — Index-Based Lookup

Looks up the slug in the `_index` key within KV to find the actual KV key, then fetches the full data.

```bash
curl https://proteus.<your-subdomain>.workers.dev/content/by-slug/hello-world
```

Expected `_index` format:

```json
[
  { "key": "posts/2026-02-19-hello-world", "slug": "hello-world" },
  { "key": "posts/2026-02-18-another", "slug": "another-post" }
]
```

---

## Environment Variables

Configure via Dashboard under **Settings** → **Variables and Secrets**:

| Variable | Description | Example |
|---|---|---|
| `ALLOWED_ORIGINS` | Comma-separated list of allowed CORS origins | `https://example.com,https://app.example.com` |
| `ALLOWED_NAMESPACES` | Comma-separated list of exposed KV namespaces (if unset, all matching bindings are exposed) | `content,blog-posts` |

### CORS Behavior

- **`ALLOWED_ORIGINS` is set**: Only whitelisted origins receive the `Access-Control-Allow-Origin` header
- **Not set**: No CORS headers are returned, effectively restricting access to same-origin only

---

## Security Features

| Feature | Description |
|---|---|
| Slug validation | Regex filtering, blocks `..` path traversal |
| Namespace validation | Only allows valid namespace formats |
| Prototype pollution protection | `sanitizeKeys()` filters `__proto__` and similar dangerous keys |
| Error message sanitization | Automatically strips paths, stack traces, and Rust panic details |
| Security response headers | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy` |
| Request body limits | Streaming read with 1 MB cap to prevent memory exhaustion |

---

## Error Codes

| Status Code | Meaning |
|---|---|
| 200 | Success |
| 400 | Bad request (invalid slug / namespace / missing parameters / parse failure) |
| 404 | Not found (namespace does not exist / no data for slug) |
| 405 | Method not allowed |
| 413 | Request body exceeds 1 MB |
| 415 | Unsupported Content-Type |
| 500 | Internal server error |
| 503 | Service unavailable (WASM initialization failed / KV not bound) |
