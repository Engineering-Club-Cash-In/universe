import { Navigate, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2, LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { authClient, cerrarSesion } from "@/lib/auth-client";
import { esForbidden, orpc } from "@/utils/orpc";

export function RequireAuth({ children }: { children: ReactNode }) {
	const { data: session, isPending } = authClient.useSession();
	const location = useLocation();
	const identificadorSocio = session?.user.id ?? session?.user.email ?? null;
	const passwordStatusQuery = useQuery({
		...orpc.getPartnerPasswordStatus.queryOptions({ input: {} }),
		enabled: Boolean(session),
		// Sin poll de 60s: evita el toast repetido cuando el error es
		// persistente (ej. sin agencia asignada). refetchOnWindowFocus sigue
		// activo, así que una revocación de acceso se detecta igual al volver
		// a la pestaña.
		refetchInterval: false,
	});

	if (isPending) {
		return (
			<div className="flex min-h-screen items-center justify-center text-slate-600">
				<Loader2 className="mr-2 h-5 w-5 animate-spin" />
				Verificando sesión...
			</div>
		);
	}

	if (!session) {
		return <Navigate to="/login" search={{ redirect: location.pathname }} />;
	}

	if (passwordStatusQuery.isPending) {
		return (
			<div className="flex min-h-screen items-center justify-center text-slate-600">
				<Loader2 className="mr-2 h-5 w-5 animate-spin" />
				Verificando acceso...
			</div>
		);
	}

	// Con datos ya cargados, un error de refetch en segundo plano no debe
	// tirar al socio a esta pantalla — salvo que sea un 403 real (acceso
	// revocado), que manda incluso sobre datos previos.
	const forbidden =
		passwordStatusQuery.isError && esForbidden(passwordStatusQuery.error);
	if (
		passwordStatusQuery.isError &&
		(forbidden || !passwordStatusQuery.data)
	) {
		return (
			<div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center text-slate-600">
				<p>
					{forbidden
						? passwordStatusQuery.error.message
						: "No se pudo verificar el estado de tu contraseña."}
				</p>
				<div className="flex items-center gap-2">
					{!forbidden && (
						<button
							type="button"
							onClick={() => passwordStatusQuery.refetch()}
							disabled={passwordStatusQuery.isFetching}
							className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-700 text-sm transition hover:bg-slate-50 disabled:opacity-60"
						>
							{passwordStatusQuery.isFetching && (
								<Loader2 className="h-4 w-4 animate-spin" />
							)}
							Reintentar
						</button>
					)}
					<button
						type="button"
						onClick={() => cerrarSesion(identificadorSocio)}
						className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-700 text-sm transition hover:bg-slate-50"
					>
						<LogOut className="h-4 w-4" />
						Salir
					</button>
				</div>
			</div>
		);
	}

	if (
		passwordStatusQuery.data?.mustChangePassword &&
		location.pathname !== "/cambiar-contrasena"
	) {
		return (
			<Navigate
				to="/cambiar-contrasena"
				search={{ redirect: location.pathname }}
			/>
		);
	}

	return <>{children}</>;
}
