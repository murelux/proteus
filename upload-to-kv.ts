/**
 * Sync changed Markdown posts into the Cloudflare KV namespace that backs
 * the Proteus `/posts/*` routes.
 *
 * Environment variables:
 * - `CF_ACCOUNT_ID`
 * - `CF_API_TOKEN`
 * - `KV_POSTS_NAMESPACE_ID` (preferred)
 * - `KV_NAMESPACE_ID` (legacy fallback)
 * - `CHANGED_FILES` newline-delimited file list
 * - `DELETED_FILES` newline-delimited file list
 */

import * as proteus from "@quill/proteus";

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID ?? "";
const CF_API_TOKEN = process.env.CF_API_TOKEN ?? "";
const KV_POSTS_NAMESPACE_ID =
  process.env.KV_POSTS_NAMESPACE_ID ?? process.env.KV_NAMESPACE_ID ?? "";
const CHANGED_FILES = process.env.CHANGED_FILES ?? "";
const DELETED_FILES = process.env.DELETED_FILES ?? "";

const POSTS_PREFIX = "posts/";
const PUBLIC_POSTS_PREFIX = "public/posts/";
const INDEX_KEY = "_index";
const MAX_KV_VALUE_SIZE = 25 * 1024 * 1024;

// Mirror the Worker's slug contract so invalid slugs never enter `_index`.
const MAX_SLUG_LENGTH = 256;
const SLUG_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9\-_/]|\.(?!\.))*$/;

if (!CF_ACCOUNT_ID || !CF_API_TOKEN || !KV_POSTS_NAMESPACE_ID) {
  console.error(
    "Missing required environment variables: " +
      "CF_ACCOUNT_ID / CF_API_TOKEN / KV_POSTS_NAMESPACE_ID (or KV_NAMESPACE_ID)",
  );
  process.exit(1);
}

function normalizeFilePath(filePath: string): string {
  return filePath
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
}

function toPublicRelativePath(filePath: string): string {
  const normalized = normalizeFilePath(filePath);
  const match = normalized.match(/(?:^|\/)(public\/.+)$/);
  return match?.[1] ?? normalized;
}

function isPostMarkdownFile(filePath: string): boolean {
  const publicPath = toPublicRelativePath(filePath);
  return publicPath.startsWith(PUBLIC_POSTS_PREFIX) && publicPath.endsWith(".md");
}

function toKvKey(filePath: string): string {
  return toPublicRelativePath(filePath).replace(/^public\//, "");
}

function toSlugFromKey(key: string): string {
  return key.replace(/^posts\//, "").replace(/\.md$/, "");
}

function isValidSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(slug);
}

function parseSlug(raw: unknown, key: string): string {
  if (typeof raw === "string") {
    const normalized = raw.trim().replace(/^\/+|\/+$/g, "");
    if (normalized.length > 0) {
      return normalized;
    }
  }
  return toSlugFromKey(key);
}

function parseFileList(input: string): string[] {
  return input
    .split("\n")
    .map((entry) => normalizeFilePath(entry.trim()))
    .filter(Boolean)
    .filter(isPostMarkdownFile);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

const KV_API_BASE =
  `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}` +
  `/storage/kv/namespaces/${KV_POSTS_NAMESPACE_ID}`;

const headers = {
  Authorization: `Bearer ${CF_API_TOKEN}`,
  "Content-Type": "application/json",
};

async function fetchWithRetry(url: string, init?: RequestInit, retries = 3): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, init);
    if (response.ok || (response.status < 500 && response.status !== 429) || attempt >= retries) {
      return response;
    }

    const delayMs = 1000 * 2 ** attempt;
    console.warn(
      `Request failed (${response.status}), retrying in ${delayMs / 1000}s ` +
        `(${attempt + 1}/${retries})`,
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

async function bulkPut(entries: { key: string; value: string }[]) {
  const batchSize = 10_000;
  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    const response = await fetchWithRetry(`${KV_API_BASE}/bulk`, {
      method: "PUT",
      headers,
      body: JSON.stringify(batch),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`KV bulk PUT failed (${response.status}): ${text}`);
    }

    const json = (await response.json()) as { success: boolean };
    if (!json.success) {
      throw new Error("KV bulk PUT returned success=false");
    }

    console.log(`  wrote ${batch.length} entries`);
  }
}

async function bulkDelete(keys: string[]) {
  if (keys.length === 0) {
    return;
  }

  const batchSize = 10_000;
  for (let i = 0; i < keys.length; i += batchSize) {
    const batch = keys.slice(i, i + batchSize);
    const response = await fetchWithRetry(`${KV_API_BASE}/bulk`, {
      method: "DELETE",
      headers,
      body: JSON.stringify(batch),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`KV bulk DELETE failed (${response.status}): ${text}`);
    }

    console.log(`  deleted ${batch.length} entries`);
  }
}

async function kvGet(key: string): Promise<string | null> {
  const response = await fetchWithRetry(`${KV_API_BASE}/values/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${CF_API_TOKEN}` },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`KV get failed (${response.status}): ${text}`);
  }

  return response.text();
}

async function rebuildIndex(localEntries: { key: string; value: string }[], deletedKeys: string[]) {
  const localMap = new Map(localEntries.map((entry) => [entry.key, entry.value]));
  const deletedSet = new Set(deletedKeys);
  const allKeys: string[] = [];
  const seenSlugs = new Map<string, string>();
  let cursor: string | undefined;

  do {
    const url = new URL(`${KV_API_BASE}/keys`);
    if (cursor) {
      url.searchParams.set("cursor", cursor);
    }

    const response = await fetchWithRetry(url.toString(), { headers });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`KV list keys failed (${response.status}): ${text}`);
    }

    const json = (await response.json()) as {
      result: { name: string }[];
      result_info: { cursor?: string };
    };

    for (const { name } of json.result) {
      if (
        name !== INDEX_KEY &&
        name.startsWith(POSTS_PREFIX) &&
        name.endsWith(".md") &&
        !deletedSet.has(name)
      ) {
        allKeys.push(name);
      }
    }

    cursor = json.result_info?.cursor || undefined;
  } while (cursor);

  const index: Record<string, unknown>[] = [];

  for (const key of allKeys) {
    const raw = localMap.get(key) ?? (await kvGet(key));
    if (!raw) {
      continue;
    }

    try {
      const data = JSON.parse(raw) as Record<string, unknown>;
      const frontmatter = isRecord(data.frontmatter) ? data.frontmatter : {};
      const slug = parseSlug(frontmatter.slug, key);

      if (!isValidSlug(slug)) {
        console.warn(`Skipping ${key}: slug does not satisfy Worker rules (${slug})`);
        continue;
      }

      const conflictKey = seenSlugs.get(slug);
      if (conflictKey) {
        throw new Error(
          `Duplicate slug "${slug}" detected for ${conflictKey} and ${key}. ` +
            "Set a unique front matter slug or change the file path.",
        );
      }
      seenSlugs.set(slug, key);

      index.push({
        key,
        title: data.title,
        date: frontmatter.date,
        slug,
        subtitle: frontmatter.subtitle,
        cover: frontmatter.cover,
        authors: frontmatter.authors,
        language: frontmatter.language,
        tags: frontmatter.tags,
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Duplicate slug")) {
        throw error;
      }
      console.warn(`Skipping ${key}: failed to parse stored JSON`);
    }
  }

  await bulkPut([{ key: INDEX_KEY, value: JSON.stringify(index) }]);
  console.log(`Index rebuilt: ${index.length} post(s)`);
}

async function parseFile(filePath: string): Promise<{ key: string; value: string } | null> {
  if (!isPostMarkdownFile(filePath)) {
    return null;
  }

  try {
    const result = await proteus.readFrontMatter(filePath);
    if ("error" in result && result.error) {
      console.warn(`Skipping ${filePath}: ${result.error.message}`);
      return null;
    }

    const key = toKvKey(filePath);
    const frontmatter = result.isEmpty ? {} : (result.data ?? {});
    const content = result.content ?? "";
    const fm = frontmatter as Record<string, unknown>;
    const slug = parseSlug(fm.slug, key);

    if (!isValidSlug(slug)) {
      console.warn(`Skipping ${filePath}: slug does not satisfy Worker rules (${slug})`);
      return null;
    }

    const title =
      typeof fm.title === "string" && fm.title.trim().length > 0
        ? fm.title
        : (key.split("/").pop()?.replace(/\.md$/, "") ?? "");

    const value = JSON.stringify({
      title,
      path: key,
      slug,
      namespace: "posts",
      frontmatter,
      content: content.trim(),
      updatedAt: new Date().toISOString(),
    });

    if (new TextEncoder().encode(value).byteLength > MAX_KV_VALUE_SIZE) {
      console.warn(`Skipping ${filePath}: value exceeds the 25 MB KV limit`);
      return null;
    }

    return { key, value };
  } catch (error) {
    console.warn(`Skipping ${filePath}: ${(error as Error).message}`);
    return null;
  }
}

const REBUILD_INDEX_ONLY = process.argv.includes("--rebuild-index");

async function main() {
  if (REBUILD_INDEX_ONLY) {
    console.log("Rebuilding posts index only...");
    await rebuildIndex([], []);
    console.log("Posts index rebuild completed.");
    return;
  }

  const changedFiles = parseFileList(CHANGED_FILES);
  const deletedFiles = parseFileList(DELETED_FILES);

  console.log(`Changed post files: ${changedFiles.length}`);
  console.log(`Deleted post files: ${deletedFiles.length}`);

  if (changedFiles.length === 0 && deletedFiles.length === 0) {
    console.log("No post files to sync.");
    return;
  }

  let entries: { key: string; value: string }[] = [];
  if (changedFiles.length > 0) {
    const results = await Promise.all(changedFiles.map(parseFile));
    entries = results.filter((entry): entry is { key: string; value: string } => entry !== null);

    for (const entry of entries) {
      console.log(`  uploading ${entry.key}`);
    }

    if (entries.length > 0) {
      await bulkPut(entries);
    }
  }

  const deletedKeys = deletedFiles.map(toKvKey);
  if (deletedKeys.length > 0) {
    for (const key of deletedKeys) {
      console.log(`  deleting ${key}`);
    }
    await bulkDelete(deletedKeys);
  }

  await rebuildIndex(entries, deletedKeys);
  console.log("Posts sync completed.");
}

main().catch((error) => {
  console.error("Posts sync failed:", error);
  process.exit(1);
});
