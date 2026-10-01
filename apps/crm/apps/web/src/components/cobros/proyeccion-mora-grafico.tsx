/**
 * Barras por día de la proyección de mora del mes: gris lo que ya pasó (la
 * mora real que registró el sistema), morado lo proyectado y, más oscuro, el
 * día elegido. Tocar una barra elige ese día en la tarjeta.
 */

import {
	Bar,
	BarChart,
	Cell,
	Tooltip as RechartsTooltip,
	ResponsiveContainer,
	XAxis,
	YAxis,
} from "recharts";
import type { ProyeccionMoraDia } from "server/src/types/cartera-back";

// Gris para lo que ya pasó (un hecho) y morado para lo proyectado, los mismos
// dos tonos de «Real» y «Escenario» del simulador de reportes.
const COLOR_REAL = "#94a3b8";
const COLOR_PROYECCION = "#d8b4fe";
const COLOR_SELECCIONADO = "#7e22ce";

const q = (valor: number) =>
	`Q${valor.toLocaleString("es-GT", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;

export function ProyeccionMoraGrafico(props: {
	dias: ProyeccionMoraDia[];
	/** Fecha (YYYY-MM-DD) del día elegido en la tarjeta. */
	seleccionado: string;
	onSeleccionar: (fecha: string) => void;
}) {
	return (
		<>
			<ResponsiveContainer width="100%" height={160}>
				<BarChart
					data={props.dias.map((d) => ({
						...d,
						dia: Number(d.fecha.slice(8)),
						monto: Number(d.mora),
					}))}
				>
					<XAxis dataKey="dia" tick={{ fontSize: 10 }} interval={1} />
					<YAxis
						tick={{ fontSize: 10 }}
						width={48}
						tickFormatter={(v) => `Q${Number(v).toFixed(0)}`}
					/>
					<RechartsTooltip
						formatter={(v) => [q(Number(v)), "Mora"]}
						labelFormatter={(d) => `Día ${d}`}
					/>
					<Bar
						dataKey="monto"
						radius={[2, 2, 0, 0]}
						onClick={(barra: { payload?: { fecha?: string } }) =>
							barra.payload?.fecha && props.onSeleccionar(barra.payload.fecha)
						}
					>
						{props.dias.map((d) => (
							<Cell
								key={d.fecha}
								cursor="pointer"
								fill={
									d.fecha === props.seleccionado
										? COLOR_SELECCIONADO
										: d.tipo === "real"
											? COLOR_REAL
											: COLOR_PROYECCION
								}
							/>
						))}
					</Bar>
				</BarChart>
			</ResponsiveContainer>

			<div className="flex flex-wrap items-center gap-4 text-muted-foreground text-xs">
				{[
					[COLOR_REAL, "Real (lo que registró el sistema)"],
					[COLOR_PROYECCION, "Proyección (si no paga)"],
					[COLOR_SELECCIONADO, "Día seleccionado"],
				].map(([color, texto]) => (
					<span key={texto} className="flex items-center gap-1">
						<span
							className="inline-block h-2.5 w-2.5 rounded-sm"
							style={{ backgroundColor: color }}
						/>
						{texto}
					</span>
				))}
			</div>
		</>
	);
}
