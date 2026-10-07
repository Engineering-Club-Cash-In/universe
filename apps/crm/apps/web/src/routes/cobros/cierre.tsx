import { createFileRoute } from "@tanstack/react-router";
import { redirigirAEquipo } from "@/components/cobros/equipo/redirecciones";

/**
 * El Cierre diario dejó de ser una página suelta: es la vista «Cierre» de
 * «Mi equipo» › Día (`/cobros/equipo?tab=dia&vista=cierre`), completa (rango,
 * filtro por asesor y acordeón con contactos y movimientos de bucket). La ruta
 * se conserva para los enlaces guardados.
 */
export const Route = createFileRoute("/cobros/cierre")({
	beforeLoad: () => redirigirAEquipo({ tab: "dia", vista: "cierre" }),
});
