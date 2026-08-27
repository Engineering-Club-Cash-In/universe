import { describe, expect, test } from "bun:test";
import { healthRouter } from "./health";

describe("healthRouter", () => {
	test("reports liveness without external dependencies", async () => {
		const response = await healthRouter.handle(
			new Request("http://localhost/health"),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("application/json");
		expect(await response.json()).toEqual({ status: "ok" });
	});
});
