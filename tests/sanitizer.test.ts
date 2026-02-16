import { describe, expect, it } from "vitest";
import { sanitizeKeys } from "../src/sanitizer.js";

describe("sanitizeKeys", () => {
  it("should strip __proto__ key", () => {
    const raw = Object.create(null);
    raw.title = "Hello";
    raw.__proto__ = { isAdmin: true };

    const result = sanitizeKeys(raw) as Record<string, unknown>;
    expect(result).toEqual({ title: "Hello" });
    expect(Object.hasOwn(result, "__proto__")).toBe(false);
  });

  it("should preserve constructor key (legitimate data key)", () => {
    const raw = Object.create(null);
    raw.title = "Hello";
    raw.constructor = "Builder Pattern";

    const result = sanitizeKeys(raw) as Record<string, unknown>;
    expect(result).toEqual({ title: "Hello", constructor: "Builder Pattern" });
    expect(Object.hasOwn(result, "constructor")).toBe(true);
  });

  it("should block constructor.prototype pollution chain", () => {
    // Even though constructor is kept, prototype inside it is stripped
    const raw = Object.create(null);
    raw.constructor = Object.create(null);
    raw.constructor.prototype = { polluted: true };

    const result = sanitizeKeys(raw) as Record<string, unknown>;
    const ctor = result.constructor as Record<string, unknown>;
    expect(Object.hasOwn(ctor, "prototype")).toBe(false);
  });

  it("should strip prototype key", () => {
    const raw = Object.create(null);
    raw.title = "Hello";
    raw.prototype = { exploit: true };

    const result = sanitizeKeys(raw) as Record<string, unknown>;
    expect(result).toEqual({ title: "Hello" });
    expect(Object.hasOwn(result, "prototype")).toBe(false);
  });

  it("should strip nested dangerous keys", () => {
    const raw = Object.create(null);
    raw.meta = Object.create(null);
    raw.meta.author = "Alice";
    raw.meta.__proto__ = { isAdmin: true };

    const result = sanitizeKeys(raw) as Record<string, unknown>;
    const meta = result.meta as Record<string, unknown>;
    expect(meta.author).toBe("Alice");
    expect(Object.hasOwn(meta, "__proto__")).toBe(false);
  });

  it("should preserve safe keys", () => {
    const input = { title: "Hello", count: 42, tags: ["a", "b"] };
    expect(sanitizeKeys(input)).toEqual(input);
  });

  it("should handle arrays of objects", () => {
    const raw = Object.create(null);
    raw.__proto__ = { bad: true };
    raw.name = "test";

    const input = [raw, { safe: true }];
    const result = sanitizeKeys(input) as Record<string, unknown>[];
    expect(result[0]).toEqual({ name: "test" });
    expect(result[1]).toEqual({ safe: true });
  });

  it("should return primitives unchanged", () => {
    expect(sanitizeKeys("hello")).toBe("hello");
    expect(sanitizeKeys(42)).toBe(42);
    expect(sanitizeKeys(true)).toBe(true);
    expect(sanitizeKeys(null)).toBeNull();
  });

  it("should handle empty objects", () => {
    expect(sanitizeKeys({})).toEqual({});
  });

  it("should handle deeply nested dangerous keys", () => {
    const raw = Object.create(null);
    raw.level1 = Object.create(null);
    raw.level1.level2 = Object.create(null);
    raw.level1.level2.safe = "value";
    raw.level1.level2.__proto__ = { attack: true };

    const result = sanitizeKeys(raw) as Record<string, Record<string, Record<string, unknown>>>;
    expect(result.level1.level2.safe).toBe("value");
    expect(Object.hasOwn(result.level1.level2, "__proto__")).toBe(false);
  });
});
