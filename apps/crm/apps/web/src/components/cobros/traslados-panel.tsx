import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
	puedeRecibirTodosBuckets,
	resumirTraslado,
	validarFormularioTraslado,
} from "@/lib/cobros/traslados";
import { client, orpc, queryClient } from "@/utils/orpc";

type Preview = Awaited<ReturnType<typeof client.previsualizarTraslado>>;
type AsignacionPreview = Preview["asignaciones"][number] & {
	cliente?: string | null;
	estadoEspecial?:
		| "INCOBRABLE"
		| "CANCELADO"
		| "PENDIENTE_CANCELACION"
		| "CAIDO";
};
type ExcluidoPreview = Preview["excluidos"][number] & {
	numeroCreditoSifco?: string;
	cliente?: string | null;
	estado?: string;
};
export type AsesorTraslado = Awaited<
	ReturnType<typeof client.getAsesoresTraslados>
>[number];
export const selectClass =
	"h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50";

function descripcionEstadoEspecial(estado: string) {
	return (
		{
			INCOBRABLE: "Cuenta marcada para gestión no recuperable.",
			CANCELADO: "Crédito cerrado; se conserva para consulta e historial.",
			PENDIENTE_CANCELACION: "Cierre administrativo aún en proceso.",
			CAIDO: "Crédito dado de baja de cobranza activa.",
		}[estado] ?? "Cuenta sin bucket operativo."
	);
}

function agruparCuentasEspeciales(asignaciones: AsignacionPreview[]) {
	const grupos = new Map<
		string,
		{
			estado: NonNullable<AsignacionPreview["estadoEspecial"]>;
			asesorId: number;
			cuentas: number;
		}
	>();
	for (const asignacion of asignaciones) {
		if (!asignacion.estadoEspecial) continue;
		const key = `${asignacion.estadoEspecial}:${asignacion.asesorNuevoId}`;
		const actual = grupos.get(key);
		if (actual) {
			actual.cuentas++;
		} else {
			grupos.set(key, {
				estado: asignacion.estadoEspecial,
				asesorId: asignacion.asesorNuevoId,
				cuentas: 1,
			});
		}
	}
	return [...grupos.values()];
}

export function SelectorAsesor({
	id,
	value,
	onChange,
	asesores,
	disabled,
	permitirInactivo = false,
}: {
	id: string;
	value: string;
	onChange: (value: string) => void;
	asesores: AsesorTraslado[];
	disabled?: boolean;
	permitirInactivo?: boolean;
}) {
	return (
		<select
			id={id}
			className={selectClass}
			value={value}
			onChange={(e) => onChange(e.target.value)}
			disabled={disabled}
		>
			<option value="">Selecciona un asesor</option>
			{asesores
				.filter((a) => permitirInactivo || a.activo)
				.map((a) => (
					<option key={a.asesor_id} value={a.asesor_id}>
						{a.nombre}
						{!a.activo ? " (inactivo)" : ""}
						{a.buckets.length ? ` · B${a.buckets.join(", B")}` : " · sin pool"}
					</option>
				))}
		</select>
	);
}

export function EstadoConsulta({
	error,
	retry,
}: {
	error: boolean;
	retry: () => void;
}) {
	return error ? (
		<div role="alert" className="space-y-2 py-4 text-destructive text-sm">
			<p>No se pudieron cargar los datos. Intenta de nuevo.</p>
			<Button variant="outline" onClick={retry}>
				Reintentar
			</Button>
		</div>
	) : (
		<output className="block py-4 text-muted-foreground text-sm">
			Cargando…
		</output>
	);
}

async function refrescarTraslados() {
	await Promise.all(
		[
			orpc.getCreditosPorBucket.key(),
			orpc.getHistorialReasignaciones.key(),
			orpc.getCargaPorAsesorBucket.key(),
			orpc.listarTraslados.key(),
			orpc.getAgendaDia.key(),
			orpc.getColaDia.key(),
		].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
	);
}

export function TrasladosPanel() {
	const asesores = useQuery(orpc.getAsesoresTraslados.queryOptions());
	const [modo, setModo] = useState<
		"traslado_completo" | "redistribucion" | "destino_por_bucket"
	>("redistribucion");
	const [origen, setOrigen] = useState("");
	const [destino, setDestino] = useState("");
	const [destinoEspecial, setDestinoEspecial] = useState("");
	const [destinosPorBucket, setDestinosPorBucket] = useState<
		Record<number, string>
	>({});
	const [razon, setRazon] = useState("redistribucion");
	const [detalle, setDetalle] = useState("");
	const [preview, setPreview] = useState<Preview | null>(null);
	const [clave, setClave] = useState("");
	const [confirmando, setConfirmando] = useState(false);
	const [resultado, setResultado] = useState<Awaited<
		ReturnType<typeof client.confirmarTraslado>
	> | null>(null);
	const [page, setPage] = useState(1);
	const nombres = new Map(asesores.data?.map((a) => [a.asesor_id, a.nombre]));
	const origenSeleccionado = /^\d+$/.test(origen) && Number(origen) > 0;
	const cargaOrigen = useQuery({
		...orpc.getCargaPorAsesorBucket.queryOptions({
			input: { asesorId: Number(origen) },
		}),
		enabled: origenSeleccionado,
	});
	const cargaOrigenPendiente = origenSeleccionado && cargaOrigen.isPending;
	const bucketsOrigen = [
		...new Set(
			cargaOrigen.data?.porAsesor
				.find((asesor) => asesor.asesor_id === Number(origen))
				?.porBucket.map((bucket) => bucket.bucket) ?? [],
		),
	].sort((a, b) => a - b);
	const motivos: Record<string, string> = {
		redistribucion: "Redistribución operativa",
		despido: "Despido",
		renuncia: "Renuncia",
		otro: "Otro",
	};
	const motivo =
		razon === "otro"
			? detalle.trim()
			: `${motivos[razon]}${detalle.trim() ? `: ${detalle.trim()}` : ""}`;
	const requiereDestinoEspecial = razon === "despido" || razon === "renuncia";
	const errorFormulario = cargaOrigen.isError
		? "No se pudieron cargar los buckets de la cartera. Intenta de nuevo."
		: cargaOrigenPendiente
			? "Cargando buckets de la cartera…"
			: validarFormularioTraslado({
					modo,
					origen,
					destino,
					destinoEspecial,
					requiereDestinoEspecial,
					destinosPorBucket,
					bucketsOrigen,
					motivo,
				});
	const limpiar = () => {
		setPreview(null);
		setResultado(null);
		setPage(1);
	};
	const previsualizar = useMutation({
		mutationFn: () => {
			const solicitud = {
				asesorOrigenId: Number(origen),
				asesorDestinoId:
					modo === "traslado_completo" ? Number(destino) : undefined,
				destinosPorBucket:
					modo === "destino_por_bucket"
						? Object.fromEntries(
								Object.entries(destinosPorBucket).map(([bucket, asesorId]) => [
									bucket,
									Number(asesorId),
								]),
							)
						: undefined,
				modo,
				motivo,
			};
			if (destinoEspecial)
				Object.assign(solicitud, {
					asesorDestinoEspecialId: Number(destinoEspecial),
				});
			return client.previsualizarTraslado(solicitud);
		},
		onSuccess: (data) => {
			setPreview(data);
			setClave(crypto.randomUUID());
			setPage(1);
			setResultado(null);
		},
	});
	const confirmar = useMutation({
		retry: false,
		mutationFn: () => {
			if (!preview) throw new Error("Previsualiza la operación primero.");
			return client.confirmarTraslado({
				previewId: preview.previewId,
				idempotencyKey: clave,
			});
		},
		onSuccess: (data) => {
			setResultado(data);
			setPreview(null);
			setConfirmando(false);
			toast.success(`${data.cuentas} cuentas trasladadas`);
			void refrescarTraslados();
		},
		onError: (error: Error & { code?: string }) => {
			setConfirmando(false);
			if (error.code === "CONFLICT") setPreview(null);
		},
	});
	const ocupado = previsualizar.isPending || confirmar.isPending;
	// `vencido` se calcula en render, así que sin esto una previsualización
	// abierta y quieta seguía mostrando Confirmar habilitado después de su
	// hora: nada dispara un re-render al pasar el minuto. El backend igual la
	// rechaza (409), pero el usuario se lleva el error en vez de ver el botón
	// deshabilitado y el aviso de vencida.
	//
	// Un timeout ÚNICO al instante exacto del vencimiento, no un intervalo:
	// solo hace falta un re-render, justo cuando el valor cambia.
	const [, setTickVencimiento] = useState(0);
	useEffect(() => {
		if (!preview) return;
		const restante = new Date(preview.venceEn).getTime() - Date.now();
		if (restante <= 0) return;
		const id = setTimeout(() => setTickVencimiento((t) => t + 1), restante);
		return () => clearTimeout(id);
	}, [preview]);
	const vencido = preview
		? new Date(preview.venceEn).getTime() <= Date.now()
		: false;
	// Cliente oRPC conserva contrato previo durante desarrollo; backend envía este campo opcional.
	const asignacionesPreview = (preview?.asignaciones ??
		[]) as AsignacionPreview[];
	const excluidosPreview = (preview?.excluidos ?? []) as ExcluidoPreview[];
	const hayExcluidos = excluidosPreview.length > 0;
	const asignacionesOperativas = asignacionesPreview.filter(
		(asignacion) => !asignacion.estadoEspecial,
	);
	const asignacionesEspeciales = asignacionesPreview.filter(
		(asignacion) => asignacion.estadoEspecial,
	);
	const gruposEspeciales = agruparCuentasEspeciales(asignacionesEspeciales);
	const resumen = resumirTraslado(asignacionesOperativas);
	const totalPages = Math.max(1, Math.ceil(asignacionesOperativas.length / 25));
	return (
		<div className="space-y-4">
			<Card>
				<CardHeader>
					<CardTitle>Traslado masivo de cartera</CardTitle>
					<p className="text-muted-foreground text-sm">
						Revisa la distribución por asesor y bucket antes de confirmar. Los
						compromisos conservan sus condiciones.
					</p>
				</CardHeader>
				<CardContent className="space-y-4">
					{asesores.isPending || asesores.isError ? (
						<EstadoConsulta
							error={asesores.isError}
							retry={() => void asesores.refetch()}
						/>
					) : (
						<>
							<fieldset
								disabled={ocupado}
								className="grid gap-4 sm:grid-cols-2"
							>
								<div className="space-y-2">
									<Label htmlFor="traslado-modo">Distribución</Label>
									<select
										id="traslado-modo"
										className={selectClass}
										value={modo}
										onChange={(e) => {
											setModo(e.target.value as typeof modo);
											setDestino("");
											setDestinoEspecial("");
											setDestinosPorBucket({});
											limpiar();
										}}
									>
										<option value="redistribucion">
											Repartir entre asesores activos por bucket
										</option>
										<option value="traslado_completo">
											Trasladar a un solo asesor
										</option>
										<option value="destino_por_bucket">
											Asignar destino por bucket
										</option>
									</select>
								</div>
								<div className="space-y-2">
									<Label htmlFor="traslado-origen">Asesor de origen</Label>
									<SelectorAsesor
										id="traslado-origen"
										value={origen}
										onChange={(v) => {
											setOrigen(v);
											setDestino("");
											setDestinoEspecial("");
											setDestinosPorBucket({});
											limpiar();
										}}
										asesores={asesores.data ?? []}
										permitirInactivo
									/>
								</div>
								{modo === "traslado_completo" && (
									<div className="space-y-2">
										<Label htmlFor="traslado-destino">Asesor de destino</Label>
										<SelectorAsesor
											id="traslado-destino"
											value={destino}
											onChange={(v) => {
												setDestino(v);
												limpiar();
											}}
											asesores={(asesores.data ?? []).filter(
												(a) =>
													String(a.asesor_id) !== origen &&
													puedeRecibirTodosBuckets(bucketsOrigen, a.buckets),
											)}
											disabled={cargaOrigenPendiente}
										/>
									</div>
								)}
								{modo === "destino_por_bucket" && (
									<div className="space-y-3 sm:col-span-2">
										<Label>Destino por bucket</Label>
										{cargaOrigenPendiente ? (
											<p className="text-muted-foreground text-sm">
												Cargando buckets de la cartera…
											</p>
										) : bucketsOrigen.length ? (
											bucketsOrigen.map((bucket) => (
												<div
													key={bucket}
													className="grid items-center gap-2 sm:grid-cols-[8rem_1fr]"
												>
													<Label htmlFor={`traslado-destino-bucket-${bucket}`}>
														B{bucket}
													</Label>
													<SelectorAsesor
														id={`traslado-destino-bucket-${bucket}`}
														value={destinosPorBucket[bucket] ?? ""}
														onChange={(value) => {
															setDestinosPorBucket((actual) => ({
																...actual,
																[bucket]: value,
															}));
															limpiar();
														}}
														asesores={(asesores.data ?? []).filter(
															(asesor) =>
																asesor.activo &&
																asesor.asesor_id !== Number(origen) &&
																asesor.buckets.includes(bucket),
														)}
													/>
												</div>
											))
										) : (
											<p className="text-muted-foreground text-sm">
												Selecciona un asesor de origen para ver sus buckets.
											</p>
										)}
									</div>
								)}
								<div className="space-y-2 sm:col-span-2">
									<Label htmlFor="traslado-destino-especial">
										Responsable de cuentas sin bucket operativo
										{requiereDestinoEspecial ? "" : " (si aplica)"}
									</Label>
									<SelectorAsesor
										id="traslado-destino-especial"
										value={destinoEspecial}
										onChange={(v) => {
											setDestinoEspecial(v);
											limpiar();
										}}
										asesores={(asesores.data ?? []).filter(
											(a) =>
												a.activo &&
												a.buckets.length > 0 &&
												String(a.asesor_id) !== origen,
										)}
									/>
									<p className="text-muted-foreground text-xs">
										Estas cuentas conservan estado y no reciben bucket; solo
										cambia responsable. Si el origen tiene alguna, backend exige
										seleccionar responsable para confirmar.
									</p>
									<ul className="list-disc space-y-0.5 pl-4 text-muted-foreground text-xs">
										<li>
											Incobrable: cuenta marcada para gestión no recuperable.
										</li>
										<li>
											Cancelado: crédito cerrado, conservado para consulta e
											historial.
										</li>
										<li>
											Pendiente de cancelación: cierre administrativo aún en
											proceso.
										</li>
										<li>Caído: crédito dado de baja de cobranza activa.</li>
									</ul>
								</div>
								<div className="space-y-2">
									<Label htmlFor="traslado-motivo">Motivo</Label>
									<select
										id="traslado-motivo"
										className={selectClass}
										value={razon}
										onChange={(e) => {
											setRazon(e.target.value);
											limpiar();
										}}
									>
										{Object.entries(motivos).map(([v, texto]) => (
											<option key={v} value={v}>
												{texto}
											</option>
										))}
									</select>
								</div>
								<div className="space-y-2 sm:col-span-2">
									<Label htmlFor="traslado-detalle">
										Explicación{" "}
										{razon === "otro" ? "(obligatoria)" : "(opcional)"}
									</Label>
									<Textarea
										id="traslado-detalle"
										maxLength={900}
										value={detalle}
										onChange={(e) => {
											setDetalle(e.target.value);
											limpiar();
										}}
									/>
								</div>
							</fieldset>
							{errorFormulario && (
								<p className="text-muted-foreground text-sm">
									{errorFormulario}
								</p>
							)}
							<Button
								onClick={() => previsualizar.mutate()}
								disabled={!!errorFormulario || ocupado}
							>
								{previsualizar.isPending
									? "Calculando…"
									: "Previsualizar traslado"}
							</Button>
						</>
					)}
					{previsualizar.error && (
						<p role="alert" className="text-destructive text-sm">
							{previsualizar.error.message}
						</p>
					)}
					{confirmar.error && (
						<p role="alert" className="text-destructive text-sm">
							{confirmar.error.message} Si hubo un problema de conexión, puedes
							reintentar la misma confirmación.
						</p>
					)}
					{resultado && (
						<output className="block rounded-md border p-4 text-sm">
							<p className="font-medium">
								Traslado confirmado: {resultado.cuentas} cuentas.
							</p>
							<p className="break-all text-muted-foreground">
								Operación {resultado.operacionId}
							</p>
						</output>
					)}
				</CardContent>
			</Card>
			{preview && (
				<Card>
					<CardHeader>
						<CardTitle>Revisión del reparto</CardTitle>
						<p className="text-muted-foreground text-sm">
							{asignacionesOperativas.length} cuentas operativas ·{" "}
							{asignacionesOperativas.filter((a) => a.prioridad === 0).length}{" "}
							con compromiso vigente · {excluidosPreview.length} sin destino
						</p>
						<p className="text-muted-foreground text-xs">
							Puedes confirmar este reparto hasta las{" "}
							{new Date(preview.venceEn).toLocaleTimeString("es-GT", {
								timeZone: "America/Guatemala",
							})}{" "}
							(Guatemala). Después deberás volver a previsualizar para evitar
							aplicar una distribución desactualizada.
						</p>
					</CardHeader>
					<CardContent className="space-y-4">
						{preview.bloqueos.length > 0 && (
							<div
								role="alert"
								className="rounded-md border border-destructive p-3 text-sm"
							>
								<p className="font-semibold">
									No se puede confirmar: {preview.bloqueos.length} cuentas sin
									destino válido.
								</p>
								<ul className="max-h-36 overflow-auto">
									{preview.bloqueos.map((b) => (
										<li key={b.creditoId}>
											Crédito {b.creditoId} · B{b.bucket}:{" "}
											{b.razon === "destino_no_elegible"
												? "El destino no cubre este bucket"
												: b.razon === "destino_no_configurado"
													? "No se eligió destino para este bucket"
													: "No hay otro asesor elegible"}
										</li>
									))}
								</ul>
							</div>
						)}
						{!asignacionesPreview.length && (
							<p>No hay cuentas disponibles para trasladar.</p>
						)}
						{asignacionesEspeciales.length > 0 && (
							<div className="rounded-md border border-amber-300 bg-amber-50 p-4 dark:bg-amber-950/20">
								<p className="font-semibold">Cuentas sin bucket operativo</p>
								<p className="mb-3 text-muted-foreground text-sm">
									Se cambia responsable, se conserva estado y no se suma a carga
									ni capacidad.
								</p>
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Estado</TableHead>
											<TableHead>Descripción</TableHead>
											<TableHead>Cuentas</TableHead>
											<TableHead>Se asignarán a</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{gruposEspeciales.map((grupo) => (
											<TableRow key={`${grupo.estado}:${grupo.asesorId}`}>
												<TableCell className="font-medium">
													{grupo.estado.replaceAll("_", " ")}
												</TableCell>
												<TableCell>
													{descripcionEstadoEspecial(grupo.estado)}
												</TableCell>
												<TableCell>{grupo.cuentas}</TableCell>
												<TableCell>
													{nombres.get(grupo.asesorId) ?? grupo.asesorId}
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
								<details className="mt-3 rounded-md border bg-background/70 p-3">
									<summary className="cursor-pointer font-medium text-sm">
										Ver {asignacionesEspeciales.length} créditos
									</summary>
									<div className="mt-3 max-h-72 overflow-auto">
										<Table>
											<TableHeader>
												<TableRow>
													<TableHead>Crédito / cliente</TableHead>
													<TableHead>Estado</TableHead>
													<TableHead>Se asignará a</TableHead>
												</TableRow>
											</TableHeader>
											<TableBody>
												{asignacionesEspeciales.map((cuenta) => (
													<TableRow key={cuenta.creditoId}>
														<TableCell>
															{cuenta.numeroCreditoSifco ? (
																<Link
																	to="/cobros/$id"
																	params={{ id: cuenta.numeroCreditoSifco }}
																	search={{ tipo: "caso" }}
																	className="font-medium text-primary hover:underline"
																>
																	{cuenta.numeroCreditoSifco}
																</Link>
															) : (
																<p>{cuenta.creditoId}</p>
															)}
															<p className="text-muted-foreground text-xs">
																{cuenta.cliente ?? "Cliente sin nombre"}
															</p>
														</TableCell>
														<TableCell>
															{cuenta.estadoEspecial?.replaceAll("_", " ")}
														</TableCell>
														<TableCell>
															{nombres.get(cuenta.asesorNuevoId) ??
																cuenta.asesorNuevoId}
														</TableCell>
													</TableRow>
												))}
											</TableBody>
										</Table>
									</div>
								</details>
							</div>
						)}
						{hayExcluidos && (
							<div
								role="alert"
								className="rounded-md border border-destructive p-4"
							>
								<p className="font-semibold">Créditos sin destino</p>
								<p className="mb-3 text-muted-foreground text-sm">
									No se puede confirmar hasta asignar bucket operativo a estas
									cuentas.
								</p>
								<div className="max-h-56 overflow-auto">
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Crédito / cliente</TableHead>
												<TableHead>Estado</TableHead>
												<TableHead>Qué ocurrirá</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{excluidosPreview.map((excluido) => (
												<TableRow key={excluido.creditoId}>
													<TableCell>
														{excluido.numeroCreditoSifco ? (
															<Link
																to="/cobros/$id"
																params={{ id: excluido.numeroCreditoSifco }}
																search={{ tipo: "caso" }}
																className="font-medium text-primary hover:underline"
															>
																{excluido.numeroCreditoSifco}
															</Link>
														) : (
															<p>{excluido.creditoId}</p>
														)}
														<p className="text-muted-foreground text-xs">
															{excluido.cliente ?? "Cliente sin nombre"}
														</p>
													</TableCell>
													<TableCell>
														{excluido.estado?.replaceAll("_", " ") ??
															"Sin bucket"}
													</TableCell>
													<TableCell>
														No se trasladará hasta asignar bucket operativo.
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</div>
							</div>
						)}
						<div className="overflow-x-auto">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Receptor</TableHead>
										<TableHead>Bucket</TableHead>
										<TableHead>Cuentas</TableHead>
										<TableHead>Compromisos</TableHead>
										<TableHead>Carga antes → después</TableHead>
										<TableHead>Capacidad</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{resumen.map((r) => {
										const carga = preview.carga.find(
											(c) => c.bucket === r.bucket && c.asesorId === r.asesorId,
										);
										return (
											<TableRow key={`${r.bucket}:${r.asesorId}`}>
												<TableCell>
													{nombres.get(r.asesorId) ?? r.asesorId}
												</TableCell>
												<TableCell>
													{r.bucket === null
														? "Sin bucket operativo"
														: `B${r.bucket}`}
												</TableCell>
												<TableCell>{r.cuentas}</TableCell>
												<TableCell>{r.compromisos}</TableCell>
												<TableCell>
													{carga ? `${carga.antes} → ${carga.despues}` : "—"}
												</TableCell>
												<TableCell>
													{carga?.capacidad ?? "—"}{" "}
													{carga && carga.despues > carga.capacidad && (
														<Badge variant="destructive">Sobrecarga</Badge>
													)}
												</TableCell>
											</TableRow>
										);
									})}
								</TableBody>
							</Table>
						</div>
						<div className="overflow-x-auto">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Crédito / cliente</TableHead>
										<TableHead>Origen</TableHead>
										<TableHead>Destino</TableHead>
										<TableHead>Bucket</TableHead>
										<TableHead>Compromiso</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{asignacionesOperativas
										.slice((page - 1) * 25, page * 25)
										.map((a) => (
											<TableRow key={a.creditoId}>
												<TableCell>
													{a.numeroCreditoSifco ? (
														<Link
															to="/cobros/$id"
															params={{ id: a.numeroCreditoSifco }}
															search={{ tipo: "caso" }}
															className="font-medium text-primary hover:underline"
														>
															{a.numeroCreditoSifco}
														</Link>
													) : (
														<p>{a.creditoId}</p>
													)}
													<p className="text-muted-foreground text-xs">
														{a.cliente ?? "Cliente sin nombre"}
													</p>
												</TableCell>
												<TableCell>
													{a.asesorAnteriorId
														? (nombres.get(a.asesorAnteriorId) ??
															a.asesorAnteriorId)
														: "Sin asesor"}
												</TableCell>
												<TableCell>
													{nombres.get(a.asesorNuevoId) ?? a.asesorNuevoId}
												</TableCell>
												<TableCell>
													{a.bucket === null
														? "Sin bucket operativo"
														: `B${a.bucket}`}
												</TableCell>
												<TableCell>
													{a.prioridad === 0 ? "Vigente" : "—"}
												</TableCell>
											</TableRow>
										))}
								</TableBody>
							</Table>
						</div>
						<div className="flex flex-wrap items-center justify-between gap-2 text-sm">
							<span>
								Página {page} de {totalPages}
							</span>
							<div className="flex gap-2">
								<Button
									variant="outline"
									disabled={page <= 1}
									onClick={() => setPage((p) => p - 1)}
								>
									Anterior
								</Button>
								<Button
									variant="outline"
									disabled={page >= totalPages}
									onClick={() => setPage((p) => p + 1)}
								>
									Siguiente
								</Button>
							</div>
						</div>
						<Button
							disabled={
								ocupado ||
								vencido ||
								hayExcluidos ||
								!!preview.bloqueos.length ||
								!preview.asignaciones.length
							}
							onClick={() => setConfirmando(true)}
						>
							Confirmar {preview.asignaciones.length} cuentas
						</Button>
						{vencido && (
							<p role="alert" className="text-destructive text-sm">
								La previsualización venció. Calcula el reparto nuevamente.
							</p>
						)}
					</CardContent>
				</Card>
			)}
			<AlertDialog
				open={confirmando}
				onOpenChange={(v) => !confirmar.isPending && setConfirmando(v)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Confirmar traslado permanente</AlertDialogTitle>
						<AlertDialogDescription>
							Se cambiará el responsable de {preview?.asignaciones.length ?? 0}{" "}
							cuentas de {nombres.get(Number(origen))}. Motivo: {motivo}. Cada
							cambio quedará en el historial.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={confirmar.isPending}>
							Volver
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={confirmar.isPending || vencido}
							onClick={(e) => {
								e.preventDefault();
								confirmar.mutate();
							}}
						>
							{confirmar.isPending ? "Confirmando…" : "Confirmar traslado"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

export function HistorialTrasladosPanel() {
	const [page, setPage] = useState(1);
	const query = useQuery(
		orpc.listarTraslados.queryOptions({ input: { page } }),
	);
	const asesores = useQuery(orpc.getAsesoresTraslados.queryOptions());
	return (
		<Card>
			<CardHeader>
				<CardTitle>Operaciones de traslado</CardTitle>
			</CardHeader>
			<CardContent>
				{query.isPending || query.isError ? (
					<EstadoConsulta
						error={query.isError}
						retry={() => void query.refetch()}
					/>
				) : !query.data.length ? (
					<p className="py-4 text-sm">Sin operaciones en esta página.</p>
				) : (
					<div className="overflow-x-auto">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Fecha (Guatemala)</TableHead>
									<TableHead>Origen</TableHead>
									<TableHead>Cuentas</TableHead>
									<TableHead>Motivo</TableHead>
									<TableHead>Usuario</TableHead>
									<TableHead>Operación</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{query.data.map((r) => (
									<TableRow key={r.id}>
										<TableCell>
											{new Date(r.created_at).toLocaleString("es-GT", {
												timeZone: "America/Guatemala",
											})}
										</TableCell>
										<TableCell>
											{asesores.data?.find(
												(a) => a.asesor_id === r.asesor_origen_id,
											)?.nombre ?? r.asesor_origen_id}
										</TableCell>
										<TableCell>{r.cuentas}</TableCell>
										<TableCell>{r.motivo}</TableCell>
										<TableCell>{r.actor_email}</TableCell>
										<TableCell className="break-all text-xs">{r.id}</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				)}
				<div className="mt-4 flex items-center justify-between gap-2">
					<span className="text-sm">Página {page}</span>
					<div className="flex gap-2">
						<Button
							variant="outline"
							disabled={page === 1 || query.isFetching}
							onClick={() => setPage((p) => p - 1)}
						>
							Anterior
						</Button>
						<Button
							variant="outline"
							disabled={
								query.isFetching ||
								query.isError ||
								(query.data?.length ?? 0) < 20
							}
							onClick={() => setPage((p) => p + 1)}
						>
							Siguiente
						</Button>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
