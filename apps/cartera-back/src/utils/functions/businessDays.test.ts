import { describe, expect, test } from "bun:test";
import {
  calcularExpiracionCompraCartera,
  startOfDayGT,
} from "./businessDays";

describe("calcularExpiracionCompraCartera", () => {
  test("adds one business day to diaBaja when the purchase was extended", () => {
    const acceptedAt = new Date("2026-05-25T15:00:00.000Z");

    const withoutExtension = calcularExpiracionCompraCartera(acceptedAt);
    const withExtension = calcularExpiracionCompraCartera(acceptedAt, true);

    expect(withExtension.expira.toISOString()).toBe(withoutExtension.expira.toISOString());
    expect(withoutExtension.diaBaja.toISOString()).toBe("2026-05-29T12:00:00.000Z");
    expect(withExtension.diaBaja.toISOString()).toBe("2026-06-01T12:00:00.000Z");
  });

  test("converts a GT date-only placeholder to the start of that day in Guatemala", () => {
    const diaBaja = new Date("2026-05-29T12:00:00.000Z");

    expect(startOfDayGT(diaBaja).toISOString()).toBe("2026-05-29T06:00:00.000Z");
  });
});
