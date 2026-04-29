import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("InvestmentCalculator investor percentage input", () => {
  it("allows clearing the investor percentage field before typing a new value", () => {
    render(<App />);

    const input = screen.getByLabelText(
      "Porcentaje del inversionista (%)",
    ) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "" } });

    expect(input).toHaveValue(null);

    fireEvent.change(input, { target: { value: "80" } });

    expect(input).toHaveValue(80);
    expect(input.value).toBe("80");
  });
});
