import { Navigate, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

export function RequireAuth({ children }: { children: ReactNode }) {
	const { data: session, isPending } = authClient.useSession();
	const location = useLocation();
	const passwordStatusQuery = useQuery({
		...orpc.getPartnerPasswordStatus.queryOptions({ input: {} }),
		enabled: Boolean(session),
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

	if (passwordStatusQuery.isError) {
		return (
			<div className="flex min-h-screen items-center justify-center px-4 text-center text-slate-600">
				No se pudo verificar el estado de tu contraseña. Intenta nuevamente.
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
