import { createORPCClient, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { partnerTrackerRouter } from "../../../crm/apps/server/src/routers/index";

const esErrorDeSesion = (error: Error): boolean => {
	if (error instanceof ORPCError) return error.status === 401;

	const mensaje = `${error.message ?? ""} ${String(error)}`.toLowerCase();
	return (
		mensaje.includes("unauthorized") ||
		mensaje.includes("session") ||
		mensaje.includes("401")
	);
};

export const esErrorDeAcceso = (error: Error): boolean =>
	error instanceof ORPCError && (error.status === 401 || error.status === 403);

export const queryClient = new QueryClient({
	queryCache: new QueryCache({
		onError: (error) => {
			if (esErrorDeSesion(error)) {
				toast.error("Tu sesión expiró. Inicia sesión nuevamente.");
				window.location.href = "/login";
				return;
			}
			toast.error(error.message || "Ocurrió un error");
		},
	}),
	defaultOptions: {
		queries: {
			refetchInterval: 60_000,
			refetchOnWindowFocus: true,
			retry: 1,
		},
	},
});

export const link = new RPCLink({
	url: `${import.meta.env.VITE_SERVER_URL || "http://localhost:3000"}/rpc`,
	fetch(url, options) {
		return fetch(url, { ...options, credentials: "include" });
	},
});

export const client: RouterClient<typeof partnerTrackerRouter> =
	createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);
