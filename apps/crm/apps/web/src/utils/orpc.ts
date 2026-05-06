import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { logAuthDiagnostic } from "@/lib/auth-session";
import type {
	AppRouter,
	disbursementRouter,
	manualVehicleRouter,
} from "../../../server/src/routers/index";

type InvestmentsRouter =
	typeof import("../../../server/src/routers/investments").investmentsRouter;

// Detectar si es un error de sesión/autenticación
const isSessionError = (error: Error): boolean => {
	const message = error.message?.toLowerCase() || "";
	const errorString = String(error).toLowerCase();

	return (
		message.includes("session") ||
		message.includes("unauthorized") ||
		message.includes("unauthenticated") ||
		message.includes("not authenticated") ||
		errorString.includes("failed_to_get_session") ||
		errorString.includes("401")
	);
};

export const queryClient = new QueryClient({
	queryCache: new QueryCache({
		onError: (error) => {
			// Si es un error de sesión, redirigir al login sin mostrar toast de error
			if (isSessionError(error)) {
				logAuthDiagnostic({
					detail: {
						message: error.message,
						name: error.name,
					},
					reason: "orpc-session-error-redirect",
				});
				toast.error(
					"Tu sesión ha expirado. Por favor inicia sesión nuevamente.",
				);
				window.location.href = "/";
				return;
			}

			// Para otros errores, mostrar el toast normal
			toast.error(`Error: ${error.message}`, {
				action: {
					label: "retry",
					onClick: () => {
						queryClient.invalidateQueries();
					},
				},
			});
		},
	}),
});

export const link = new RPCLink({
	url: `${import.meta.env.VITE_SERVER_URL}/rpc`,
	fetch(url, options) {
		return fetch(url, {
			...options,
			credentials: "include",
		});
	},
});

// Merge router types to avoid TS7056 with declaration emit
// See: https://orpc.dev/docs/advanced/exceeds-the-maximum-length-problem
type MergedRouter = AppRouter &
	typeof manualVehicleRouter &
	InvestmentsRouter &
	typeof disbursementRouter;

export const client: RouterClient<MergedRouter> = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);
