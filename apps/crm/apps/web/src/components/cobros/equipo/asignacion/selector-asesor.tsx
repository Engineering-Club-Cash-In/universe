import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import type { client } from "@/utils/orpc";

/**
 * Piezas compartidas por los formularios de «Mi equipo» › Carga y asignación
 * (Trasladar cartera, Marcar ausente y el historial de coberturas). Vivían en
 * `traslados-panel.tsx`; aquí no dependen del contenedor del traslado y la
 * vista del modal las puede usar sin ciclos de imports.
 */

/** Asesor del catálogo `getAsesoresTraslados` (asesor_id de cartera). */
export type AsesorTraslado = Awaited<
	ReturnType<typeof client.getAsesoresTraslados>
>[number];

/**
 * Selector de asesor: `Combobox` del design system con búsqueda (la lista
 * crece con el equipo). Valor: `asesor_id` como texto ("" = sin elegir).
 * Opciones: nombre, «(inactivo)» y sus buckets. Volver a elegir la opción
 * marcada la quita. Dentro de un modal, el menú se monta en la caja del modal
 * (`PopoverPortalContext`).
 */
export function SelectorAsesor({
	id,
	value,
	onChange,
	asesores,
	disabled,
	permitirInactivo = false,
	placeholder = "Seleccionar asesor",
}: {
	id: string;
	value: string;
	onChange: (value: string) => void;
	asesores: AsesorTraslado[];
	disabled?: boolean;
	permitirInactivo?: boolean;
	placeholder?: string;
}) {
	const opciones = asesores
		.filter((a) => permitirInactivo || a.activo)
		.map((a) => ({
			value: String(a.asesor_id),
			label: `${a.nombre}${!a.activo ? " (inactivo)" : ""}${
				a.buckets.length ? ` · B${a.buckets.join(", B")}` : " · sin pool"
			}`,
		}));
	return (
		<Combobox
			id={id}
			options={opciones}
			value={opciones.some((o) => o.value === value) ? value : null}
			onChange={onChange}
			placeholder={placeholder}
			searchPlaceholder="Buscar asesor…"
			width="full"
			popOverWidth="full"
			isInModal
			maxListHeight="16rem"
			disabled={disabled}
		/>
	);
}

/** Cargando o error (con «Reintentar») de una consulta. */
export function EstadoConsulta({
	error,
	retry,
}: {
	error: boolean;
	retry: () => void;
}) {
	return error ? (
		<div role="alert" className="space-y-2 py-4 text-danger-text text-sm">
			<p>No se pudieron cargar los datos. Intente de nuevo.</p>
			<Button variant="outline" size="sm" onClick={retry}>
				Reintentar
			</Button>
		</div>
	) : (
		<output className="block py-4 text-fg-secondary text-sm">Cargando…</output>
	);
}
