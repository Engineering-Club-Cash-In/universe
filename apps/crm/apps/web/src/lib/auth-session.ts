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
	return !session && !isPending && !isTransientSessionError(error);
}

function getErrorStatus(error: unknown) {
	if (!error || typeof error !== "object") {
		return undefined;
	}

	const maybeError = error as {
		response?: { status?: unknown };
		status?: unknown;
	};
	const status = maybeError.status ?? maybeError.response?.status;

	return typeof status === "number" ? status : undefined;
}

function getErrorMessage(error: unknown) {
	if (error instanceof Error) {
		return error.message.toLowerCase();
	}

	if (!error || typeof error !== "object") {
		return "";
	}

	const maybeError = error as { message?: unknown };
	return typeof maybeError.message === "string"
		? maybeError.message.toLowerCase()
		: "";
}

function isTransientSessionError(error: unknown) {
	if (!error) {
		return false;
	}

	const status = getErrorStatus(error);
	if (status === 401 || status === 403) {
		return false;
	}

	const message = getErrorMessage(error);
	return (
		message.includes("failed to fetch") ||
		message.includes("network") ||
		message.includes("timeout") ||
		message.includes("load failed") ||
		message.includes("internet")
	);
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
