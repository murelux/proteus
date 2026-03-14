import { describe, expect, it } from "vitest";
import { isPrivateHostname } from "../src/reader";

describe("SSRF Protection - IPv6 Bypass", () => {
  const check = (host: string, expected: boolean) => {
    expect(isPrivateHostname(host)).toBe(expected);
  };

  it("should block standard IPv4 private addresses", () => {
    for (const h of ["127.0.0.1", "10.0.0.5", "192.168.1.1"]) {
      check(h, true);
    }
  });

  it("should block standard IPv6 private addresses", () => {
    for (const h of ["::1", "[::1]", "fc00::1"]) {
      check(h, true);
    }
  });

  it("should block standard IPv4-mapped IPv6 addresses", () => {
    for (const h of ["::ffff:127.0.0.1", "[::ffff:127.0.0.1]"]) {
      check(h, true);
    }
  });

  it("should block hex-encoded IPv4-mapped IPv6 addresses", () => {
    // 127.0.0.1 = 7f 00 00 01 -> ::ffff:7f00:1
    // 192.168.1.1 = c0 a8 01 01 -> ::ffff:c0a8:101
    for (const h of ["::ffff:7f00:1", "[::ffff:7f00:1]", "::ffff:c0a8:101"]) {
      check(h, true);
    }
  });

  it("should allow public addresses", () => {
    for (const h of ["8.8.8.8", "google.com"]) {
      check(h, false);
    }
  });
});
