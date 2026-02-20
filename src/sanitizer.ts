/**
 * Sanitize parsed objects by stripping keys that could trigger
 * **prototype pollution** when the consumer merges or spreads the data
 * into other objects.
 *
 * Default targets: `__proto__`, `prototype`.
 *
 * Note: `constructor` is intentionally NOT stripped by default because it is a
 * legitimate data key (e.g. `constructor: "Builder Pattern"`).  The
 * `constructor.prototype.x` attack chain is already neutralised by
 * stripping `prototype`.
 *
 * Pass `{ stripConstructor: true }` to also strip `constructor` keys
 * for stricter environments.
 *
 * @param obj - The parsed value (object, array, or primitive).
 * @param options - Optional sanitization options.
 * @returns A deep clone with dangerous keys removed.
 */

import { FrontMatterError } from "./types.js";

/** Options for `sanitizeKeys`. */
export interface SanitizeOptions {
  /**
   * When `true`, also strip `constructor` keys from the output.
   * Useful for stricter security environments where constructor
   * references on plain objects are undesirable.
   *
   * @default false
   */
  stripConstructor?: boolean;
}

const BASE_DANGEROUS_KEYS = new Set(["__proto__", "prototype"]);

/**
 * NOTE on JSON.parse and `__proto__`: JSON.parse() creates `__proto__` as a
 * regular own property (not affecting the prototype chain). However, consumers
 * using `Object.assign({}, result.data)` can still be exploited because
 * `Object.assign` triggers the setter for `__proto__` on the target object.
 * `sanitizeKeys` handles this correctly: `Object.keys()` enumerates own
 * properties including `__proto__`, and `isSafe` / `sanitizeDeep` will detect
 * and strip it.
 */
const STRICT_DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);

/**
 * Maximum recursion depth for sanitization.
 * Prevents stack overflow on deeply nested input (e.g. thousands of nested objects).
 * 1MB input limit constrains practical nesting to ~500 levels for YAML.
 */
const MAX_DEPTH = 512;

/**
 * Thrown when a parsed object exceeds the maximum nesting depth.
 *
 * Extends `FrontMatterError` so it is caught by the standard error-handling
 * path in `parseFrontMatterCore` (both `strict: true` and `strict: false`).
 */
export class DepthExceededError extends FrontMatterError {
  constructor() {
    super("Sanitization depth limit exceeded (max 512 levels of nesting)");
    this.name = "DepthExceededError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Optimistic fast-path: returns `true` when no dangerous keys exist,
 * allowing `sanitizeKeys` to skip the deep-clone entirely.
 * Both `isSafe` and `sanitizeDeep` independently enforce `MAX_DEPTH`.
 */
function isSafe(obj: unknown, dangerousKeys: Set<string>, depth = 0): boolean {
  if (depth > MAX_DEPTH) throw new DepthExceededError();
  if (obj === null || typeof obj !== "object") return true;
  if (Array.isArray(obj)) return obj.every((item) => isSafe(item, dangerousKeys, depth + 1));
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    if (dangerousKeys.has(key)) return false;
  }
  return Object.values(obj as Record<string, unknown>).every((v) =>
    isSafe(v, dangerousKeys, depth + 1),
  );
}

export function sanitizeKeys(obj: unknown, options?: SanitizeOptions): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  const dangerousKeys = options?.stripConstructor ? STRICT_DANGEROUS_KEYS : BASE_DANGEROUS_KEYS;
  // Fast path: skip deep clone if no dangerous keys exist.
  if (isSafe(obj, dangerousKeys)) return obj;
  return sanitizeDeep(obj, dangerousKeys);
}

function sanitizeDeep(obj: unknown, dangerousKeys: Set<string>, depth = 0): unknown {
  if (depth > MAX_DEPTH) throw new DepthExceededError();
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((item) => sanitizeDeep(item, dangerousKeys, depth + 1));

  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (!dangerousKeys.has(key)) {
      clean[key] = sanitizeDeep(value, dangerousKeys, depth + 1);
    }
  }
  return clean;
}
