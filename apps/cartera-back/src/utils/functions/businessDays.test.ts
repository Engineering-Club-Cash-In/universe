import { describe, expect, test } from "bun:test";
import { calcularExpiracionCompraCartera } from "./businessDays";

describe("calcularExpiracionCompraCartera", () => {
  test("adds 24 hours to diaBaja when the purchase was extended", () => {
    const acceptedAt = new Date("2026-05-25T15:00:00.000Z");

    const withoutExtension = calcularExpiracionCompraCartera(acceptedAt);
    const withExtension = calcularExpiracionCompraCartera(acceptedAt, true);

    expect(withExtension.expira.toISOString()).toBe(withoutExtension.expira.toISOString());
    expect(withExtension.diaBaja.getTime()).toBe(
      withoutExtension.diaBaja.getTime() + 24 * 60 * 60 * 1000,
    );
  });
});
