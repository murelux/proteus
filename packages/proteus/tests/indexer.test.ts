import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProteusIndexer } from "../src/index.js";

describe("Content Indexing API", () => {
  const testDir = join(__dirname, "_index_test_fixtures");
  const files: string[] = [];

  beforeAll(async () => {
    // Setup some test files
    try {
      mkdirSync(testDir, { recursive: true });
    } catch {}

    const docs = [
      { id: 1, title: "Apple", date: "2023-01-01", draft: false, order: 3 },
      { id: 2, title: "Banana", date: "2023-05-15", draft: true, order: 1 },
      { id: 3, title: "Cherry", date: "2023-03-10", draft: false, order: 2 },
      { id: 4, title: "Date", date: "2022-12-31", draft: false, order: 5 },
      { id: 5, title: "Elderberry", date: "2024-01-01", draft: false, order: 4 },
      // Invalid / Missing elements
      { id: 6, title: "Fig", draft: false },
    ];

    for (const doc of docs) {
      const p = join(testDir, `${doc.id}.md`);
      files.push(p);
      const fm = Object.entries(doc)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
      writeFileSync(p, `---\n${fm}\n---\n# Content ${doc.id}`);
    }
  });

  // Cleanup after all tests
  afterAll(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  interface TestDoc {
    [key: string]: unknown;
    id: number;
    title: string;
    date?: string;
    draft: boolean;
    order?: number;
  }

  it("should load and discard invalid items by default", async () => {
    // 6 markdown files, loading an additional non-existent file
    const paths = [...files, join(testDir, "missing.md")];
    const index = await ProteusIndexer.load<TestDoc>(paths);

    // Should only have the 6 valid parsed files
    expect(index.records.length).toBe(6);
  });

  it("should filter records based on a predicate", async () => {
    const index = await ProteusIndexer.load<TestDoc>(files);

    // Filter out drafts
    const published = index.filter((data) => data.draft === false);

    expect(published.records.length).toBe(5);
    // Banana is draft: true, should be missing
    expect(published.records.find((r) => r.data.title === "Banana")).toBeUndefined();
  });

  it("should sort records in ascending and descending order (numeric)", async () => {
    const index = await ProteusIndexer.load<TestDoc>(files);

    // Fig has no 'order', should be evaluated safely.
    // Asc: 1, 2, 3, 4, 5, undef
    const asc = index.sort("order", "asc");
    expect(asc.records[0].data.title).toBe("Banana"); // order 1
    expect(asc.records[4].data.title).toBe("Date"); // order 5
    expect(asc.records[5].data.title).toBe("Fig"); // order undefined pushes to end

    // Desc: 5, 4, 3, 2, 1, undef
    const desc = index.sort("order", "desc");
    expect(desc.records[0].data.title).toBe("Date"); // order 5
    expect(desc.records[4].data.title).toBe("Banana"); // order 1
    expect(desc.records[5].data.title).toBe("Fig"); // order undefined shifted to end
  });

  it("should sort records by date strings parsing safely", async () => {
    const index = await ProteusIndexer.load<TestDoc>(files);

    const asc = index.sort("date", "asc");
    expect(asc.records[0].data.title).toBe("Date"); // 2022-12-31
    expect(asc.records[4].data.title).toBe("Elderberry"); // 2024-01-01
  });

  it("should paginate correctly", async () => {
    const index = await ProteusIndexer.load<TestDoc>(files);

    // Sort asc by ID so we have a consistent 1-6 order
    const sorted = index.sort("id", "asc");

    // Page 1, Limit 2 (IDs 1, 2)
    const p1 = sorted.paginate(1, 2);
    expect(p1.items.length).toBe(2);
    expect(p1.items[0].data.id).toBe(1);
    expect(p1.items[1].data.id).toBe(2);
    expect(p1.totalItems).toBe(6);
    expect(p1.totalPages).toBe(3);
    expect(p1.currentPage).toBe(1);
    expect(p1.hasNextPage).toBe(true);
    expect(p1.hasPreviousPage).toBe(false);

    // Page 2, Limit 2 (IDs 3, 4)
    const p2 = sorted.paginate(2, 2);
    expect(p2.items[0].data.id).toBe(3);

    // Page 4 (Out of bounds, should clamp to page 3 which is IDs 5, 6)
    const p4 = sorted.paginate(4, 2);
    expect(p4.currentPage).toBe(3);
    expect(p4.items[0].data.id).toBe(5);
    expect(p4.items[1].data.id).toBe(6);
    expect(p4.hasNextPage).toBe(false);
    expect(p4.hasPreviousPage).toBe(true);
  });

  it("should allow chaining filter, sort, paginate safely", async () => {
    const index = await ProteusIndexer.load<TestDoc>(files);

    const result = index
      .filter((data) => !data.draft) // Removes 2 (Banana) -> [1, 3, 4, 5, 6]
      .sort("date", "desc") // Elderberry (2024), Apple (Jan 23), Cherry (Mar 23 -> Wait, Cherry is newer), Date (2022), Fig (missing)
      // Correct sorting: Elderberry, Cherry, Apple, Date, Fig
      .paginate(1, 3); // Get top 3

    expect(result.items.length).toBe(3);
    expect(result.items[0].data.title).toBe("Elderberry");
    expect(result.items[1].data.title).toBe("Cherry");
    expect(result.items[2].data.title).toBe("Apple");
  });
});
