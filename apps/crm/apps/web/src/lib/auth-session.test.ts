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

	test("does not redirect when session lookup failed due to network", () => {
		expect(
			shouldRedirectToLogin({
				error: new Error("Failed to fetch"),
				isPending: false,
				session: null,
			}),
		).toBe(false);
	});

	test("redirects when session lookup fails with unauthorized status", () => {
		expect(
			shouldRedirectToLogin({
				error: { status: 401 },
				isPending: false,
				session: null,
			}),
		).toBe(true);
	});

	test("redirects when session lookup fails with forbidden status", () => {
		expect(
			shouldRedirectToLogin({
				error: { response: { status: 403 } },
				isPending: false,
				session: null,
			}),
		).toBe(true);
	});

	test("redirects when session lookup fails with a non-transient error", () => {
		expect(
			shouldRedirectToLogin({
				error: new Error("Invalid cookie signature"),
				isPending: false,
				session: null,
			}),
		).toBe(true);
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
