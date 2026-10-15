import type { ReactNode } from "react";
import Loader from "@/components/loader";
import { asegurarFiltrosDelUsuario } from "@/hooks/usePersistedState";
import { authClient } from "@/lib/auth-client";

/**
 * Frontera de todas las rutas `/cobros/*`: antes de montar la página descarta
 * los filtros que dejó otro usuario en esta pestaña (sessionStorage sobrevive
 * al cierre de sesión y a una sesión expirada). Las páginas leen sus filtros
 * con `usePersistedState` al montar, así que la comprobación debe ir antes.
 */
export function GuardaFiltrosUsuario({ children }: { children: ReactNode }) {
	const { data: session, isPending } = authClient.useSession();
	if (isPending) return <Loader />;
	if (session?.user.id) asegurarFiltrosDelUsuario(session.user.id);
	return <>{children}</>;
}
