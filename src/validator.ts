/**
 * @module
 *
 * Schema validation for parsed front matter data using
 * [Valibot](https://valibot.dev). Provides a single {@linkcode validate}
 * function that checks data against a Valibot schema and throws a
 * {@linkcode ValidationError} on failure.
 *
 * @example
 * ```ts
 * import { validate } from "@quill/proteus/validator";
 * import * as v from "valibot";
 *
 * const schema = v.object({ title: v.string() });
 * const data = validate({ title: "Hello" }, schema);
 * ```
 */

import * as v from "valibot";
import { ValidationError } from "./types.js";

/**
 * Validate `data` against a Valibot schema.
 *
 * @param data  - The parsed front matter object.
 * @param schema - A Valibot `GenericSchema` to validate against.
 * @returns The validated (and potentially transformed) data.
 * @throws {ValidationError} if validation fails.
 */
export function validate<T>(data: unknown, schema: v.GenericSchema<unknown, T>): T {
  const result = v.safeParse(schema, data);

  if (result.success) {
    return result.output;
  }

  const issues = result.issues.map((issue: v.BaseIssue<unknown>) => ({
    message: issue.message,
    path: issue.path?.map((p: { key: string | number | symbol }) => p.key).join("."),
  }));

  throw new ValidationError(
    `Front matter validation failed: ${issues.map((i: { message: string }) => i.message).join("; ")}`,
    issues,
  );
}
