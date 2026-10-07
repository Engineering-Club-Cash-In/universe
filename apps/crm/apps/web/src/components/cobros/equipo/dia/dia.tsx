import type * as React from "react";
import { HistorialGestiones } from "@/components/cobros/historial/historial-gestiones";
import { PeriodSelector } from "@/components/ui/period-selector";
import type { VistaDia } from "../search";
import { AperturaDia } from "./apertura";
import { CierreDiario } from "./cierre";

/**
 * «Mi equipo» › pestaña Día: la jornada del equipo en tres vistas
 * (`?vista=apertura|cierre|gestiones`).
 *   - Apertura: casos críticos, movimientos de la noche y asignación del día.
 *   - Cierre: gestión de cada asesor por rango de fechas.
 *   - Gestiones: el Historial de gestiones de todo el equipo (lo que era
 *     `/cobros/historial-agendas` › «Historial de gestiones»), con sus filtros
 *     de usuario y rol y la exportación a XLSX. Lo de un solo asesor vive en su
 *     detalle (pestañas Agenda y Actividad).
 *
 * El selector Apertura · Cierre · Gestiones es el segmentado Día · Semana · Mes
 * del Figma de Reportería: va en el encabezado de cada vista, a la derecha y
 * junto a sus fechas, por eso cada vista lo recibe como `selector`.
 */

const OPCIONES: { value: VistaDia; label: string }[] = [
	{ value: "apertura", label: "Apertura" },
	{ value: "cierre", label: "Cierre" },
	{ value: "gestiones", label: "Gestiones" },
];

export const DESCRIPCION_GESTIONES =
	"Lo que registró el equipo, segmentado por bucket · más reciente primero";

/** Renderiza una vista con el selector ya armado. */
type VistaConSelector = (selector: React.ReactNode) => React.ReactNode;

export function DiaVista({
	vista,
	onVista,
	apertura,
	cierre,
	gestiones,
}: {
	vista: VistaDia;
	onVista: (vista: VistaDia) => void;
	apertura: VistaConSelector;
	cierre: VistaConSelector;
	gestiones: VistaConSelector;
}) {
	const selector = (
		<PeriodSelector
			aria-label="Vista del día"
			value={vista}
			onChange={onVista}
			options={OPCIONES}
		/>
	);
	return (
		<div className="flex min-w-0 flex-col">
			{vista === "apertura"
				? apertura(selector)
				: vista === "cierre"
					? cierre(selector)
					: gestiones(selector)}
		</div>
	);
}

export function MiEquipoDia({
	habilitado,
	vista,
	onVista,
}: {
	habilitado: boolean;
	vista: VistaDia;
	onVista: (vista: VistaDia) => void;
}) {
	return (
		<DiaVista
			vista={vista}
			onVista={onVista}
			apertura={(selector) => (
				<AperturaDia habilitado={habilitado} selector={selector} />
			)}
			cierre={(selector) => (
				<CierreDiario habilitado={habilitado} selector={selector} />
			)}
			gestiones={(selector) => (
				<HistorialGestiones
					embebido
					titulo="Gestiones del equipo"
					descripcion={DESCRIPCION_GESTIONES}
					controles={selector}
				/>
			)}
		/>
	);
}
