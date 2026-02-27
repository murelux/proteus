import { describe, expect, it } from "vitest";
import { isPrivateHostname } from "../src/reader";

describe("SSRF Protection - IPv6 Bypass", () => {
  it("should block standard IPv4 private addresses", () => {
    expect(isPrivateHostname("127.0.0.1")).toBe(true);
    expect(isPrivateHostname("10.0.0.5")).toBe(true);
    expect(isPrivateHostname("192.168.1.1")).toBe(true);
  });

  it("should block standard IPv6 private addresses", () => {
    expect(isPrivateHostname("::1")).toBe(true);
    expect(isPrivateHostname("[::1]")).toBe(true);
    expect(isPrivateHostname("fc00::1")).toBe(true);
  });

  it("should block standard IPv4-mapped IPv6 addresses", () => {
    expect(isPrivateHostname("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateHostname("[::ffff:127.0.0.1]")).toBe(true);
  });

  it("should block hex-encoded IPv4-mapped IPv6 addresses (VULNERABILITY)", () => {
    // 127.0.0.1 = 7f 00 00 01
    // ::ffff:7f00:1
    // This currently fails (returns false) but should be true
    expect(isPrivateHostname("::ffff:7f00:1")).toBe(true);
    expect(isPrivateHostname("[::ffff:7f00:1]")).toBe(true);

    // 192.168.1.1 = c0 a8 01 01
    // ::ffff:c0a8:101
    expect(isPrivateHostname("::ffff:c0a8:101")).toBe(true);
  });

  it("should allow public addresses", () => {
    expect(isPrivateHostname("8.8.8.8")).toBe(false);
    expect(isPrivateHostname("google.com")).toBe(false);
  });
});
