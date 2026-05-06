import { describe, expect, test } from "bun:test";
import { shouldRedirectToLogin } from "./auth-session";

describe("shouldRedirectToLogin", () => {
	test("redirects when session check finished without a session", () => {
		expect(
			shouldRedirectToLogin({
				error: null,
				isPending: false,
				session: null,
			}),
		).toBe(true);
	});

	test("does not redirect while session check is pending", () => {
		expect(
			shouldRedirectToLogin({
				error: null,
				isPending: true,
				session: null,
			}),
		).toBe(false);
	});

	test("does not redirect when session lookup failed", () => {
		expect(
			shouldRedirectToLogin({
				error: new Error("Failed to fetch"),
				isPending: false,
				session: null,
			}),
		).toBe(false);
	});

	test("does not redirect when a session exists", () => {
		expect(
			shouldRedirectToLogin({
				error: null,
				isPending: false,
				session: { user: { id: "user_1" } },
			}),
		).toBe(false);
	});
});
