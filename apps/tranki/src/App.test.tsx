import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./pages/index.tsx";

describe("App", () => {
  test("renders", () => {
    render(<App />);
    expect(screen.getByText("Learn React")).toBeDefined();
  });
});
