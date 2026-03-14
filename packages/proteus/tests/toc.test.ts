import { beforeAll, describe, expect, it } from "vitest";
import { initWasm, parseFrontMatter } from "../src/index.js";

describe("TOC Extraction", () => {
  beforeAll(async () => {
    // Ensure WASM is loaded before tests
    await initWasm();
  });

  it("should generate a nested Table of Contents", async () => {
    const source = `---
title: TOC Test
---
# Getting Started
Some introductory text.

## Installation
Steps to install.

### NPM
Using NPM.

### Yarn
Using Yarn.

## Usage
How to use.

# Advanced
Advanced topics.

## Internals
Deep dive.
`;
    const result = await parseFrontMatter(source, { extractToc: true });

    expect(result.isEmpty).toBe(false);
    expect(result.toc).toBeDefined();
    expect(result.toc).toHaveLength(2); // Two h1 elements

    // First H1: Getting Started
    expect(result.toc?.[0].text).toBe("Getting Started");
    expect(result.toc?.[0].level).toBe(1);
    expect(result.toc?.[0].children).toHaveLength(2); // Installation, Usage

    // Installation children
    const installation = result.toc?.[0].children[0];
    expect(installation?.text).toBe("Installation");
    expect(installation?.children).toHaveLength(2); // NPM, Yarn

    // Second H1: Advanced
    expect(result.toc?.[1].text).toBe("Advanced");
    expect(result.toc?.[1].children).toHaveLength(1); // Internals
  });

  it("should extract both TOC and AST when requested", async () => {
    const source = `---
title: Dual Test
---
# Heading
[Link](https://example.com)
`;
    const result = await parseFrontMatter(source, { extractAst: true, extractToc: true });

    expect(result.ast).toBeDefined();
    expect(result.ast?.links).toHaveLength(1);
    expect(result.toc).toBeDefined();
    expect(result.toc).toHaveLength(1);
  });
});
