import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, Car, Loader2 } from "lucide-react";
import { BarraPasos } from "@/components/barra-pasos";
import { ESTADOS, formatearFecha, formatearMonto } from "@/lib/pasos";
import { cn } from "@/lib/utils";
import { orpc } from "@/utils/orpc";

export function CasoPage() {
	const { id } = useParams({ from: "/caso/$id" });
	const casoQuery = useQuery(orpc.getCasoById.queryOptions({ input: { id } }));

	return (
		<div className="min-h-screen bg-slate-50">
			<header className="border-slate-200 border-b bg-white">
				<div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-4">
					<Link
						to="/"
						className="flex items-center gap-1.5 text-slate-600 text-sm transition hover:text-slate-900"
					>
						<ArrowLeft className="h-4 w-4" />
						Volver
					</Link>
				</div>
			</header>

			<main className="mx-auto max-w-2xl px-4 py-5">
				{casoQuery.isPending ? (
					<div className="flex items-center justify-center py-16 text-slate-500">
						<Loader2 className="mr-2 h-5 w-5 animate-spin" />
						Cargando caso...
					</div>
				) : casoQuery.isError ? (
					<div className="rounded-xl border border-slate-200 bg-white py-16 text-center">
						<p className="font-medium text-slate-900">
							No se pudo cargar este caso
						</p>
						<p className="mt-1 text-slate-500 text-sm">
							{casoQuery.error.message}
						</p>
					</div>
				) : casoQuery.data ? (
					<div className="space-y-4">
						<section className="rounded-xl border border-slate-200 bg-white p-5">
							<div className="flex items-start justify-between gap-3">
								<div className="min-w-0">
									<p className="font-mono text-slate-400 text-xs">
										{casoQuery.data.referencia}
									</p>
									<p className="mt-0.5 font-medium text-slate-500 text-xs">
										{casoQuery.data.agencia}
									</p>
									<h1 className="mt-1 font-bold text-slate-900 text-xl">
										{casoQuery.data.vehiculo ?? casoQuery.data.cliente}
									</h1>
									{casoQuery.data.vehiculo && (
										<p className="text-slate-600 text-sm">
											{casoQuery.data.cliente}
										</p>
									)}
								</div>
								<span
									className={cn(
										"inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-xs ring-1 ring-inset",
										ESTADOS[casoQuery.data.estado].clase,
									)}
								>
									<span
										className={cn(
											"h-1.5 w-1.5 rounded-full",
											ESTADOS[casoQuery.data.estado].punto,
										)}
									/>
									{ESTADOS[casoQuery.data.estado].etiqueta}
								</span>
							</div>

							<dl className="mt-4 grid grid-cols-2 gap-4 border-slate-100 border-t pt-4 sm:grid-cols-3">
								<div>
									<dt className="text-slate-500 text-xs">Avance</dt>
									<dd className="mt-0.5 font-semibold text-slate-900 tabular-nums">
										{casoQuery.data.porcentaje}%
									</dd>
								</div>
								{casoQuery.data.valorVehiculo !== null && (
									<div>
										<dt className="text-slate-500 text-xs">Valor del vehículo</dt>
										<dd className="mt-0.5 font-semibold text-slate-900">
											{formatearMonto(casoQuery.data.valorVehiculo)}
										</dd>
									</div>
								)}
								<div>
									<dt className="text-slate-500 text-xs">Actualizado</dt>
									<dd className="mt-0.5 font-semibold text-slate-900">
										{formatearFecha(casoQuery.data.actualizadoAt)}
									</dd>
								</div>
							</dl>

							{!casoQuery.data.vehiculo && (
								<p className="mt-4 flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-slate-600 text-xs">
									<Car className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
									El vehículo se registra más adelante en el proceso, cuando se
									formaliza la compra.
								</p>
							)}
						</section>

						<section className="rounded-xl border border-slate-200 bg-white p-5">
							<h2 className="mb-4 font-semibold text-slate-900">
								Etapa del proceso
							</h2>
							<BarraPasos
								pasoActual={casoQuery.data.pasoActual}
								porcentaje={casoQuery.data.porcentaje}
								estado={casoQuery.data.estado}
								historial={casoQuery.data.historial}
							/>
						</section>
					</div>
				) : null}
			</main>
		</div>
	);
}
