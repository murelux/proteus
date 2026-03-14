import * as v from "valibot";
import { describe, expect, it } from "vitest";
import { ValidationError } from "../src/types.js";
import { validate } from "../src/validator.js";

describe("validate", () => {
  // -------------------------------------------------------------------------
  // Successful validation
  // -------------------------------------------------------------------------

  it("should return data matching a simple schema", () => {
    const schema = v.object({ title: v.string() });
    const result = validate({ title: "Hello" }, schema);

    expect(result).toEqual({ title: "Hello" });
  });

  it("should apply default values from schema", () => {
    const schema = v.object({
      title: v.string(),
      draft: v.optional(v.boolean(), false),
    });
    const result = validate({ title: "Post" }, schema);

    expect(result).toEqual({ title: "Post", draft: false });
  });

  it("should validate nested objects", () => {
    const schema = v.object({
      author: v.object({
        name: v.string(),
        age: v.number(),
      }),
    });
    const result = validate({ author: { name: "Alice", age: 30 } }, schema);

    expect(result.author.name).toBe("Alice");
    expect(result.author.age).toBe(30);
  });

  it("should validate arrays", () => {
    const schema = v.object({
      tags: v.array(v.string()),
    });
    const result = validate({ tags: ["a", "b", "c"] }, schema);

    expect(result.tags).toEqual(["a", "b", "c"]);
  });

  // -------------------------------------------------------------------------
  // Failure cases
  // -------------------------------------------------------------------------

  it("should throw ValidationError for wrong type", () => {
    const schema = v.object({ count: v.number() });

    expect(() => validate({ count: "not a number" }, schema)).toThrow(ValidationError);
  });

  it("should throw ValidationError for missing required field", () => {
    const schema = v.object({ title: v.string() });

    expect(() => validate({}, schema)).toThrow(ValidationError);
  });

  it("should include issues array in ValidationError", () => {
    const schema = v.object({
      title: v.string(),
      count: v.number(),
    });

    try {
      validate({ title: 123, count: "oops" }, schema);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const ve = err as ValidationError;
      expect(ve.issues.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("should include path info in issues", () => {
    const schema = v.object({
      author: v.object({
        name: v.string(),
      }),
    });

    try {
      validate({ author: { name: 42 } }, schema);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const ve = err as ValidationError;
      const issue = ve.issues[0] as { path?: string };
      expect(issue.path).toBeDefined();
    }
  });

  it("should produce a descriptive error message", () => {
    const schema = v.object({ title: v.string() });

    expect(() => validate({ title: 123 }, schema)).toThrow(/Front matter validation failed/);
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  it("should accept extra keys when schema does not restrict them", () => {
    const schema = v.object({ title: v.string() });
    // Valibot strips unknown keys by default in `object()`, so data
    // should only contain known keys.
    const result = validate({ title: "Hi", extra: true }, schema);
    expect(result.title).toBe("Hi");
  });

  it("should handle null data gracefully (throws ValidationError)", () => {
    const schema = v.object({ title: v.string() });

    expect(() => validate(null, schema)).toThrow(ValidationError);
  });
});
