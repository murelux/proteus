import { bench, describe } from "vitest";
import { parseFrontMatter } from "../../src/index.js";
import { _resetWasmCache, initWasm } from "../../src/wasm-loader.js";

// ---------------------------------------------------------------------------
// Test payloads
// ---------------------------------------------------------------------------

const YAML_SMALL = `---
title: Hello
---
# Content`;

const YAML_MEDIUM = `---
title: A Comprehensive Guide
date: 2026-01-15
author: Alice Smith
tags:
  - typescript
  - rust
  - wasm
  - performance
category: engineering
draft: false
description: This is a longer description field that contains more text for benchmarking purposes.
---
# Content

Lots of markdown content here.`;

const JSON_SMALL = `---
{"title": "Hello"}
---
# Content`;

const JSON_MEDIUM = `---
{
  "title": "A Comprehensive Guide",
  "date": "2026-01-15",
  "author": "Alice Smith",
  "tags": ["typescript", "rust", "wasm", "performance"],
  "category": "engineering",
  "draft": false,
  "description": "This is a longer description field that contains more text for benchmarking purposes."
}
---
# Content

Lots of markdown content here.`;

const TOML_SMALL = `+++
title = "Hello"
+++
# Content`;

const TOML_MEDIUM = `+++
title = "A Comprehensive Guide"
date = "2026-01-15"
author = "Alice Smith"
tags = ["typescript", "rust", "wasm", "performance"]
category = "engineering"
draft = false
description = "This is a longer description field that contains more text for benchmarking purposes."
+++
# Content

Lots of markdown content here.`;

// ---------------------------------------------------------------------------
// Parse benchmarks (WASM pre-warmed)
// ---------------------------------------------------------------------------

describe("parseFrontMatter", () => {
  bench("YAML (small)", async () => {
    await parseFrontMatter(YAML_SMALL);
  });

  bench("YAML (medium)", async () => {
    await parseFrontMatter(YAML_MEDIUM);
  });

  bench("JSON (small)", async () => {
    await parseFrontMatter(JSON_SMALL);
  });

  bench("JSON (medium)", async () => {
    await parseFrontMatter(JSON_MEDIUM);
  });

  bench("TOML (small)", async () => {
    await parseFrontMatter(TOML_SMALL);
  });

  bench("TOML (medium)", async () => {
    await parseFrontMatter(TOML_MEDIUM);
  });
});

// ---------------------------------------------------------------------------
// WASM init benchmarks (cold vs warm)
// ---------------------------------------------------------------------------

describe("WASM init", () => {
  bench("cold init (first load)", async () => {
    _resetWasmCache();
    await initWasm();
  });

  bench("warm init (cached)", async () => {
    await initWasm();
  });
});
