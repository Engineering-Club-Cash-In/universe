import { createFileRoute } from "@tanstack/react-router";
import { redirigirAEquipo } from "@/components/cobros/equipo/redirecciones";

/**
 * «Traslados y coberturas» dejó de ser una página suelta: vive en
 * «Mi equipo» › Carga y asignación (`/cobros/equipo?tab=asignacion`):
 *   - Traslado masivo  → «Trasladar cartera» (`?accion=trasladar&asesor=`).
 *   - Coberturas       → «Marcar ausente» (`?accion=ausente&asesor=`) y el
 *                        historial «Coberturas» (`?seccion=coberturas`).
 *   - Operaciones      → historial «Traslados masivos» (`?seccion=traslados`).
 *   - Historial de reasignaciones → historial «Reasignaciones» (por defecto).
 * La pestaña «Buckets» (reasignar créditos uno por uno) se eliminó por decisión
 * del usuario: la cubre «Reasignar en bloque» de la Cartera general, con motivo
 * obligatorio y validación del pool. La ruta se conserva para los enlaces
 * guardados.
 */
export const Route = createFileRoute("/cobros/reasignaciones")({
	beforeLoad: () => redirigirAEquipo({ tab: "asignacion" }),
});
