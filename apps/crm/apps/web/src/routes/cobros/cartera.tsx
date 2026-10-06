import { createFileRoute } from "@tanstack/react-router";
import {
	type CarteraSearch,
	MiCartera,
} from "@/components/cobros/asesor/mi-cartera";
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
] as const;

/**
 * Mi Cartera (rediseño cobros, Figma «Asesor Junior › 02 · Mi Cartera»): la
 * cartera completa del asesor. Supervisión y administración ven toda la cartera.
 * `?bucket=B1`, `?gestion=sin_gestion_48h` y `?q=texto` llegan desde el Dashboard.
 */
export const Route = createFileRoute("/cobros/cartera")({
	validateSearch: (search: Record<string, unknown>): CarteraSearch => ({
		...(BUCKETS.includes(search.bucket as Bucket)
			? { bucket: search.bucket as Bucket }
			: {}),
		...(GESTIONES.includes(search.gestion as (typeof GESTIONES)[number])
			? { gestion: search.gestion as (typeof GESTIONES)[number] }
			: {}),
		...(typeof search.q === "string" && search.q.trim() ? { q: search.q } : {}),
	}),
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
