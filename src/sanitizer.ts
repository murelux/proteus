/**
 * @module
 *
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

// Now constructor is stripped by default to prevent prototype pollution chaining
const BASE_DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const STRICT_DANGEROUS_KEYS = BASE_DANGEROUS_KEYS;

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

export function sanitizeKeys(obj: unknown, options?: SanitizeOptions): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  const dangerousKeys = options?.stripConstructor ? STRICT_DANGEROUS_KEYS : BASE_DANGEROUS_KEYS;
  return sanitizeDeep(obj, dangerousKeys);
}

/**
 * Recursively clone objects/arrays if they contain dangerous keys.
 * Implements "copy-on-write" to avoid unnecessarily cloning safe paths.
 * Returns the exact original object if no dangerous keys were found.
 */
function sanitizeDeep(obj: unknown, dangerousKeys: Set<string>, depth = 0): unknown {
  if (depth > MAX_DEPTH) throw new DepthExceededError();
  if (obj === null || typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    let clonedArray: unknown[] | null = null;
    for (let i = 0; i < obj.length; i++) {
      const item = obj[i];
      const sanitizedItem = sanitizeDeep(item, dangerousKeys, depth + 1);

      // If a child was modified, we must clone the array if we haven't already
      if (item !== sanitizedItem) {
        if (!clonedArray) {
          clonedArray = obj.slice();
        }
        clonedArray[i] = sanitizedItem;
      }
    }
    return clonedArray ?? obj;
  }

  let clonedObj: Record<string, unknown> | null = null;
  const keys = Object.keys(obj as Record<string, unknown>);

  for (const key of keys) {
    if (dangerousKeys.has(key)) {
      if (!clonedObj) clonedObj = { ...(obj as Record<string, unknown>) };
      delete clonedObj[key];
      continue;
    }

    const value = (obj as Record<string, unknown>)[key];
    const sanitizedValue = sanitizeDeep(value, dangerousKeys, depth + 1);

    // If a child was modified, clone the object
    if (value !== sanitizedValue) {
      if (!clonedObj) clonedObj = { ...(obj as Record<string, unknown>) };
      clonedObj[key] = sanitizedValue;
    }
  }

  return clonedObj ?? obj;
}
