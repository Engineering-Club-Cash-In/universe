import { format } from "date-fns";
import type { Matcher } from "react-day-picker";
import { DatePicker } from "@/components/ui/date-picker";

/**
 * Campo de fecha de cobros sobre el `DatePicker` del design system (Figma
 * «02 · Componentes › Date Picker»), con la misma API que tenía el
 * `<input type="date">` nativo: el valor es texto `YYYY-MM-DD` (día de
 * calendario, sin zona horaria) y `min`/`max` acotan los días elegibles.
 * Al elegir un día se aplica y se cierra (`applyOnSelect`).
 *
 * Dentro de un modal, el calendario se monta en la caja del modal si el modal
 * provee `PopoverPortalContext` (ver workspace-modal y trasladar-dialog).
 */

/** «2026-10-07» → Date local de ese día (sin corrimiento por zona horaria). */
export function isoAFecha(iso: string | undefined): Date | undefined {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
	if (!m) return undefined;
	return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Date → «2026-10-07» (el día de calendario que eligió el usuario). */
export function fechaAIso(fecha: Date): string {
	return format(fecha, "yyyy-MM-dd");
}

export function CampoFecha({
	id,
	value,
	onChange,
	min,
	max,
	placeholder,
	disabled,
	className,
}: {
	id?: string;
	/** YYYY-MM-DD; vacío = sin fecha (se muestra el placeholder). */
	value: string;
	onChange: (fecha: string) => void;
	/** Primer día elegible (YYYY-MM-DD). */
	min?: string;
	/** Último día elegible (YYYY-MM-DD). */
	max?: string;
	placeholder?: string;
	disabled?: boolean;
	/** Clase del campo (p. ej. `h-8` para una barra de filtros). */
	className?: string;
}) {
	const desde = isoAFecha(min);
	const hasta = isoAFecha(max);
	const deshabilitados: Matcher[] = [];
	if (desde) deshabilitados.push({ before: desde });
	if (hasta) deshabilitados.push({ after: hasta });
	return (
		<DatePicker
			id={id}
			date={isoAFecha(value)}
			onDateChange={(fecha) => {
				if (fecha) onChange(fechaAIso(fecha));
			}}
			disabledDays={deshabilitados}
			applyOnSelect
			placeholder={placeholder}
			disabled={disabled}
			className={className}
		/>
	);
}
