import { describe, expect, test } from "bun:test";
import { formatTokenIdentifier, formatTokenIdentifierForPrefix } from "./identifier";

describe("formatTokenIdentifier", () => {
  test("formats a 9 digit sequence as Nexa token user identifier", () => {
    expect(formatTokenIdentifier(100_000_000)).toBe("100000000");
    expect(formatTokenIdentifier(310_005_010)).toBe("310005010");
  });

  test("rejects values outside Nexa's 9 digit identifier range", () => {
    expect(() => formatTokenIdentifier(99_999_999)).toThrow("Identifier sequence must be between 100000000 and 999999999");
    expect(() => formatTokenIdentifier(1_000_000_000)).toThrow("Identifier sequence must be between 100000000 and 999999999");
  });
});

describe("formatTokenIdentifierForPrefix", () => {
  test("keeps Nexa token user identifiers at 9 digits even when prefix is shorter than 7 digits", () => {
    expect(formatTokenIdentifierForPrefix({ prefix: "32200", sequence: 100_000_002 })).toBe("100000002");
  });

  test("keeps 9 digit identifiers when Nexa returns a 7 digit prefix", () => {
    expect(formatTokenIdentifierForPrefix({ prefix: "1234567", sequence: 100_000_002 })).toBe("100000002");
  });
});
