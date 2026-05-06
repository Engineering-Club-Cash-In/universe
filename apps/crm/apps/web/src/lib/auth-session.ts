type RedirectToLoginInput = {
	error: unknown;
	isPending: boolean;
	session: unknown;
};

export const AUTH_DIAG_PREFIX = "CRM_AUTH_DIAG";

type AuthDiagnosticEvent = {
	detail?: Record<string, unknown>;
	reason: string;
};

export function shouldRedirectToLogin({
	error,
	isPending,
	session,
}: RedirectToLoginInput) {
	return !session && !isPending && !error;
}

function safeDetail(detail: Record<string, unknown> | undefined) {
	if (!detail) {
		return undefined;
	}

	return Object.fromEntries(
		Object.entries(detail).map(([key, value]) => [
			key,
			value instanceof Error ? value.message : value,
		]),
	);
}

export function logAuthDiagnostic({ detail, reason }: AuthDiagnosticEvent) {
	const payload = {
		detail: safeDetail(detail),
		path: typeof window !== "undefined" ? window.location.pathname : undefined,
		reason,
		timestamp: new Date().toISOString(),
	};

	console.warn(AUTH_DIAG_PREFIX, payload);

	if (typeof navigator === "undefined" || typeof window === "undefined") {
		return;
	}

	const serverUrl = import.meta.env.VITE_SERVER_URL;
	if (!serverUrl) {
		return;
	}

	const body = JSON.stringify(payload);
	const url = `${serverUrl}/api/auth-diagnostics/client-event`;

	if (navigator.sendBeacon) {
		navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
		return;
	}

	fetch(url, {
		body,
		credentials: "include",
		headers: { "Content-Type": "application/json" },
		keepalive: true,
		method: "POST",
	}).catch(() => undefined);
}
