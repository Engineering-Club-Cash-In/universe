import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import {
	hoyGT,
	type RangoCoberturas,
} from "@/components/cobros/coberturas-panel";
import {
	AccionesEquipo,
	ModalesEquipo,
} from "@/components/cobros/equipo/acciones-equipo";
import {
	MiEquipoAsesores,
	useResumenEquipo,
} from "@/components/cobros/equipo/asesores";
import { MiEquipoAsignacion } from "@/components/cobros/equipo/asignacion/carga-asignacion";
import { MiEquipoDia } from "@/components/cobros/equipo/dia/dia";
import { MiEquipoVista } from "@/components/cobros/equipo/mi-equipo-vista";
import {
	type EquipoSearch,
	leerEquipoSearch,
} from "@/components/cobros/equipo/search";
import { EmptyState } from "@/components/ui/empty-state";
import { authClient } from "@/lib/auth-client";
import { PERMISSIONS, ROLES } from "@/lib/roles";

/**
 * /cobros/equipo — «Mi equipo» del supervisor de cobros (fase 2). Lo ven
 * supervisión y admin por igual (`canAssignCobros`). Une lo que antes eran
 * cuatro páginas, que ahora redirigen aquí:
 *   /cobros/apertura       → ?tab=dia&vista=apertura
 *   /cobros/cierre         → ?tab=dia&vista=cierre
 *   /cobros/carga          → ?tab=asignacion
 *   /cobros/reasignaciones → ?tab=asignacion
 * Contrato de URL completo en components/cobros/equipo/search.ts.
 *
 * «Trasladar cartera» y «Marcar ausente» están en el encabezado (las tres
 * pestañas) y abren modales SOBRE la pestaña actual: `?accion=` ya no fuerza
 * `tab=asignacion`. Los enlaces del Detalle del asesor
 * (`?tab=asignacion&accion=…&asesor=`) siguen funcionando igual.
 */
export const Route = createFileRoute("/cobros/equipo/")({
	validateSearch: (search: Record<string, unknown>): EquipoSearch =>
		leerEquipoSearch(search),
	component: MiEquipoPage,
	head: () => ({ meta: [{ title: "Mi equipo — Cobros" }] }),
});

function MiEquipoPage() {
	const { data: session, isPending } = authClient.useSession();
	const userRole = session?.user.role ?? "";
	const habilitado = !!session && PERMISSIONS.canAssignCobros(userRole);
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const subtitulo = useResumenEquipo(habilitado);
	// Fechas de «Coberturas registradas»: al registrar una ausencia, el
	// historial de Carga y asignación salta a sus fechas (como antes).
	const [rangoCoberturas, setRangoCoberturas] = useState<RangoCoberturas>(
		() => ({ desde: hoyGT(), hasta: hoyGT() }),
	);

	// Cambia la URL sin apilar historial por cada clic de pestaña o filtro.
	const ir = (cambio: Partial<EquipoSearch>) =>
		navigate({
			search: (prev) => leerEquipoSearch({ ...prev, ...cambio }),
			replace: true,
		});

	if (isPending && !session) {
		return (
			<div className="flex min-h-[50vh] items-center justify-center">
				<Loader2 className="h-6 w-6 animate-spin text-fg-tertiary" />
			</div>
		);
	}
	if (!habilitado) {
		return (
			<div className="flex min-h-[60vh] items-center justify-center">
				<EmptyState
					variant="no-permission"
					title="Acceso denegado"
					description="Solo supervisión y administración pueden ver al equipo de cobros."
				/>
			</div>
		);
	}

	return (
		<>
			<MiEquipoVista
				tab={search.tab ?? "asesores"}
				onTab={(tab) => ir({ tab })}
				subtitulo={subtitulo}
				acciones={
					<AccionesEquipo
						onTrasladar={() => ir({ accion: "trasladar", asesor: undefined })}
						onMarcarAusente={() => ir({ accion: "ausente", asesor: undefined })}
					/>
				}
				asesores={
					<MiEquipoAsesores
						habilitado={habilitado}
						grupo={search.grupo ?? "todos"}
						onGrupo={(grupo) => ir({ grupo })}
					/>
				}
				dia={
					<MiEquipoDia
						habilitado={habilitado}
						vista={search.vista ?? "apertura"}
						onVista={(vista) => ir({ vista })}
					/>
				}
				asignacion={
					<MiEquipoAsignacion
						habilitado={habilitado}
						esAdmin={userRole === ROLES.ADMIN}
						seccion={search.seccion ?? "reasignaciones"}
						onSeccion={(seccion) => ir({ seccion })}
						rangoCoberturas={rangoCoberturas}
						onRangoCoberturas={setRangoCoberturas}
						onAccion={(accion, asesor) => ir({ accion, asesor })}
					/>
				}
			/>
			<ModalesEquipo
				accion={search.accion}
				asesor={search.asesor}
				onCerrar={(coberturaRegistrada) =>
					ir({
						accion: undefined,
						asesor: undefined,
						// Tras registrar una ausencia, el historial muestra la lista.
						...(coberturaRegistrada ? { seccion: "coberturas" } : {}),
					})
				}
				onCoberturaRegistrada={setRangoCoberturas}
			/>
		</>
	);
}
