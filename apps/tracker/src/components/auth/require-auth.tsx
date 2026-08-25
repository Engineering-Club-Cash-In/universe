import { Navigate, useLocation } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { authClient } from "@/lib/auth-client";

export function RequireAuth({ children }: { children: ReactNode }) {
	const { data: session, isPending } = authClient.useSession();
	const location = useLocation();

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

	return <>{children}</>;
}
