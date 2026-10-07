import { createFileRoute } from "@tanstack/react-router";
import { redirigirAEquipo } from "@/components/cobros/equipo/redirecciones";

/**
 * La Apertura del día dejó de ser una página suelta: es la vista «Apertura» de
 * «Mi equipo» › Día (`/cobros/equipo?tab=dia&vista=apertura`), completa (fecha,
 * cumplimiento de ayer, movimientos de la noche, top 3 por bucket, cuentas que
 * cambiaron de bucket y asignación del día). La ruta se conserva para los
 * enlaces guardados.
 */
export const Route = createFileRoute("/cobros/apertura")({
	beforeLoad: () => redirigirAEquipo({ tab: "dia", vista: "apertura" }),
});
