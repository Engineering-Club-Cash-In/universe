import { createFileRoute } from "@tanstack/react-router";
import { redirigirAEquipo } from "@/components/cobros/equipo/redirecciones";

/**
 * La Carga de cuentas dejó de ser una página suelta: es el resumen de
 * «Mi equipo» › Carga y asignación (`/cobros/equipo?tab=asignacion`), completo
 * (KPIs, carga por bucket, reparto por asesor con filtro, utilización y el
 * lápiz de capacidad del admin). La ruta se conserva para los enlaces guardados.
 */
export const Route = createFileRoute("/cobros/carga")({
	beforeLoad: () => redirigirAEquipo({ tab: "asignacion" }),
});
