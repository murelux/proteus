/**
 * Sanitize parsed objects by stripping keys that could trigger
 * **prototype pollution** when the consumer merges or spreads the data
 * into other objects.
 *
 * Targets: `__proto__`, `prototype`.
 *
 * Note: `constructor` is intentionally NOT stripped because it is a
 * legitimate data key (e.g. `constructor: "Builder Pattern"`).  The
 * `constructor.prototype.x` attack chain is already neutralised by
 * stripping `prototype`.
 *
 * @param obj - The parsed value (object, array, or primitive).
 * @returns A deep clone with dangerous keys removed.
 */

const DANGEROUS_KEYS = new Set(["__proto__", "prototype"]);

/**
 * Check if an object tree contains any dangerous keys.
 * Returns `true` if no sanitization is needed (fast path).
 */
function isSafe(obj: unknown): boolean {
  if (obj === null || typeof obj !== "object") return true;
  if (Array.isArray(obj)) return obj.every(isSafe);
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    if (DANGEROUS_KEYS.has(key)) return false;
  }
  return Object.values(obj as Record<string, unknown>).every(isSafe);
}

export function sanitizeKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  // Fast path: skip deep clone if no dangerous keys exist.
  if (isSafe(obj)) return obj;
  return sanitizeDeep(obj);
}

function sanitizeDeep(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeDeep);

  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (!DANGEROUS_KEYS.has(key)) {
      clean[key] = sanitizeDeep(value);
    }
  }
  return clean;
}
