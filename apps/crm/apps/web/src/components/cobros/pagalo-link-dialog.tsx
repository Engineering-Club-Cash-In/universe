import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangle,
	CheckCircle2,
	Copy,
	CreditCard,
	Loader2,
	RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { deduplicarCuotasPagalo } from "server/src/lib/pagalo-installments";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { authClient } from "@/lib/auth-client";
import {
	copyPagaloLink,
	getPagaloGroupSummary,
	getPagaloLinkStatusInfo,
	previewMensajePagaloLinks,
} from "@/lib/cobros/pagalo-link-display";
import { parseOtrosGTQ } from "@/lib/cobros/pagalo-otros";
import { PERMISSIONS } from "@/lib/roles";
import { client, orpc } from "@/utils/orpc";

const q = (value: unknown) =>
	new Intl.NumberFormat("es-GT", { style: "currency", currency: "GTQ" }).format(
		Number(value ?? 0),
	);

export function PagaloLinkDialog({
	casoCobroId,
	numeroSifco,
	creditoId,
	open: openControlado,
	onOpenChange,
	mostrarTrigger = true,
}: {
	casoCobroId: string;
	numeroSifco: string;
	creditoId: number;
	/**
	 * Abierto desde afuera (hoy: la opción "Generar links de pago" del botón
	 * Registrar Pago). Sin estas props el diálogo se maneja solo con su propio
	 * trigger, como antes.
	 */
	open?: boolean;
	onOpenChange?: (abierto: boolean) => void;
	mostrarTrigger?: boolean;
}) {
	const [openInterno, setOpenInterno] = useState(false);
	const controlado = openControlado !== undefined;
	const open = controlado ? openControlado : openInterno;
	const setOpen = (siguiente: boolean) => {
		if (!controlado) setOpenInterno(siguiente);
		onOpenChange?.(siguiente);
	};
	const [selected, setSelected] = useState<number[]>([]);
	const [otrosActivo, setOtrosActivo] = useState(false);
	const [otrosMonto, setOtrosMonto] = useState("");
	const grupoActivo = useQuery({
		...orpc.getPagaloGrupoActivo.queryOptions({
			input: { casoCobroId, creditoId },
		}),
		enabled: open,
	});
	// Misma fuente que usa createPagaloLinks para el identificador del mensaje
	// real (contratosFinanciamiento.vehicleId) — no la del header del caso
	// (opportunities.vehicleId), que puede apuntar a otro vehículo en
	// créditos refinanciados u oportunidades desactualizadas.
	const vehiculoCaso = useQuery({
		...orpc.getVehiculoCasoPagalo.queryOptions({ input: { casoCobroId } }),
		enabled: open,
	});
	const credit = useQuery({
		...orpc.getCreditoParaPago.queryOptions({ input: { numeroSifco } }),
		enabled:
			open && !!numeroSifco && grupoActivo.isSuccess && !grupoActivo.data,
	});
	const data = credit.data as any;
	const cuotas = useMemo(() => {
		const vencidas = deduplicarCuotasPagalo(data?.cuotasAtrasadas ?? [])
			.filter((cuota: any) => cuota.numero_cuota > 0)
			.sort((a: any, b: any) => a.numero_cuota - b.numero_cuota);
		// cuotasPendientes es "todas las no pagadas" (sin filtro de fecha), no
		// "solo próximas" — ya incluye las vencidas. Sin excluirlas acá, [0]
		// cae siempre en la misma cuota que ya está en `vencidas` y la cuota
		// vigente real nunca se ofrece.
		const proxima = deduplicarCuotasPagalo(data?.cuotasPendientes ?? [])
			.filter(
				(cuota: any) =>
					cuota.numero_cuota > 0 &&
					!vencidas.some((v: any) => v.numero_cuota === cuota.numero_cuota),
			)
			.sort((a: any, b: any) => a.numero_cuota - b.numero_cuota)[0];
		return deduplicarCuotasPagalo(
			proxima ? [...vencidas, proxima] : vencidas,
		).map((cuota: any) => ({
			...cuota,
			esActual: proxima?.cuota_id === cuota.cuota_id,
			esProxima: vencidas.length === 0 && proxima?.cuota_id === cuota.cuota_id,
		}));
	}, [data]);
	useEffect(() => {
		if (open && credit.isSuccess)
			setSelected(cuotas.map((cuota: any) => cuota.cuota_id));
	}, [open, credit.isSuccess, cuotas]);
	const tieneMora = Number(data?.moraActual ?? 0) > 0;
	// Mismo criterio que identificadorCredito en pagalo-link-orchestrator.ts:
	// vehículo (marca modelo año · placa) si está cargado, si no crédito+SIFCO.
	const vehiculo = vehiculoCaso.data as any;
	const identificadorCredito =
		vehiculo?.vehiculoMarca && vehiculo?.vehiculoPlaca
			? `vehículo ${[vehiculo.vehiculoMarca, vehiculo.vehiculoModelo, vehiculo.vehiculoYear].filter(Boolean).join(" ")} · ${vehiculo.vehiculoPlaca}`
			: `crédito ${numeroSifco}`;
	const otrosParseado = useMemo(
		() => (otrosActivo ? parseOtrosGTQ(otrosMonto) : null),
		[otrosActivo, otrosMonto],
	);
	const preview = useMemo(() => {
		const seleccionadas = cuotas.filter((cuota: any) =>
			selected.includes(cuota.cuota_id),
		);
		const capital = seleccionadas.reduce(
			(sum: number, cuota: any) => sum + Number(cuota.capital_restante ?? 0),
			0,
		);
		const facturableCuotas = seleccionadas.reduce(
			(sum: number, cuota: any) =>
				sum +
				Number(cuota.interes_restante ?? 0) +
				Number(cuota.iva_12_restante ?? 0) +
				Number(cuota.seguro_restante ?? 0) +
				Number(cuota.gps_restante ?? 0) +
				Number(cuota.membresias_restante ?? 0),
			0,
		);
		const mora = tieneMora ? Number(data?.moraActual ?? 0) : 0;
		const otros = otrosParseado?.valid ? Number(otrosParseado.value) : 0;
		const facturable = facturableCuotas + mora + otros;
		return { capital, facturable, otros, total: capital + facturable };
	}, [cuotas, selected, tieneMora, data, otrosParseado]);
	const queryClient = useQueryClient();
	const mutation = useMutation({
		mutationFn: (input: {
			casoCobroId: string;
			numeroSifco: string;
			creditoId: number;
			cuotaIds: number[];
			otros?: string;
		}) => (client as any).crearLinksPagalo(input),
		onSuccess: (result: any) => {
			// .key() = prefijo del path → invalida TODAS las páginas del
			// historial, que ahora va por crédito y paginado.
			queryClient.invalidateQueries({
				queryKey: orpc.getPagaloHistorial.key(),
			});
			queryClient.invalidateQueries(
				orpc.getPagaloGrupoActivo.queryOptions({
					input: { casoCobroId, creditoId },
				}),
			);
			if (result.status === "REVIEW_REQUIRED")
				toast.error("Grupo Págalo existente requiere revisión.");
			else if (result.origen === "BOT")
				toast.info(
					"El cliente ya generó estos links desde WhatsApp; se muestran los mismos.",
				);
			else if (result.whatsappEnviado === null)
				// Grupo ya existía (reintento u otro asesor) — no se intentó un
				// envío nuevo, pero pudo haberse enviado en la creación original.
				// No instruir a reenviar manualmente para no duplicar el mensaje.
				toast.info(
					`Ya existían links Págalo para este crédito: ${q(result.totalAmount)}.`,
				);
			else if (result.whatsappEnviado)
				toast.success(
					`Links Págalo listos: ${q(result.totalAmount)}. Se envió el mensaje por WhatsApp al cliente.`,
				);
			else
				toast.success(
					`Links Págalo listos: ${q(result.totalAmount)}. No se pudo enviar el WhatsApp al cliente, compartí el link manualmente.`,
				);
		},
		onError: (error: Error) =>
			toast.error(error.message || "No se pudieron crear links Págalo"),
	});
	const grupoPendiente = grupoActivo.data as any;
	const linksRecienCreados = mutation.data?.links ?? [];
	const links =
		linksRecienCreados.length > 0
			? linksRecienCreados
			: (grupoPendiente?.links ?? []);
	const reviewRequired =
		mutation.data?.status === "REVIEW_REQUIRED" ||
		grupoPendiente?.status === "REVIEW_REQUIRED";
	const totalPendiente = grupoPendiente?.totalAmount;
	// Resumen del grupo para la cabecera. Cuando los links vienen de una
	// creación recién hecha todavía no hay grupo cargado, así que el total se
	// arma de los propios links.
	const linksPagados = links.filter(
		(link: any) => link.status === "PAID",
	).length;
	const totalGrupo =
		totalPendiente ??
		links.reduce(
			(suma: number, link: any) => suma + Number(link.amount ?? 0),
			0,
		);
	const montoCobrado = links
		.filter((link: any) => link.status === "PAID")
		.reduce((suma: number, link: any) => suma + Number(link.amount ?? 0), 0);
	const fechaGrupo = grupoPendiente?.createdAt
		? new Date(grupoPendiente.createdAt).toLocaleString("es-GT", {
				day: "numeric",
				month: "short",
				year: "numeric",
				hour: "2-digit",
				minute: "2-digit",
			})
		: null;
	const toggle = (id: number) =>
		setSelected((current) => {
			const index = cuotas.findIndex((cuota: any) => cuota.cuota_id === id);
			if (index < 0) return current;
			return current.includes(id)
				? cuotas.slice(0, index).map((cuota: any) => cuota.cuota_id)
				: cuotas.slice(0, index + 1).map((cuota: any) => cuota.cuota_id);
		});
	const todasSeleccionadas =
		cuotas.length > 0 && selected.length === cuotas.length;
	const toggleTodas = () =>
		setSelected(
			todasSeleccionadas ? [] : cuotas.map((cuota: any) => cuota.cuota_id),
		);
	// PRUEBA: dispara un ciclo del poller Págalo a demanda, sin esperar el
	// setInterval de 5 min. Con poller+dispatch unificados, un solo click
	// alcanza para llevar un link pagado hasta COMPLETED. Borrar junto con
	// el procedure probarPollPagalo cuando el ciclo automático esté probado.
	const pollMutation = useMutation({
		mutationFn: () => (client as any).probarPollPagalo(),
		onSuccess: (result: any) => {
			// .key() = prefijo del path → invalida TODAS las páginas del
			// historial, que ahora va por crédito y paginado.
			queryClient.invalidateQueries({
				queryKey: orpc.getPagaloHistorial.key(),
			});
			queryClient.invalidateQueries(
				orpc.getPagaloGrupoActivo.queryOptions({
					input: { casoCobroId, creditoId },
				}),
			);
			// linksRecienCreados (snapshot de mutation.data) tiene prioridad sobre
			// el estado fresco de grupoActivo mientras el modal siga abierto —
			// sin este reset, un link marcado pagado por el poll seguiría
			// mostrándose ACTIVE/copiable acá (hallazgo de Codex, PR #1477).
			mutation.reset();
			console.log("[Págalo] resultado del poll:", result);
			toast.success(
				`Poll: ${result.pagados} pagado(s), ${result.errores} error(es). Dispatch: ${result.dispatchCompletados} completado(s), ${result.dispatchErrores} error(es). Revisa la consola.`,
			);
		},
		onError: (error: Error) =>
			toast.error(error.message || "Falló correr el poll de Págalo"),
	});
	// CB-127: probarPollPagalo pasó a cobrosSupervisorProcedure — el botón
	// era visible para cualquier asesor sin gate, y disparaba el poller
	// ENTERO (todos los links pendientes de todos los casos), no solo los
	// de este caso puntual.
	const { data: session } = authClient.useSession();
	const esSupervisor = PERMISSIONS.canAssignCobros(session?.user?.role ?? "");

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) {
					setSelected([]);
					setOtrosActivo(false);
					setOtrosMonto("");
					mutation.reset();
				}
			}}
		>
			{mostrarTrigger && (
				<DialogTrigger asChild>
					<Button variant="outline" className="gap-2">
						<CreditCard className="h-4 w-4 text-violet-600" />
						Generar links Págalo
					</Button>
				</DialogTrigger>
			)}
			<DialogContent className="flex max-h-[90vh] max-w-3xl flex-col overflow-hidden">
				<DialogHeader>
					<DialogTitle>Links de pago Págalo</DialogTitle>
					<DialogDescription>
						{/* Abrir el modal y encontrarse la lista en vez del selector se
						    lee como un error: hay que decir por qué no se está eligiendo
						    cuotas. Los recién creados ya se anuncian abajo. */}
						{links.length > 0 && linksRecienCreados.length === 0
							? "Este crédito ya tiene links de pago generados. Se muestran los existentes; no se pueden crear nuevos hasta que se paguen o se cancelen."
							: "Sandbox. Capital y mora/intereses salen en links separados. Links no expiran."}
					</DialogDescription>
				</DialogHeader>
				<div className="min-h-0 flex-1 overflow-y-auto pr-1">
					{grupoActivo.isError ? (
						<div className="flex flex-col items-center gap-3 py-8 text-center">
							<p className="text-muted-foreground text-sm">
								No se pudo verificar si este crédito ya tiene links de pago.
							</p>
							<Button
								type="button"
								size="sm"
								variant="outline"
								onClick={() => grupoActivo.refetch()}
							>
								Reintentar
							</Button>
						</div>
					) : grupoActivo.isLoading ||
						(grupoActivo.isSuccess &&
							!grupoActivo.data &&
							(credit.isLoading || vehiculoCaso.isLoading)) ? (
						<div className="flex justify-center py-8">
							<Loader2 className="animate-spin" />
						</div>
					) : links.length > 0 ? (
						<div className="space-y-5">
							{/* Resumen del grupo. Antes las tres tarjetas pesaban igual y
							    el total —el dato que el asesor busca primero— se perdía
							    entre los links. Acá manda el monto y el avance del cobro. */}
							<div className="rounded-xl border border-violet-200 bg-violet-50/60 p-5 dark:border-violet-900 dark:bg-violet-950/30">
								<div className="flex items-start justify-between gap-4">
									<div className="min-w-0">
										<p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
											{reviewRequired ? "Grupo en revisión" : "Total del grupo"}
										</p>
										<p className="mt-1 font-semibold text-3xl tabular-nums">
											{q(totalGrupo)}
										</p>
										{fechaGrupo && (
											<p className="mt-1 text-muted-foreground text-xs">
												Creado el {fechaGrupo}
											</p>
										)}
									</div>
									{/* Temporal: fuerza el ciclo del poller sin esperar los 5
									    min. Vive acá —discreto, junto al estado que refresca—
									    en vez de encabezar el modal como si fuera la acción
									    principal. Solo supervisores (CB-127): dispara el poller
									    ENTERO, no solo los links de este caso. Borrar junto con
									    probarPollPagalo. */}
									{esSupervisor && (
										<Button
											className="shrink-0"
											disabled={pollMutation.isPending}
											onClick={() => pollMutation.mutate()}
											size="sm"
											type="button"
											variant="outline"
										>
											{pollMutation.isPending ? (
												<Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
											) : (
												<RefreshCw className="mr-2 h-3.5 w-3.5" />
											)}
											Actualizar estado
										</Button>
									)}
								</div>
								<div className="mt-4 space-y-1.5">
									<div className="flex items-center justify-between text-xs">
										<span className="font-medium">
											{linksPagados} de {links.length} links pagados
										</span>
										<span className="text-muted-foreground tabular-nums">
											{q(montoCobrado)} cobrado
										</span>
									</div>
									<Progress
										className="h-2"
										value={
											links.length > 0 ? (linksPagados / links.length) * 100 : 0
										}
									/>
								</div>
								{reviewRequired && (
									<p className="mt-3 flex items-start gap-1.5 text-amber-700 text-xs dark:text-amber-500">
										<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
										Este grupo quedó marcado para revisión: verificá el estado
										antes de compartir los links.
									</p>
								)}
							</div>
							{linksRecienCreados.length > 0 && !reviewRequired && (
								<div className="space-y-1">
									<p className="font-medium text-sm">
										{mutation.data?.origen === "BOT"
											? "El cliente ya generó estos links desde WhatsApp; se muestran los mismos."
											: mutation.data?.whatsappEnviado === null
												? "Ya existían links de pago para este crédito."
												: "Grupo creado. Compartí solo los links necesarios."}
									</p>
									{mutation.data?.origen !== "BOT" &&
										mutation.data?.whatsappEnviado !== null &&
										(mutation.data?.whatsappEnviado ? (
											<p className="flex items-center gap-1.5 text-green-700 text-xs">
												<CheckCircle2 className="h-3.5 w-3.5" />
												Se envió el mensaje por WhatsApp al cliente.
											</p>
										) : (
											<p className="flex items-center gap-1.5 text-amber-700 text-xs">
												<AlertTriangle className="h-3.5 w-3.5" />
												No se pudo enviar el WhatsApp al cliente, compartí el
												link manualmente.
											</p>
										))}
								</div>
							)}
							<div className="space-y-2">
								<p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
									Links generados
								</p>
								{links.map((link: any) => {
									const estado = getPagaloLinkStatusInfo(
										link.status ?? "ACTIVE",
									);
									const copiar = async () => {
										try {
											await copyPagaloLink(link.paymentUrl);
											toast.success("Link copiado");
										} catch {
											toast.error(
												"No se pudo copiar el link. Intentá de nuevo.",
											);
										}
									};
									return (
										<div
											className="rounded-lg border bg-card p-4"
											key={link.linkType}
										>
											<div className="flex items-start justify-between gap-4">
												<div className="min-w-0 space-y-1.5">
													<p className="font-medium">
														{link.linkType === "CAPITAL"
															? "Capital"
															: "Mora e intereses"}
													</p>
													<Badge className={estado.className}>
														{estado.label}
													</Badge>
													{link.status === "PAID" && link.paidAt && (
														<p className="flex items-center gap-1.5 text-green-700 text-xs">
															<CheckCircle2 className="h-3.5 w-3.5" />
															Pagado el{" "}
															{new Date(link.paidAt).toLocaleDateString(
																"es-GT",
																{
																	day: "numeric",
																	month: "short",
																	year: "numeric",
																},
															)}
														</p>
													)}
												</div>
												<div className="flex shrink-0 flex-col items-end gap-2">
													<p className="font-semibold text-lg tabular-nums">
														{q(link.amount)}
													</p>
													{estado.canCopy && (
														<Button
															onClick={copiar}
															size="sm"
															type="button"
															variant="outline"
														>
															<Copy className="mr-2 h-3.5 w-3.5" />
															Copiar link
														</Button>
													)}
												</div>
											</div>
										</div>
									);
								})}
							</div>
						</div>
					) : (
						<div className="min-h-0 space-y-4">
							{/* Jerarquía del selector: primero QUÉ se cobra (mora + cuotas),
							    después el cargo manual, y al final el resumen con el total
							    —que es el número con el que el asesor decide. */}
							<div className="flex items-end justify-between gap-4">
								<div>
									<p className="font-semibold text-base">Qué se va a cobrar</p>
									<p className="text-muted-foreground text-xs">
										Cada cuota se cobra completa; la mora vigente siempre va
										incluida.
									</p>
								</div>
								<div className="flex shrink-0 items-center gap-3">
									<span className="text-muted-foreground text-xs">
										{selected.length + (tieneMora ? 1 : 0)} seleccionada(s)
									</span>
									{cuotas.length > 0 && (
										<Button
											className="h-auto p-0 text-xs"
											onClick={toggleTodas}
											type="button"
											variant="link"
										>
											{todasSeleccionadas ? "Desmarcar todas" : "Marcar todas"}
										</Button>
									)}
								</div>
							</div>
							{tieneMora && (
								<div className="flex items-center justify-between gap-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
									<span className="flex items-center gap-3">
										<Checkbox checked disabled />
										<span>
											<span className="block font-medium">Mora actual</span>
											<span className="block text-amber-800 text-xs dark:text-amber-200/80">
												Se cobra completa y no se puede desmarcar
											</span>
										</span>
									</span>
									<span className="shrink-0 font-semibold text-base tabular-nums">
										{q(data.moraActual)}
									</span>
								</div>
							)}
							{cuotas.length === 0 ? (
								<p className="rounded-lg border border-dashed p-4 text-center text-muted-foreground text-sm">
									No hay cuotas vencidas disponibles.
								</p>
							) : (
								<div className="space-y-2">
									{cuotas.map((cuota: any) => {
										const facturableCuota =
											Number(cuota.interes_restante ?? 0) +
											Number(cuota.iva_12_restante ?? 0) +
											Number(cuota.seguro_restante ?? 0) +
											Number(cuota.gps_restante ?? 0) +
											Number(cuota.membresias_restante ?? 0);
										const saldoCuota =
											Number(cuota.capital_restante ?? 0) + facturableCuota;
										const nominalCuota = Number(cuota.cuota ?? 0);
										// Cuota nominal vs saldo real: si hubo un abono parcial previo a
										// esta misma cuota, el link solo cubre lo que falta (saldoCuota),
										// no el monto nominal completo — mostrar ambos evita que parezca
										// que el link está incompleto (caso crédito 752, cuota 28: abono
										// previo de Q78.24 a interés dejó nominal Q1695.91 vs saldo real
										// Q1617.67).
										const yaAbonado = nominalCuota - saldoCuota;
										const seleccionada = selected.includes(cuota.cuota_id);
										return (
											<Label
												className={`flex cursor-pointer items-start justify-between gap-4 rounded-lg border p-4 transition-colors ${
													seleccionada ? "border-primary/40 bg-primary/5" : ""
												}`}
												key={cuota.cuota_id}
											>
												<span className="flex min-w-0 items-start gap-3">
													<Checkbox
														checked={seleccionada}
														className="mt-0.5"
														onCheckedChange={() => toggle(cuota.cuota_id)}
													/>
													<span className="min-w-0">
														<span className="flex flex-wrap items-center gap-2">
															<span className="font-medium">
																Cuota {cuota.numero_cuota}
															</span>
															{cuota.esProxima ? (
																<Badge className="bg-blue-50 text-blue-700">
																	Próxima cuota
																</Badge>
															) : cuota.esActual ? (
																<Badge className="bg-blue-50 text-blue-700">
																	Cuota actual
																</Badge>
															) : (
																<Badge className="bg-red-50 text-red-700">
																	Vencida
																</Badge>
															)}
														</span>
														<span className="mt-1 block text-muted-foreground text-xs">
															Capital {q(cuota.capital_restante)} ·{" "}
															{tieneMora ? "Mora e intereses" : "Intereses"}{" "}
															{q(facturableCuota)}
														</span>
														{yaAbonado > 0.01 && (
															<span className="mt-0.5 block text-muted-foreground text-xs">
																Cuota nominal {q(nominalCuota)} − ya abonado{" "}
																{q(yaAbonado)}
															</span>
														)}
													</span>
												</span>
												<span className="shrink-0 text-right">
													<span className="block font-semibold text-base tabular-nums">
														{q(saldoCuota)}
													</span>
													{yaAbonado > 0.01 && (
														<span className="block text-muted-foreground text-xs">
															saldo real
														</span>
													)}
												</span>
											</Label>
										);
									})}
								</div>
							)}
							<div className="space-y-3 rounded-lg border p-4">
								<Label className="flex cursor-pointer items-center justify-between gap-4">
									<span className="flex items-center gap-3">
										<Checkbox
											checked={otrosActivo}
											onCheckedChange={(checked) => {
												setOtrosActivo(checked === true);
												if (checked !== true) setOtrosMonto("");
											}}
										/>
										<span>
											<span className="block font-medium">Otros</span>
											<span className="block text-muted-foreground text-xs">
												Cargo manual que viaja junto con el link de mora e
												intereses
											</span>
										</span>
									</span>
									{otrosParseado?.valid && (
										<span className="shrink-0 font-semibold text-base tabular-nums">
											{q(otrosParseado.value)}
										</span>
									)}
								</Label>
								{otrosActivo && (
									<div className="space-y-1 pl-8">
										<Label htmlFor="pagalo-otros">Monto Otros (GTQ)</Label>
										<Input
											id="pagalo-otros"
											inputMode="decimal"
											onChange={(event) => setOtrosMonto(event.target.value)}
											placeholder="0.00"
											value={otrosMonto}
										/>
										{!otrosParseado?.valid && (
											<p className="text-destructive text-xs">
												Ingresá monto mayor que Q0.00, con máximo dos decimales.
											</p>
										)}
									</div>
								)}
							</div>
							{(selected.length > 0 || tieneMora || otrosActivo) && (
								<div className="rounded-xl border border-violet-200 bg-violet-50/60 p-5 dark:border-violet-900 dark:bg-violet-950/30">
									<p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
										Links que se van a crear
									</p>
									<div className="mt-3 space-y-1.5 text-sm">
										{preview.capital > 0 && (
											<div className="flex items-center justify-between">
												<span>Link Capital</span>
												<span className="tabular-nums">
													{q(preview.capital)}
												</span>
											</div>
										)}
										{preview.facturable > 0 && (
											<div className="flex items-center justify-between">
												<span>
													{tieneMora
														? "Link Mora e intereses"
														: "Link Intereses"}
												</span>
												<span className="tabular-nums">
													{q(preview.facturable)}
												</span>
											</div>
										)}
										{preview.otros > 0 && (
											<div className="flex items-center justify-between text-muted-foreground">
												<span>Incluye Otros</span>
												<span className="tabular-nums">{q(preview.otros)}</span>
											</div>
										)}
									</div>
									<div className="mt-3 flex items-end justify-between border-t pt-3">
										<span className="font-medium text-sm">Total</span>
										<span className="font-semibold text-2xl tabular-nums">
											{q(preview.total)}
										</span>
									</div>
								</div>
							)}
							{vehiculoCaso.isError && (
								<div className="flex items-center justify-between gap-4 rounded-lg border border-red-300 bg-red-50 p-4 text-red-900 text-sm dark:border-red-900 dark:bg-red-950/30 dark:text-red-100">
									<span className="flex items-center gap-2">
										<AlertTriangle className="h-4 w-4 shrink-0" />
										No se pudo verificar el vehículo del caso. No se pueden
										crear links hasta reintentar.
									</span>
									<Button
										onClick={() => vehiculoCaso.refetch()}
										size="sm"
										type="button"
										variant="outline"
									>
										Reintentar
									</Button>
								</div>
							)}
							{(preview.capital > 0 || preview.facturable > 0) && (
								<div className="space-y-2 rounded-lg border p-4">
									<p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
										Mensaje que se enviará por WhatsApp
									</p>
									<p className="whitespace-pre-line rounded-md bg-muted/50 p-3 text-muted-foreground text-sm">
										{previewMensajePagaloLinks(
											data?.usuario?.nombre ?? "",
											identificadorCredito,
											[
												...(preview.capital > 0 ? (["CAPITAL"] as const) : []),
												...(preview.facturable > 0
													? (["MORA_INTERES"] as const)
													: []),
											],
										)}
									</p>
								</div>
							)}
						</div>
					)}
				</div>
				{links.length === 0 && (
					<DialogFooter>
						<Button
							disabled={
								(!tieneMora && selected.length === 0) ||
								(otrosActivo && selected.length === 0) ||
								(otrosActivo && !otrosParseado?.valid) ||
								mutation.isPending ||
								!vehiculoCaso.isSuccess
							}
							onClick={() =>
								mutation.mutate({
									casoCobroId,
									numeroSifco,
									creditoId,
									cuotaIds: selected,
									...(otrosParseado?.valid
										? { otros: otrosParseado.value }
										: {}),
								})
							}
						>
							{mutation.isPending && (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							)}
							Crear links sandbox
						</Button>
					</DialogFooter>
				)}
			</DialogContent>
		</Dialog>
	);
}
