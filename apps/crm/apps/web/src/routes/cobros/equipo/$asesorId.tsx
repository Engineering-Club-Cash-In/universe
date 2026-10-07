import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { DetalleAsesor } from "@/components/cobros/equipo/detalle/detalle-asesor";
import {
	asesorIdDeParam,
	type DetalleAsesorSearch,
	enlacesAsesor,
	leerSearchDetalle,
} from "@/components/cobros/equipo/detalle/enlaces";
import { EnlaceDestino } from "@/components/cobros/supervision/destino";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { authClient } from "@/lib/auth-client";
import { PERMISSIONS } from "@/lib/roles";

/**
 * /cobros/equipo/$asesorId — Detalle del asesor (Figma 2082:13), para
 * supervisión y admin por igual (`canAssignCobros`).
 *
 * `$asesorId` es el `asesor_id` de cartera. Contrato de URL:
 *   ?tab=resumen|agenda|actividad|solicitudes   (por defecto resumen)
 *   ?fecha=YYYY-MM-DD                           (día de la pestaña Agenda)
 */
export const Route = createFileRoute("/cobros/equipo/$asesorId")({
	validateSearch: (search: Record<string, unknown>): DetalleAsesorSearch =>
		leerSearchDetalle(search),
	component: DetalleAsesorPage,
	head: () => ({ meta: [{ title: "Detalle del asesor — Cobros" }] }),
});

function DetalleAsesorPage() {
	const { asesorId: param } = Route.useParams();
	const search = Route.useSearch();
	const { data: session, isPending } = authClient.useSession();
	const userRole = session?.user.role;

	if (isPending && !session) {
		return (
			<div className="flex min-h-[50vh] items-center justify-center">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		);
	}
	if (!userRole || !PERMISSIONS.canAssignCobros(userRole)) {
		return (
			<div className="flex min-h-[60vh] items-center justify-center">
				<EmptyState
					variant="no-permission"
					title="Acceso denegado"
					description="Solo supervisión y administración pueden ver el detalle de un asesor."
				/>
			</div>
		);
	}

	const asesorId = asesorIdDeParam(param);
	if (asesorId === null) {
		return (
			<div className="flex min-h-[60vh] items-center justify-center px-4">
				<EmptyState
					variant="error"
					title="Asesor no válido"
					description="El enlace no trae un número de asesor válido."
					action={
						<Button size="sm" variant="outline" asChild>
							<EnlaceDestino destino={enlacesAsesor(1).equipo}>
								Volver a Mi equipo
							</EnlaceDestino>
						</Button>
					}
				/>
			</div>
		);
	}

	// `key`: cambiar de asesor desde el selector reinicia el estado de la
	// pantalla (pestañas montadas, página del historial, vista rápida).
	return <DetalleAsesor key={asesorId} asesorId={asesorId} search={search} />;
}
