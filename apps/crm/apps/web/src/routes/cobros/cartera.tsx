import { createFileRoute } from "@tanstack/react-router";
import {
	type CarteraSearch,
	MiCartera,
} from "@/components/cobros/asesor/mi-cartera";
import { leerSearchSegmento } from "@/components/cobros/cartera-general/segmentos";
import type { Bucket } from "@/components/ds/badges";
import { EmptyState } from "@/components/ui/empty-state";
import { authClient } from "@/lib/auth-client";
import { PERMISSIONS } from "@/lib/roles";

const BUCKETS: Bucket[] = ["B0", "B1", "B2", "B3", "B4", "B5"];
const GESTIONES = [
	"sin_gestion_48h",
	"sin_contactar_hoy",
	"promesa_por_vencer",
	"convenio_pendiente",
	// Solo supervisión (chip «Sin acuerdo» del Figma); el asesor lo ignora.
	"sin_acuerdo",
] as const;

/**
 * /cobros/cartera: «Mi Cartera» del asesor (Figma «Asesor Junior › 02 · Mi
 * Cartera») y «Cartera general» de supervisión y admin (Figma 2262:12).
 *
 * Contrato de URL (el Dashboard enlaza con estos parámetros):
 *   ?bucket=B0..B5 · ?gestion=sin_gestion_48h|sin_contactar_hoy|promesa_por_vencer|
 *   convenio_pendiente|sin_acuerdo · ?q=texto
 * Solo supervisión y admin (para el asesor se ignoran):
 *   ?asesor=<asesor_id de cartera>
 *   ?cola=todas|sla_hoy|promesa_hoy|vence_hoy|incumplida|promesa_proxima|
 *         sin_contacto|llamada_hoy|sin_intento_hoy   (antes /cobros/cola)
 *   ?promesa=todas|vencida|vence_hoy|por_vencer|programada (antes /cobros/promesas)
 *   ?convenio=todas|vencida|vence_hoy|por_vencer|proxima
 *                                             (antes /cobros/alertas-convenios)
 * `cola`, `promesa` y `convenio` son excluyentes entre sí y con `gestion`.
 */
export const Route = createFileRoute("/cobros/cartera")({
	validateSearch: (search: Record<string, unknown>): CarteraSearch => {
		const segmento = leerSearchSegmento(search);
		const asesor = Number(search.asesor);
		return {
			...(BUCKETS.includes(search.bucket as Bucket)
				? { bucket: search.bucket as Bucket }
				: {}),
			// Un segmento manda sobre `gestion` (son excluyentes).
			...(!segmento.cola &&
			!segmento.promesa &&
			!segmento.convenio &&
			GESTIONES.includes(search.gestion as (typeof GESTIONES)[number])
				? { gestion: search.gestion as (typeof GESTIONES)[number] }
				: {}),
			...(typeof search.q === "string" && search.q.trim()
				? { q: search.q }
				: {}),
			...(Number.isInteger(asesor) && asesor > 0 ? { asesor } : {}),
			...segmento,
		};
	},
	component: CarteraPage,
	head: () => ({ meta: [{ title: "Mi Cartera — Cobros" }] }),
});

function CarteraPage() {
	const { data: session, isPending } = authClient.useSession();
	const search = Route.useSearch();
	const userRole = session?.user.role;

	if (isPending) return null;
	if (!userRole || !PERMISSIONS.canAccessCobros(userRole)) {
		return (
			<div className="flex min-h-[60vh] items-center justify-center">
				<EmptyState
					variant="no-permission"
					title="Acceso denegado"
					description="No tiene permisos para acceder a la sección de cobros."
				/>
			</div>
		);
	}
	return <MiCartera search={search} />;
}
