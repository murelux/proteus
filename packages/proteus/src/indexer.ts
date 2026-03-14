import type { ParseOptions, ParseResult } from "./index.js";
import { readFrontMatterMany } from "./index.js";
import { FrontMatterError } from "./types.js";

/**
 * Filter predicate function.
 * @param data Parsed front matter data (typed to T)
 * @param result The full parse result, allowing access to the format, excerpt, or ast if needed
 * @returns boolean true to keep the result, false to filter it out
 */
export type IndexFilterPredicate<T> = (data: T, result: ParseResult<T>) => boolean;

/**
 * Valid sort directions.
 */
export type SortDirection = "asc" | "desc";

/**
 * Indexer configuration options.
 */
export interface IndexerOptions extends ParseOptions {
  /** Maximum concurrent reads when initializing the index. @default 8 */
  concurrency?: number;
  /**
   * If true, records with `isEmpty: true` or `error` defined will be discarded
   * immediately during internal loading. If false, they are kept in the index
   * (so `.filter()` can still operate on them if desired).
   * @default true
   */
  discardInvalid?: boolean;
}

/**
 * A fast, in-memory content indexer built on top of `readFrontMatterMany`.
 *
 * Designed primarily for Static Site Generators (SSG) like Astro or Next.js to
 * efficiently load, filter, sort, and paginate a collection of Markdown files.
 *
 * @example
 * ```ts
 * import { ProteusIndexer } from "@quill/proteus";
 *
 * interface Post { title: string; date: string; draft?: boolean; }
 *
 * const index = await ProteusIndexer.load<Post>(["/docs/a.md", "/docs/b.md"]);
 *
 * const publishedRecent = index
 *   .filter((data) => !data.draft)
 *   .sort("date", "desc")
 *   .paginate(0, 10);
 * ```
 */
export class ProteusIndexer<T extends Record<string, unknown> = Record<string, unknown>> {
  private _records: ParseResult<T>[];

  /**
   * Initialize a new Indexer manually with pre-loaded results.
   * Typically, you should use `ProteusIndexer.load()` instead.
   *
   * @param records Initial array of parsed results.
   */
  constructor(records: ParseResult<T>[]) {
    this._records = records;
  }

  /**
   * Asynchronously load and parse multiple Markdown files into an index.
   *
   * @param paths Array of file paths or URLs to read.
   * @param options Parsing and indexing options.
   * @returns A new ProteusIndexer instance containing the parsed results.
   */
  static async load<T extends Record<string, unknown> = Record<string, unknown>>(
    paths: (string | URL)[],
    options?: IndexerOptions,
  ): Promise<ProteusIndexer<T>> {
    const rawResults = await readFrontMatterMany<T>(paths, options, options?.concurrency ?? 8);

    let records = rawResults;
    const discardInvalid = options?.discardInvalid ?? true;

    if (discardInvalid) {
      records = records.filter((r) => !r.isEmpty && !r.error);
    }

    return new ProteusIndexer<T>(records);
  }

  /**
   * Return the underlying array of parsed records.
   */
  get records(): ParseResult<T>[] {
    return this._records;
  }

  /**
   * Filter the indexed records using a predicate function.
   *
   * @param predicate Function to test each record. Retains elements that return true.
   * @returns A **new** ProteusIndexer instance containing only the filtered records.
   */
  filter(predicate: IndexFilterPredicate<T>): ProteusIndexer<T> {
    const filtered = this._records.filter((record) => predicate(record.data as T, record));
    return new ProteusIndexer<T>(filtered);
  }

  /**
   * Sort the indexed records by a specific data field.
   *
   * Supports sorting string, number, boolean, and Date (represented as ISO string or number) fields.
   * Missing fields are sorted to the bottom in descending order, and the top in ascending order.
   *
   * @param field The key of the front matter data to sort by.
   * @param direction "asc" for ascending, "desc" for descending. Default: "asc"
   * @returns A **new** ProteusIndexer instance containing the sorted records.
   */
  sort<K extends keyof T>(field: K, direction: SortDirection = "asc"): ProteusIndexer<T> {
    const sorted = [...this._records].sort((a, b) => {
      let valA = (a.data as T)[field];
      let valB = (b.data as T)[field];

      // Handle null/undefined values by shifting them to the end
      if (valA == null && valB == null) return 0;
      if (valA == null) return 1; // Always push null/undefined down
      if (valB == null) return -1; // Always push null/undefined down

      // Handle raw date strings to actual numbers for comparison if they parse validly
      if (typeof valA === "string" && !Number.isNaN(Date.parse(valA)))
        valA = Date.parse(valA) as unknown as T[K];
      if (typeof valB === "string" && !Number.isNaN(Date.parse(valB)))
        valB = Date.parse(valB) as unknown as T[K];

      if (valA < valB) return direction === "asc" ? -1 : 1;
      if (valA > valB) return direction === "asc" ? 1 : -1;
      return 0;
    });

    return new ProteusIndexer<T>(sorted);
  }

  /**
   * Apply a custom sort function directly on the underlying `ParseResult` objects.
   *
   * @param compareFn Standard Array.prototype.sort comparison function.
   * @returns A **new** ProteusIndexer instance containing the sorted records.
   */
  customSort(compareFn: (a: ParseResult<T>, b: ParseResult<T>) => number): ProteusIndexer<T> {
    const sorted = [...this._records].sort(compareFn);
    return new ProteusIndexer<T>(sorted);
  }

  /**
   * Paginate the index results.
   *
   * @param page The 1-based page number (e.g., 1 for the first page).
   * @param limit The number of items per page.
   * @returns A plain object containing the paginated chunk and pagination metadata.
   */
  paginate(
    page: number,
    limit: number,
  ): {
    items: ParseResult<T>[];
    totalItems: number;
    totalPages: number;
    currentPage: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  } {
    if (page < 1) {
      throw new FrontMatterError("Pagination page number must be 1 or greater.");
    }
    if (limit < 1) {
      throw new FrontMatterError("Pagination limit must be 1 or greater.");
    }

    const totalItems = this._records.length;
    const totalPages = Math.ceil(totalItems / limit);
    const safePage = Math.min(page, totalPages > 0 ? totalPages : 1);
    const offset = (safePage - 1) * limit;

    const items = this._records.slice(offset, offset + limit);

    return {
      items,
      totalItems,
      totalPages,
      currentPage: safePage,
      hasNextPage: safePage < totalPages,
      hasPreviousPage: safePage > 1,
    };
  }
}
