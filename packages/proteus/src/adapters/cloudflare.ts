import { parseFrontMatter } from "../index.js";
import type { ParseOptions, ParseResult } from "../types.js";

/** Minimal interface for Cloudflare KV Namespace. */
interface KVNamespace {
  get(
    key: string,
    options?: { type?: "text" | "json" | "arrayBuffer" | "stream" },
  ): Promise<string | null>;
}

/** Minimal interface for Cloudflare R2 Bucket. */
interface R2Bucket {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
}

/**
 * Read and parse front matter from a Cloudflare KV namespace.
 *
 * @param kv The KV namespace binding.
 * @param key The key to retrieve.
 * @param options Standard Proteus parse options.
 */
export async function readFromKV<T = Record<string, unknown>>(
  kv: KVNamespace,
  key: string,
  options?: ParseOptions,
): Promise<ParseResult<T>> {
  const content = await kv.get(key, { type: "text" });
  if (content === null) {
    throw new Error(`KV key not found: ${key}`);
  }
  return parseFrontMatter<T>(content, options);
}

/**
 * Read and parse front matter from a Cloudflare R2 bucket.
 *
 * @param bucket The R2 bucket binding.
 * @param key The key to retrieve.
 * @param options Standard Proteus parse options.
 */
export async function readFromR2<T = Record<string, unknown>>(
  bucket: R2Bucket,
  key: string,
  options?: ParseOptions,
): Promise<ParseResult<T>> {
  const object = await bucket.get(key);
  if (object === null) {
    throw new Error(`R2 object not found: ${key}`);
  }
  const content = await object.text();
  return parseFrontMatter<T>(content, options);
}
