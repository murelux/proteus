/**
 * @module
 *
 * Schema validation for parsed front matter data using the **Standard Schema**
 * protocol (`~standard`).
 *
 * This module is intentionally validator-agnostic: any library that implements
 * the Standard Schema spec works out of the box — including Zod v4, Valibot,
 * and ArkType.
 *
 * @see https://standardschema.dev
 *
 * @example
 * ```ts
 * // Zod
 * import { validate } from "@quill/proteus/validator";
 * import { z } from "zod";
 * const schema = z.object({ title: z.string() });
 * const data = await validate({ title: "Hello" }, schema);
 *
 * // Valibot
 * import { validate } from "@quill/proteus/validator";
 * import * as v from "valibot";
 * const schema = v.object({ title: v.string() });
 * const data = await validate({ title: "Hello" }, schema);
 * ```
 */

import { ValidationError } from "./types.js";

// ---------------------------------------------------------------------------
// Standard Schema types (inline — avoids adding a dep on @standard-schema/spec)
// ---------------------------------------------------------------------------

/** A single path segment reported by a Standard Schema issue. */
export type StandardPathSegment = { readonly key: string | number | symbol };

/** A validation issue reported by a Standard Schema. */
export interface StandardIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<StandardPathSegment>;
}

/** The result returned by a Standard Schema `validate()` call. */
export type StandardResult<T> =
  | { readonly value: T; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<StandardIssue>; readonly value?: undefined };

/**
 * Minimal structural type for a Standard Schema-compliant validator.
 *
 * Any library that implements `~standard.validate` satisfies this interface.
 */
export interface StandardSchema<T = unknown> {
  readonly "~standard": {
    validate(value: unknown): StandardResult<T> | Promise<StandardResult<T>>;
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isPromise<T>(v: unknown): v is Promise<T> {
  return (
    v !== null &&
    typeof v === "object" &&
    "then" in (v as Record<string, unknown>) &&
    typeof (v as { then?: unknown }).then === "function"
  );
}

function resolvePath(issue: StandardIssue): string | undefined {
  if (!issue.path || issue.path.length === 0) return undefined;
  return issue.path.map((p) => String(p.key)).join(".");
}

function throwValidationError(issues: ReadonlyArray<StandardIssue>): never {
  const simplified = Array.from(issues).map((i) => ({
    message: i.message,
    path: resolvePath(i),
  }));
  throw new ValidationError(
    `Front matter validation failed: ${simplified.map((i) => i.message).join("; ")}`,
    simplified,
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate `data` against a Standard Schema-compliant schema.
 *
 * Returns `T` directly when the schema's `validate()` is synchronous, or a
 * `Promise<T>` when it is asynchronous.  The async API (`parseFrontMatter`)
 * handles both transparently; the sync API (`parseFrontMatterSync`) will
 * throw if this returns a Promise.
 *
 * @param data   - The parsed front matter object.
 * @param schema - Any Standard Schema-compliant validator (Zod, Valibot, etc.).
 * @returns The validated (and potentially transformed) data.
 * @throws {ValidationError} if validation fails.
 * @throws {ValidationError} if `schema` does not implement Standard Schema.
 */
export function validate<T>(data: unknown, schema: StandardSchema<T>): T | Promise<T> {
  const std = (schema as Record<string | number | symbol, unknown>)["~standard"] as
    | { validate?: (v: unknown) => unknown }
    | undefined;

  if (!std || typeof std.validate !== "function") {
    throw new ValidationError(
      "Invalid schema: expected a Standard Schema with a `~standard.validate` method. " +
        "Ensure you are using a compatible library (Zod v4+, Valibot, ArkType, etc.).",
      [],
    );
  }

  const out = std.validate(data) as StandardResult<T> | Promise<StandardResult<T>>;

  if (isPromise<StandardResult<T>>(out)) {
    return out.then((r) => {
      if (r.issues === undefined) return (r as { value: T }).value;
      return throwValidationError(r.issues);
    });
  }

  if (out.issues === undefined) return (out as { value: T }).value;
  return throwValidationError(out.issues);
}
