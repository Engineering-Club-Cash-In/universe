import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

	test("production image provides the HTTP client required by Coolify", () => {
		const dockerfile = readFileSync(
			join(import.meta.dir, "../../Dockerfile"),
			"utf8",
		);

		expect(dockerfile).toMatch(/apt-get install[\s\S]*\bcurl\b/);
	});
});
