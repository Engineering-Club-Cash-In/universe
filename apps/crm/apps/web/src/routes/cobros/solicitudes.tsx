import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import {
	leerSolicitudesSearch,
	type SolicitudesSearch,
} from "@/components/cobros/solicitudes/search";
import { SolicitudesPagina } from "@/components/cobros/solicitudes/solicitudes-pagina";
import { EmptyState } from "@/components/ui/empty-state";
import { authClient } from "@/lib/auth-client";
import { PERMISSIONS } from "@/lib/roles";

/**
 * /cobros/solicitudes — bandeja única del supervisor de cobros (fase 2): lo
 * que espera su decisión (convenios, apagados y reactivaciones, recuperaciones
 * del vehículo), lo aprobado por ejecutar y el Historial de decisiones. Lo
 * ven supervisión y admin por igual (`canAssignCobros`).
 *
 * Reemplaza a /cobros/inmovilizaciones (→ ?tipo=apagado) y
 * /cobros/recuperaciones (→ ?tipo=recuperacion), que redirigen aquí.
 * Contrato de URL completo en components/cobros/solicitudes/search.ts.
 */
export const Route = createFileRoute("/cobros/solicitudes")({
	validateSearch: (search: Record<string, unknown>): SolicitudesSearch =>
		leerSolicitudesSearch(search),
	component: SolicitudesPage,
	head: () => ({ meta: [{ title: "Solicitudes — Cobros" }] }),
});

function SolicitudesPage() {
	// Mientras la sesión carga no se pinta «sin permiso» (mismo criterio que
	// las páginas de antes).
	const { data: session, isPending } = authClient.useSession();
	const userRole = session?.user?.role;
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });

	// Cambia la URL sin apilar historial por cada clic de pestaña o chip.
	const ir = (cambio: Partial<SolicitudesSearch>) =>
		navigate({
			search: (prev) => leerSolicitudesSearch({ ...prev, ...cambio }),
			replace: true,
		});

	if (isPending && !session) {
		return (
			<div className="flex min-h-[50vh] items-center justify-center text-fg-tertiary">
				<Loader2 className="mr-2 h-5 w-5 animate-spin" />
				Cargando…
			</div>
		);
	}
	if (!userRole || !PERMISSIONS.canAssignCobros(userRole)) {
		return (
			<div className="flex min-h-[60vh] items-center justify-center">
				<EmptyState
					variant="no-permission"
					title="Acceso denegado"
					description="Solo supervisión y administración pueden ver las solicitudes de cobros."
				/>
			</div>
		);
	}
	return <SolicitudesPagina search={search} onSearch={ir} />;
}
