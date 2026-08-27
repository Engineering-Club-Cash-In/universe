import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangle,
	CheckCircle2,
	Copy,
	CreditCard,
	Loader2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { Label } from "@/components/ui/label";
import {
	copyPagaloLink,
	getPagaloLinkStatusInfo,
	previewMensajePagaloLinks,
} from "@/lib/cobros/pagalo-link-display";
import { client, orpc } from "@/utils/orpc";

const q = (value: unknown) =>
	new Intl.NumberFormat("es-GT", { style: "currency", currency: "GTQ" }).format(
		Number(value ?? 0),
	);

export function PagaloLinkDialog({
	casoCobroId,
	numeroSifco,
	creditoId,
}: {
	casoCobroId: string;
	numeroSifco: string;
	creditoId: number;
}) {
	const [open, setOpen] = useState(false);
	const [selected, setSelected] = useState<number[]>([]);
	const grupoActivo = useQuery({
		...orpc.getPagaloGrupoActivo.queryOptions({ input: { creditoId } }),
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
		const sinDuplicados = (items: any[]) => {
			const porNumero = new Map<number, any>();
			for (const cuota of items) {
				const actual = porNumero.get(cuota.numero_cuota);
				if (!actual || Number(cuota.pago_id ?? 0) > Number(actual.pago_id ?? 0))
					porNumero.set(cuota.numero_cuota, cuota);
			}
			return [...porNumero.values()];
		};
		const vencidas = sinDuplicados(data?.cuotasAtrasadas ?? [])
			.filter((cuota: any) => cuota.numero_cuota > 0)
			.sort((a: any, b: any) => a.numero_cuota - b.numero_cuota);
		// cuotasPendientes es "todas las no pagadas" (sin filtro de fecha), no
		// "solo próximas" — ya incluye las vencidas. Sin excluirlas acá, [0]
		// cae siempre en la misma cuota que ya está en `vencidas` y la cuota
		// vigente real nunca se ofrece.
		const proxima = sinDuplicados(data?.cuotasPendientes ?? [])
			.filter(
				(cuota: any) =>
					cuota.numero_cuota > 0 &&
					!vencidas.some((v: any) => v.numero_cuota === cuota.numero_cuota),
			)
			.sort((a: any, b: any) => a.numero_cuota - b.numero_cuota)[0];
		return sinDuplicados(proxima ? [...vencidas, proxima] : vencidas).map(
			(cuota: any) => ({
				...cuota,
				esActual: proxima?.cuota_id === cuota.cuota_id,
			}),
		);
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
		const facturable = facturableCuotas + mora;
		return { capital, facturable, total: capital + facturable };
	}, [cuotas, selected, tieneMora, data]);
	const queryClient = useQueryClient();
	const mutation = useMutation({
		mutationFn: (input: {
			casoCobroId: string;
			numeroSifco: string;
			creditoId: number;
			cuotaIds: number[];
		}) => (client as any).crearLinksPagalo(input),
		onSuccess: (result: any) => {
			queryClient.invalidateQueries(
				orpc.getPagaloHistorial.queryOptions({ input: { casoCobroId } }),
			);
			queryClient.invalidateQueries(
				orpc.getPagaloGrupoActivo.queryOptions({ input: { creditoId } }),
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
			queryClient.invalidateQueries(
				orpc.getPagaloHistorial.queryOptions({ input: { casoCobroId } }),
			);
			console.log("[Págalo] resultado del poll:", result);
			toast.success(
				`Poll: ${result.pagados} pagado(s), ${result.errores} error(es). Dispatch: ${result.dispatchCompletados} completado(s), ${result.dispatchErrores} error(es). Revisa la consola.`,
			);
		},
		onError: (error: Error) =>
			toast.error(error.message || "Falló correr el poll de Págalo"),
	});

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) {
					setSelected([]);
					mutation.reset();
				}
			}}
		>
			<DialogTrigger asChild>
				<Button variant="outline" className="gap-2">
					<CreditCard className="h-4 w-4 text-violet-600" />
					Generar links Págalo
				</Button>
			</DialogTrigger>
			<DialogContent className="flex max-h-[90vh] max-w-2xl flex-col overflow-hidden">
				<DialogHeader>
					<DialogTitle>Links de pago Págalo</DialogTitle>
					<DialogDescription>
						Sandbox. Capital y mora/intereses salen en links separados. Links no
						expiran.
					</DialogDescription>
				</DialogHeader>
				<Button
					type="button"
					variant="secondary"
					size="sm"
					className="w-fit"
					disabled={pollMutation.isPending}
					onClick={() => pollMutation.mutate()}
				>
					{pollMutation.isPending && (
						<Loader2 className="mr-2 h-4 w-4 animate-spin" />
					)}
					Correr poll Págalo ahora (temporal)
				</Button>
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
						<div className="space-y-3">
							{(linksRecienCreados.length === 0 || reviewRequired) && (
								<div className="flex items-center justify-between rounded-md border bg-muted/40 p-3">
									<div>
										<p className="font-medium text-sm">
											{reviewRequired
												? "Grupo en revisión"
												: "Links de pago pendientes"}
										</p>
										{grupoPendiente?.createdAt && (
											<p className="text-muted-foreground text-xs">
												Creado el{" "}
												{new Date(grupoPendiente.createdAt).toLocaleString(
													"es-GT",
													{
														day: "numeric",
														month: "short",
														year: "numeric",
														hour: "2-digit",
														minute: "2-digit",
													},
												)}
											</p>
										)}
									</div>
									<div className="text-right">
										<p className="font-medium text-sm">{q(totalPendiente)}</p>
										<p className="text-muted-foreground text-xs">
											{links.filter((l: any) => l.status === "PAID").length} de{" "}
											{links.length} pagados
										</p>
									</div>
								</div>
							)}
							{linksRecienCreados.length > 0 && !reviewRequired && (
								<div className="space-y-1">
									<p className="text-sm">
										{mutation.data?.origen === "BOT"
											? "El cliente ya generó estos links desde WhatsApp; se muestran los mismos:"
											: mutation.data?.whatsappEnviado === null
												? "Ya existían links de pago para este crédito:"
												: "Grupo creado. Comparte solo links necesarios:"}
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
							{links.map((link: any) => {
								const estado = getPagaloLinkStatusInfo(link.status ?? "ACTIVE");
								const copiar = async () => {
									try {
										await copyPagaloLink(link.paymentUrl);
										toast.success("Link copiado");
									} catch {
										toast.error("No se pudo copiar el link. Intentá de nuevo.");
									}
								};
								return (
									<div
										key={link.linkType}
										className="flex items-center justify-between rounded-md border p-3 text-sm"
									>
										<div>
											<p className="flex items-center gap-2 font-medium">
												{link.linkType === "CAPITAL"
													? "Capital"
													: "Mora e intereses"}
												<Badge className={estado.className}>
													{estado.label}
												</Badge>
											</p>
											<p className="text-muted-foreground">
												{q(link.amount)}
												{link.status === "PAID" && link.paidAt && (
													<>
														{" "}
														· Pagado el{" "}
														{new Date(link.paidAt).toLocaleDateString("es-GT", {
															day: "numeric",
															month: "short",
															year: "numeric",
														})}
													</>
												)}
											</p>
										</div>
										{estado.canCopy && (
											<Button
												type="button"
												size="sm"
												variant="outline"
												onClick={copiar}
											>
												<Copy className="mr-2 h-3.5 w-3.5" />
												Copiar link
											</Button>
										)}
									</div>
								);
							})}
						</div>
					) : (
						<div className="min-h-0 space-y-3">
							<div className="flex items-center justify-between">
								<p className="font-medium text-sm">Cuotas seleccionables</p>
								<div className="flex items-center gap-2">
									<span className="text-muted-foreground text-xs">
										{selected.length + (tieneMora ? 1 : 0)} seleccionada(s)
									</span>
									{cuotas.length > 0 && (
										<Button
											type="button"
											variant="link"
											className="h-auto p-0 text-xs"
											onClick={toggleTodas}
										>
											{todasSeleccionadas ? "Desmarcar todas" : "Marcar todas"}
										</Button>
									)}
								</div>
							</div>
							{tieneMora && (
								<div className="flex items-center justify-between rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
									<span className="flex items-center gap-3">
										<Checkbox checked disabled />
										Mora actual
									</span>
									<span className="text-sm">{q(data.moraActual)}</span>
								</div>
							)}
							{cuotas.length === 0 ? (
								<p className="text-muted-foreground text-sm">
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
										return (
											<Label
												key={cuota.cuota_id}
												className="flex cursor-pointer items-center justify-between rounded-md border p-3"
											>
												<span className="flex items-center gap-3">
													<Checkbox
														checked={selected.includes(cuota.cuota_id)}
														onCheckedChange={() => toggle(cuota.cuota_id)}
													/>
													Cuota {cuota.numero_cuota}
													{cuota.esActual ? (
														<Badge className="bg-blue-50 text-blue-700">
															Cuota actual
														</Badge>
													) : (
														<Badge className="bg-red-50 text-red-700">
															Vencida
														</Badge>
													)}
												</span>
												<span className="text-right text-muted-foreground text-sm">
													<span className="block">
														Capital {q(cuota.capital_restante)} · Mora e
														intereses {q(facturableCuota)}
													</span>
													{yaAbonado > 0.01 && (
														<span className="block text-xs">
															Cuota nominal {q(nominalCuota)} − ya abonado{" "}
															{q(yaAbonado)} = saldo {q(saldoCuota)}
														</span>
													)}
												</span>
											</Label>
										);
									})}
								</div>
							)}
							{(selected.length > 0 || tieneMora) && (
								<div className="space-y-1 rounded-md border bg-muted/40 p-3 text-sm">
									<p className="font-medium">Links que se van a crear</p>
									{preview.capital > 0 && (
										<div className="flex items-center justify-between">
											<span>Link Capital</span>
											<span>{q(preview.capital)}</span>
										</div>
									)}
									{preview.facturable > 0 && (
										<div className="flex items-center justify-between">
											<span>Link Mora e intereses</span>
											<span>{q(preview.facturable)}</span>
										</div>
									)}
									<div className="flex items-center justify-between border-t pt-1 font-medium">
										<span>Total</span>
										<span>{q(preview.total)}</span>
									</div>
								</div>
							)}
							{vehiculoCaso.isError && (
								<div className="flex items-center justify-between rounded-md border border-red-300 bg-red-50 p-3 text-red-900 text-sm">
									<span className="flex items-center gap-2">
										<AlertTriangle className="h-4 w-4" />
										No se pudo verificar el vehículo del caso. No se pueden
										crear links hasta reintentar.
									</span>
									<Button
										type="button"
										size="sm"
										variant="outline"
										onClick={() => vehiculoCaso.refetch()}
									>
										Reintentar
									</Button>
								</div>
							)}
							{(preview.capital > 0 || preview.facturable > 0) && (
								<div className="space-y-1 rounded-md border p-3 text-sm">
									<p className="font-medium">
										Mensaje que se enviará por WhatsApp
									</p>
									<p className="whitespace-pre-line rounded-md bg-muted/40 p-3 text-muted-foreground">
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
								mutation.isPending ||
								!vehiculoCaso.isSuccess
							}
							onClick={() =>
								mutation.mutate({
									casoCobroId,
									numeroSifco,
									creditoId,
									cuotaIds: selected,
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
