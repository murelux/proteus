import { describe, expect, it } from "vitest";
import type { SanitizeOptions } from "../src/sanitizer.js";
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

  it("should strip constructor key by default", () => {
    const raw = Object.create(null);
    raw.title = "Hello";
    raw.constructor = "Builder Pattern";

    const result = sanitizeKeys(raw) as Record<string, unknown>;
    expect(result).toEqual({ title: "Hello" });
    expect(Object.hasOwn(result, "constructor")).toBe(false);
  });

  it("should block constructor.prototype pollution chain", () => {
    // Both constructor and prototype are stripped
    const raw = Object.create(null);
    raw.constructor = Object.create(null);
    raw.constructor.prototype = { polluted: true };

    const result = sanitizeKeys(raw) as Record<string, unknown>;
    expect(Object.hasOwn(result, "constructor")).toBe(false);
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

  // ------------------------------------------------------------------
  // SanitizeOptions tests
  // ------------------------------------------------------------------

  it("should strip constructor when stripConstructor is true (explicit)", () => {
    const raw = Object.create(null);
    raw.title = "Hello";
    raw.constructor = "Builder Pattern";

    const opts: SanitizeOptions = { stripConstructor: true };
    const result = sanitizeKeys(raw, opts) as Record<string, unknown>;
    expect(result).toEqual({ title: "Hello" });
    expect(Object.hasOwn(result, "constructor")).toBe(false);
  });

  it("should strip constructor by default (no options)", () => {
    const raw = Object.create(null);
    raw.constructor = "SomeClass";
    raw.name = "test";

    const result = sanitizeKeys(raw) as Record<string, unknown>;
    expect(Object.hasOwn(result, "constructor")).toBe(false);
    expect(result.name).toBe("test");
  });

  it("should strip nested constructor when stripConstructor is true", () => {
    const raw = Object.create(null);
    raw.meta = Object.create(null);
    raw.meta.constructor = { prototype: { polluted: true } };
    raw.meta.safe = "value";

    const opts: SanitizeOptions = { stripConstructor: true };
    const result = sanitizeKeys(raw, opts) as Record<string, Record<string, unknown>>;
    expect(Object.hasOwn(result.meta, "constructor")).toBe(false);
    expect(result.meta.safe).toBe("value");
  });

  // ------------------------------------------------------------------
  // toString / valueOf — these are legitimate keys and should NOT be stripped
  // ------------------------------------------------------------------

  it("should preserve toString key (legitimate data)", () => {
    const raw = Object.create(null);
    raw.toString = "custom string representation";
    raw.name = "test";

    const result = sanitizeKeys(raw) as Record<string, unknown>;
    expect(result.toString).toBe("custom string representation");
    expect(result.name).toBe("test");
  });

  it("should preserve valueOf key (legitimate data)", () => {
    const raw = Object.create(null);
    raw.valueOf = 42;
    raw.label = "test";

    const result = sanitizeKeys(raw) as Record<string, unknown>;
    expect(result.valueOf).toBe(42);
    expect(result.label).toBe("test");
  });

  // ------------------------------------------------------------------
  // Deep mixed arrays/objects
  // ------------------------------------------------------------------

  it("should sanitize deeply mixed arrays and objects", () => {
    const inner = Object.create(null);
    inner.safe = "ok";
    inner.__proto__ = { bad: true };

    const input = {
      items: [{ name: "a" }, [inner, { nested: [{ __proto__: "evil" }] }], "plain string", 42],
    };

    const result = sanitizeKeys(input) as Record<string, unknown>;
    const items = result.items as unknown[];
    expect((items[0] as Record<string, unknown>).name).toBe("a");

    const innerArr = items[1] as unknown[];
    const sanitisedInner = innerArr[0] as Record<string, unknown>;
    expect(sanitisedInner.safe).toBe("ok");
    expect(Object.hasOwn(sanitisedInner, "__proto__")).toBe(false);

    const nestedArr = (innerArr[1] as Record<string, unknown>).nested as unknown[];
    expect(Object.hasOwn(nestedArr[0] as Record<string, unknown>, "__proto__")).toBe(false);

    expect(items[2]).toBe("plain string");
    expect(items[3]).toBe(42);
  });

  it("should handle object with only dangerous keys", () => {
    const raw = Object.create(null);
    raw.__proto__ = "evil";
    raw.prototype = "also evil";

    const result = sanitizeKeys(raw) as Record<string, unknown>;
    expect(result).toEqual({});
  });

  it("should handle arrays containing null and undefined", () => {
    const input = [null, undefined, { title: "ok", __proto__: "bad" }, "str"];
    const result = sanitizeKeys(input) as unknown[];
    expect(result[0]).toBeNull();
    expect(result[1]).toBeUndefined();
    const obj = result[2] as Record<string, unknown>;
    expect(obj.title).toBe("ok");
    expect(Object.hasOwn(obj, "__proto__")).toBe(false);
    expect(result[3]).toBe("str");
  });
});
