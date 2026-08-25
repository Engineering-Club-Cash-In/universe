import { Check, X } from "lucide-react";
import { type Caso, PASOS, formatearFecha, rangoDePaso } from "@/lib/pasos";
import { cn } from "@/lib/utils";

type Props = {
	pasoActual: number;
	porcentaje: number;
	estado: Caso["estado"];
	historial?: Caso["historial"];
	compacta?: boolean;
};

export function BarraPasos({
	pasoActual,
	porcentaje,
	estado,
	historial,
	compacta,
}: Props) {
	const rechazado = estado === "rechazado";
	const enPausa = estado === "en_pausa";

	const colorActivo = rechazado
		? "bg-rose-500"
		: enPausa
			? "bg-amber-500"
			: "bg-emerald-500";

	if (compacta) {
		return (
			<div
				className="flex gap-1"
				aria-label={`Paso ${pasoActual} de 5, ${porcentaje}% de avance`}
			>
				{PASOS.map((p, i) => (
					<span
						key={p.etiqueta}
						className={cn(
							"h-1.5 flex-1 rounded-full",
							i < pasoActual ? colorActivo : "bg-slate-200",
						)}
					/>
				))}
			</div>
		);
	}

	const entradasDe = (paso: number) =>
		(historial ?? []).filter((h) => h.paso === paso);

	return (
		<ol className="space-y-0">
			{PASOS.map((p, i) => {
				const paso = i + 1;
				const alcanzado = paso <= pasoActual;
				const esActual = paso === pasoActual;
				const entradas = entradasDe(paso);
				const ultimo = paso === PASOS.length;

				return (
					<li key={p.etiqueta} className="flex gap-4">
						<div className="flex flex-col items-center">
							<span
								className={cn(
									"flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-semibold text-xs",
									alcanzado
										? cn(colorActivo, "text-white")
										: "bg-slate-200 text-slate-500",
									esActual && !rechazado && "ring-4 ring-emerald-100",
									esActual && rechazado && "ring-4 ring-rose-100",
								)}
							>
								{rechazado && esActual ? (
									<X className="h-4 w-4" />
								) : alcanzado && !esActual ? (
									<Check className="h-4 w-4" />
								) : (
									paso
								)}
							</span>
							{!ultimo && (
								<span
									className={cn(
										"my-1 w-0.5 flex-1",
										paso < pasoActual ? colorActivo : "bg-slate-200",
									)}
								/>
							)}
						</div>

						<div className={cn("min-w-0 flex-1 pb-6", ultimo && "pb-0")}>
							<div className="flex items-baseline justify-between gap-3">
								<p
									className={cn(
										"font-medium text-sm",
										alcanzado ? "text-slate-900" : "text-slate-400",
									)}
								>
									{p.etiqueta}
								</p>
								<span
									className={cn(
										"shrink-0 font-mono text-xs",
										alcanzado ? "text-slate-500" : "text-slate-300",
									)}
								>
									{rangoDePaso(paso)}
								</span>
							</div>

							{entradas.length > 0 && (
								<ul className="mt-1.5 space-y-1">
									{entradas.map((entrada) => {
										const esAvanceActual =
											esActual && entrada.porcentaje === porcentaje;
										return (
											<li
												key={entrada.porcentaje}
												className="flex items-baseline gap-2 text-xs"
											>
												<span
													className={cn(
														"w-9 shrink-0 rounded px-1 py-0.5 text-center font-mono tabular-nums",
														esAvanceActual
															? cn(colorActivo, "font-semibold text-white")
															: "bg-slate-100 text-slate-600",
													)}
												>
													{entrada.porcentaje}%
												</span>
												<span className="text-slate-500">
													{formatearFecha(entrada.fecha)}
												</span>
												{esAvanceActual && (
													<span className="font-medium text-slate-700">
														· avance actual
													</span>
												)}
											</li>
										);
									})}
								</ul>
							)}

							{esActual && !entradas.some((e) => e.porcentaje === porcentaje) && (
								<p className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700 text-xs">
									Avance actual: {porcentaje}%
								</p>
							)}

							{esActual && (
								<p className="mt-1.5 text-slate-500 text-xs">
									{rechazado
										? "El crédito no fue aprobado"
										: enPausa
											? "El proceso está en pausa"
											: "En curso"}
								</p>
							)}
						</div>
					</li>
				);
			})}
		</ol>
	);
}
