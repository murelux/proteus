/**
 * @module
 *
 * Sanitize parsed objects by stripping keys that could trigger
 * **prototype pollution** when the consumer merges or spreads the data
 * into other objects.
 */

import { FrontMatterError } from "./types.js";

/** Options for `sanitizeKeys`. */
export interface SanitizeOptions {
  /**
   * When `true`, also strip `constructor` keys from the output.
   * @default false
   */
  stripConstructor?: boolean;
}

const BASE_DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const STRICT_DANGEROUS_KEYS = BASE_DANGEROUS_KEYS;
const MAX_DEPTH = 512;

/**
 * Thrown when a parsed object exceeds the maximum nesting depth.
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

function sanitizeDeep(obj: unknown, dangerousKeys: Set<string>, depth = 0): unknown {
  if (depth > MAX_DEPTH) throw new DepthExceededError();
  if (obj === null || typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return sanitizeArray(obj, dangerousKeys, depth);
  }

  return sanitizeObject(obj as Record<string, unknown>, dangerousKeys, depth);
}

function sanitizeArray(arr: unknown[], dangerousKeys: Set<string>, depth: number): unknown[] {
  let clonedArray: unknown[] | null = null;
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    const sanitizedItem = sanitizeDeep(item, dangerousKeys, depth + 1);

    if (item !== sanitizedItem) {
      clonedArray ??= arr.slice();
      clonedArray[i] = sanitizedItem;
    }
  }
  return clonedArray ?? arr;
}

function sanitizeObject(
  obj: Record<string, unknown>,
  dangerousKeys: Set<string>,
  depth: number,
): Record<string, unknown> {
  let clonedObj: Record<string, unknown> | null = null;
  const keys = Object.keys(obj);

  for (const key of keys) {
    if (dangerousKeys.has(key)) {
      clonedObj ??= { ...obj };
      delete clonedObj[key];
      continue;
    }

    const value = obj[key];
    const sanitizedValue = sanitizeDeep(value, dangerousKeys, depth + 1);

    if (value !== sanitizedValue) {
      clonedObj ??= { ...obj };
      clonedObj[key] = sanitizedValue;
    }
  }

  return clonedObj ?? obj;
}
