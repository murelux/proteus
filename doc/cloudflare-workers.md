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
bun run deploy:worker
```

The root-level `deploy:worker` script runs:

```bash
wrangler --cwd packages/proteus deploy
```

This is the recommended monorepo-safe entry point. It avoids Wrangler's workspace-root auto-detection issue and lets CI or Cloudflare Workers Builds deploy from the repository root without manually switching directories first.

`packages/proteus/wrangler.json` now commits the default Worker metadata and default KV bindings. Environment variables and any extra non-default bindings can still be managed through the Cloudflare Dashboard when needed.

For this public template, the default KV bindings are now committed directly in [`wrangler.json`](../../packages/proteus/wrangler.json) using Cloudflare's automatic provisioning:

- `KV_POSTS` — recommended default article/content store, exposed at `/posts/:slug`
- `KV_PAGES` — optional static page store, exposed at `/pages/:slug`
- `KV_CONTENT` — optional generic content store, exposed at `/content/:slug`
- `KV_DOCS` — documentation content store, exposed at `/docs/:slug`
- `KV_NEWS` — announcements/news store, exposed at `/news/:slug`
- `KV_WIKI` — wiki-style knowledge store, exposed at `/wiki/:slug`
- `KV_NOTES` — notes and digital-garden content store, exposed at `/notes/:slug`

These are internal binding names, not globally shared names. Cloudflare automatically provisions account-local resources and prefixes the created resource names with the Worker name.

### Monorepo / Dashboard Setup

If you use **Cloudflare Workers Builds** with this repository connected directly:

1. Leave the repository Root Directory at the repo root
2. Set the **Build / Deploy command once** to:

```bash
bun run deploy:worker
```

You do **not** need to re-enter `packages/proteus` or `apps/proteus` on every deploy. The directory targeting is already encoded in the repo script via Wrangler's `--cwd` flag.

> [!NOTE]
> Wrangler config files do not define the Dashboard's Git Root Directory. In a monorepo, the practical code-based approach is to commit a root deploy script and have the Dashboard call that script.

### Automatic Provisioning Notes

Cloudflare can now automatically provision KV namespaces when a binding is declared in `wrangler.json` without an `id`.

- Local `wrangler dev` creates local resources automatically
- `wrangler deploy` creates and links the remote resources automatically
- Dashboard / Git-connected deploys also create the resources, but the generated IDs remain visible in the Cloudflare Dashboard rather than being written back to your Git repository

If a consumer of this public project needs additional namespaces, they can add more `KV_*` bindings to `wrangler.json` and redeploy. Automatic provisioning does **not** create arbitrary runtime namespaces from URL input; bindings are still declared at deploy time.

---

## KV Namespaces

### Naming Convention

The Worker uses dynamic namespace resolution: the namespace name in the URL automatically maps to a `KV_*` environment binding.

| URL Namespace | Dashboard Binding | Description |
|---|---|---|
| `posts` | `KV_POSTS` | **Standard/Reserved** article storage |
| `content` | `KV_CONTENT` | General content storage |
| `pages` | `KV_PAGES` | Page data |
| `docs` | `KV_DOCS` | Documentation and help content |
| `news` | `KV_NEWS` | Announcements and news entries |
| `wiki` | `KV_WIKI` | Wiki-style knowledge content |
| `notes` | `KV_NOTES` | Personal notes and knowledge-garden content |
| `blog-posts` | `KV_BLOG_POSTS` | Optional custom store (hyphens become underscores) |

Conversion rule: lowercase namespace name → uppercased with `KV_` prefix, hyphens `-` replaced by underscores `_`.

> [!TIP]
> `KV_POSTS` is the recommended public default for article content. The route `/posts/:slug` is built-in and always available if the binding is present.

### Namespace Name Rules

- Must start with a lowercase letter
- Only lowercase letters, digits, and hyphens are allowed
- Hyphens cannot be consecutive or appear at the start/end
- Maximum length: 64 characters

Valid examples: `content`, `blog-posts`, `my-kv-store`
Invalid examples: `UPPER`, `-leading`, `has.dot`, `has space`

### Creating Additional KV Namespaces

The default `KV_POSTS`, `KV_PAGES`, `KV_CONTENT`, `KV_DOCS`, `KV_NEWS`, `KV_WIKI`, and `KV_NOTES` bindings are provisioned automatically. You only need to create extra namespaces manually when extending the template beyond the defaults.

```bash
# Example: add an extra optional namespace
wrangler kv namespace create "BLOG_POSTS"
```

### Binding via Dashboard

1. Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Go to **Workers & Pages** → select the `proteus` Worker
3. Click **Settings** → **Bindings**
4. Confirm that `KV_POSTS`, `KV_PAGES`, `KV_CONTENT`, `KV_DOCS`, `KV_NEWS`, `KV_WIKI`, and `KV_NOTES` were auto-created on first deploy
5. Only add extra bindings manually if you extend `wrangler.json` with new `KV_*` entries
6. Save

You can add any number of declared `KV_*` bindings — the Worker discovers them automatically at runtime.

### Local Development

Use the `--kv` flag to bind KV namespaces locally without modifying the config file:

```bash
wrangler dev --kv KV_CONTENT=<namespace-id> --kv KV_DOCS=<namespace-id>
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
- Accepted Content-Types: `text/*`, `application/json`
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
| `ALLOWED_NAMESPACES` | Comma-separated list of exposed KV namespaces (if unset, all matching bindings are exposed) | `content,docs,notes` |

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
