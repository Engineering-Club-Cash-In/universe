/**
 * CB-036 · Pestaña Referencias de la Ficha 360.
 *
 * Tres bloques: las referencias del cliente (seis fuentes juntas, con el último
 * intento de cada una), la bitácora de gestiones a referencias y la
 * información nueva del cliente que se fue consiguiendo.
 *
 * Solo las referencias de cobros se editan y se borran; las de ventas y los
 * cofirmantes son de solo lectura, pero a cualquiera se le puede agregar un
 * teléfono y registrar una gestión. Siempre disponible, sin requisitos previos.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ClipboardList,
	Edit2,
	MapPin,
	MessageCircle,
	Navigation,
	Phone,
	PhoneCall,
	PhoneForwarded,
	Plus,
	Trash2,
	User,
	X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	HistorialGestiones,
	SeccionHistorial,
	type TonoGestion,
} from "@/components/cobros/ficha/ficha-pestanas";
import {
	CrmPill,
	type CrmTone,
	inicialesDe,
} from "@/components/ds/cards-credito";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	clasesResultadoReferencia,
	esEnlaceSeguro,
	etiquetaMetodoReferencia,
	etiquetaOrigenReferencia,
	etiquetaResultadoReferencia,
	ORIGEN_REFERENCIA_CLASES,
	PARENTESCO_LABELS,
	TIPO_HALLAZGO_LABELS,
	urlLlamada,
	urlWhatsapp,
} from "@/lib/cobros/referencias";
import { formatGuatemalaDateTime } from "@/lib/crm-formatters";
import { cn } from "@/lib/utils";
import { client, orpc } from "@/utils/orpc";
import {
	AgregarTelefonoReferenciaDialog,
	type DatosReferencias,
	type ReferenciaCaso,
	ReferenciaCobrosDialog,
	RegistrarGestionReferenciaDialog,
	RegistrarHallazgoDialog,
} from "./referencias-dialogs";

interface ReferenciasViewProps {
	casoCobroId: string;
	/**
	 * "Agregar a teléfonos del cliente" lo resuelve la ficha, no esta vista:
	 * los teléfonos del caso los escriben también el editor de contacto y su
	 * autoguardado, y todo tiene que ir por la misma cola y mantener al día el
	 * formulario. Si esta vista llamara por su cuenta, un editor abierto en
	 * Resumen mandaría después su lista vieja y borraría el número recién
	 * agregado (Codex, PR #1751).
	 */
	onAgregarTelefonoAlCaso: (v: {
		hallazgoId: string;
		telefono: string;
	}) => void;
	agregandoTelefonoAlCaso: boolean;
}

type Hallazgo = DatosReferencias["hallazgos"][number];

/** Etiqueta de origen; la de cobros muestra el parentesco que se capturó. */
function etiquetaOrigen(
	referencia: ReferenciaCaso,
	origen: ReferenciaCaso["origen"],
): string {
	if (origen === "cobros" && referencia.editable) {
		return (
			PARENTESCO_LABELS[referencia.editable.parentesco] ??
			referencia.editable.parentesco
		);
	}
	if (origen === "ventas_personal" && referencia.detalle) {
		return `Personal · ${referencia.detalle}`;
	}
	return etiquetaOrigenReferencia(origen);
}

function IconoHallazgo({ tipo }: { tipo: string }) {
	if (tipo === "telefono") return <Phone className="h-4 w-4" />;
	if (tipo === "direccion") return <MapPin className="h-4 w-4" />;
	return <Navigation className="h-4 w-4" />;
}

/**
 * Estado de la referencia como en Figma (Verificada / Pendiente / No
 * contactada) a partir del resultado de su última gestión.
 */
function estadoReferencia(resultado: string | null | undefined): {
	etiqueta: string;
	tone: CrmTone;
	tono: TonoGestion;
} {
	switch (resultado) {
		case "dio_informacion":
		case "pasara_mensaje":
			return { etiqueta: "Verificada", tone: "success", tono: "logrado" };
		case "sin_informacion":
		case "no_conoce_al_cliente":
			return {
				etiqueta: "Sin información",
				tone: "warning",
				tono: "sin-contacto",
			};
		case "no_contesta":
		case "numero_equivocado":
		case "mensaje_enviado":
			return { etiqueta: "No contactada", tone: "danger", tono: "fallido" };
		default:
			return { etiqueta: "Pendiente", tone: "neutral", tono: "neutro" };
	}
}

export function ReferenciasView({
	casoCobroId,
	onAgregarTelefonoAlCaso,
	agregandoTelefonoAlCaso,
}: ReferenciasViewProps) {
	const queryClient = useQueryClient();
	const opcionesQuery = orpc.getReferenciasCaso.queryOptions({
		input: { casoCobroId },
	});
	const { data, isLoading, isError, refetch } = useQuery(opcionesQuery);
	const invalidar = () => queryClient.invalidateQueries(opcionesQuery);

	const [gestionDe, setGestionDe] = useState<ReferenciaCaso | null>(null);
	const [telefonoPara, setTelefonoPara] = useState<ReferenciaCaso | null>(null);
	const [formAbierto, setFormAbierto] = useState(false);
	const [editando, setEditando] = useState<ReferenciaCaso | null>(null);
	const [borrando, setBorrando] = useState<ReferenciaCaso | null>(null);
	const [hallazgoAbierto, setHallazgoAbierto] = useState(false);

	const eliminarReferencia = useMutation({
		mutationFn: (id: string) =>
			client.eliminarReferenciaCobros({ casoCobroId, id }),
		onSuccess: () => {
			invalidar();
			toast.success("Referencia eliminada");
			setBorrando(null);
		},
		onError: (error) => {
			toast.error(`No se pudo eliminar la referencia: ${error.message}`);
		},
	});

	const quitarTelefono = useMutation({
		mutationFn: (id: string) =>
			client.eliminarTelefonoReferencia({ casoCobroId, id }),
		onSuccess: () => {
			invalidar();
			toast.success("Teléfono quitado de la referencia");
		},
		onError: (error) => {
			toast.error(`No se pudo quitar el teléfono: ${error.message}`);
		},
	});

	if (isLoading || isError || !data) {
		return (
			<SeccionHistorial
				titulo="Referencias"
				icono={<User />}
				estado={isLoading ? "cargando" : "error"}
				onReintentar={() => refetch()}
			/>
		);
	}

	const { referencias, contactos, hallazgos } = data;
	const gestionadas = referencias.filter((r) => r.totalContactos > 0).length;

	return (
		<TooltipProvider>
			<div className="space-y-8">
				{/* Referencias (Figma 415:3637: una fila por persona con su estado). */}
				<SeccionHistorial
					titulo="Referencias"
					conteo={referencias.length}
					icono={<User />}
					descripcion={
						referencias.length > 0
							? `${gestionadas} de ${referencias.length} gestionadas`
							: undefined
					}
					derecha={
						data.enlazado ? (
							<Button
								size="sm"
								onClick={() => {
									setEditando(null);
									setFormAbierto(true);
								}}
							>
								<Plus className="h-4 w-4" />
								Agregar
							</Button>
						) : undefined
					}
					estado={!data.enlazado || referencias.length === 0 ? "vacio" : "ok"}
					vacio={
						!data.enlazado
							? "Este crédito no está enlazado a una oportunidad del CRM, así que no se pueden mostrar sus referencias."
							: "No hay referencias registradas: ni en cobros, ni en la solicitud de crédito, ni cofirmantes."
					}
				>
					<div className="space-y-2.5">
						{referencias.map((ref) => {
							const estado = estadoReferencia(ref.ultimoContacto?.resultado);
							return (
								<div
									key={ref.key}
									className="flex flex-col gap-3 rounded-xl border border-line-subtle bg-surface px-4 py-3 sm:flex-row sm:items-start"
								>
									<span
										aria-hidden
										className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-subtle font-semibold text-brand text-xs"
									>
										{inicialesDe(ref.nombre)}
									</span>
									<div className="min-w-0 flex-1 space-y-1.5">
										<div className="flex flex-wrap items-center gap-1.5">
											<span className="font-semibold text-fg text-sm">
												{ref.nombre}
											</span>
											{ref.origenes.map((origen) => (
												<Badge
													key={origen}
													variant="outline"
													className={cn(
														"font-normal",
														ORIGEN_REFERENCIA_CLASES[origen],
													)}
												>
													{etiquetaOrigen(ref, origen)}
												</Badge>
											))}
										</div>
										{ref.otrosNombres.length > 0 && (
											<p className="text-fg-tertiary text-xs">
												También aparece como: {ref.otrosNombres.join(", ")}
											</p>
										)}
										{ref.detalle && ref.origen !== "ventas_personal" && (
											<p className="text-fg-secondary text-xs">{ref.detalle}</p>
										)}

										{ref.telefonos.length === 0 ? (
											<p className="text-fg-tertiary text-xs italic">
												Sin teléfono
											</p>
										) : (
											<div className="flex flex-wrap gap-1.5">
												{ref.telefonos.map((t) => (
													<span
														key={t.telefono}
														className={cn(
															"inline-flex items-center gap-1 rounded-md border border-line-subtle px-2 py-0.5 text-xs",
															!t.original && "border-dashed",
														)}
													>
														<a
															href={urlLlamada(t.telefono)}
															className="font-medium text-brand hover:underline"
														>
															{t.telefono}
														</a>
														{t.etiqueta && (
															<span className="text-fg-tertiary">
																{t.etiqueta}
															</span>
														)}
														<a
															href={urlWhatsapp(t.telefono)}
															target="_blank"
															rel="noreferrer"
															className="text-fg-tertiary hover:text-emerald-600"
															aria-label={`Abrir WhatsApp con ${t.telefono}`}
														>
															<MessageCircle className="h-3.5 w-3.5" />
														</a>
														{t.agregados[0] && (
															<Tooltip>
																<TooltipTrigger asChild>
																	<button
																		type="button"
																		className="text-fg-tertiary hover:text-red-600"
																		aria-label={
																			t.original
																				? `Quitar el ${t.telefono} que agregó cobros`
																				: `Quitar ${t.telefono}`
																		}
																		disabled={quitarTelefono.isPending}
																		onClick={() =>
																			t.agregados[0] &&
																			quitarTelefono.mutate(t.agregados[0].id)
																		}
																	>
																		<X className="h-3.5 w-3.5" />
																	</button>
																</TooltipTrigger>
																<TooltipContent>
																	{t.original
																		? "Ya estaba en la referencia y cobros lo volvió a agregar"
																		: "Agregado en cobros"}
																	{t.agregados[0].registradoPor
																		? ` por ${t.agregados[0].registradoPor}`
																		: ""}
																	{t.agregados[0].notas
																		? ` · ${t.agregados[0].notas}`
																		: ""}
																	.{" "}
																	{t.original
																		? "Haga clic para quitar el duplicado (el número se conserva)."
																		: "Haga clic para quitarlo."}
																</TooltipContent>
															</Tooltip>
														)}
													</span>
												))}
											</div>
										)}

										{ref.notas && (
											<p className="text-fg-secondary text-xs">{ref.notas}</p>
										)}

										<p className="text-fg-tertiary text-xs">
											{ref.ultimoContacto ? (
												<>
													Último intento:{" "}
													{formatGuatemalaDateTime(
														ref.ultimoContacto.fechaContacto,
													)}{" "}
													·{" "}
													{etiquetaMetodoReferencia(
														ref.ultimoContacto.metodoContacto,
													)}{" "}
													·{" "}
													<span className="font-medium text-fg">
														{etiquetaResultadoReferencia(
															ref.ultimoContacto.resultado,
														)}
													</span>
													{ref.totalContactos > 1 &&
														` (${ref.totalContactos} gestiones)`}
												</>
											) : (
												"Sin gestiones"
											)}
										</p>
									</div>

									<div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
										<CrmPill tone={estado.tone} className="px-2.5 py-0.5">
											{estado.etiqueta}
										</CrmPill>
										<div className="flex flex-wrap items-center gap-1">
											<Button
												size="sm"
												variant="secondary"
												onClick={() => setGestionDe(ref)}
											>
												<PhoneCall className="h-4 w-4" />
												Registrar gestión
											</Button>
											<Tooltip>
												<TooltipTrigger asChild>
													<Button
														variant="ghost"
														size="icon-sm"
														aria-label="Agregar teléfono"
														onClick={() => setTelefonoPara(ref)}
													>
														<PhoneForwarded className="h-4 w-4" />
													</Button>
												</TooltipTrigger>
												<TooltipContent>Agregar teléfono</TooltipContent>
											</Tooltip>
											{ref.editable && (
												<>
													<Button
														variant="ghost"
														size="icon-sm"
														aria-label="Editar referencia"
														onClick={() => {
															setEditando(ref);
															setFormAbierto(true);
														}}
													>
														<Edit2 className="h-4 w-4" />
													</Button>
													<Button
														variant="ghost"
														size="icon-sm"
														className="text-red-500 hover:text-red-600"
														aria-label="Eliminar referencia"
														onClick={() => setBorrando(ref)}
													>
														<Trash2 className="h-4 w-4" />
													</Button>
												</>
											)}
										</div>
									</div>
								</div>
							);
						})}
					</div>
				</SeccionHistorial>

				{/* Información nueva del cliente */}
				<SeccionHistorial
					titulo="Información nueva del cliente"
					conteo={hallazgos.length}
					icono={<MapPin />}
					derecha={
						<Button
							size="sm"
							variant="secondary"
							onClick={() => setHallazgoAbierto(true)}
						>
							<Plus className="h-4 w-4" />
							Registrar dato
						</Button>
					}
					estado={hallazgos.length === 0 ? "vacio" : "ok"}
					vacio="Todavía no se ha obtenido información nueva."
				>
					<HistorialGestiones
						items={hallazgos.map((h: Hallazgo) => ({
							id: h.id,
							cuando: formatGuatemalaDateTime(h.createdAt),
							titulo: (
								<span className="inline-flex min-w-0 items-center gap-1.5">
									<IconoHallazgo tipo={h.tipo} />
									<span className="text-fg-tertiary text-xs uppercase">
										{TIPO_HALLAZGO_LABELS[
											h.tipo as keyof typeof TIPO_HALLAZGO_LABELS
										] ?? h.tipo}
									</span>
									{h.tipo === "telefono" ? (
										<a
											href={urlLlamada(h.valor)}
											className="text-brand hover:underline"
										>
											{h.valor}
										</a>
									) : (
										<span className="wrap-break-word">{h.valor}</span>
									)}
								</span>
							),
							badge:
								h.tipo === "telefono" && h.enTelefonosDelCaso ? (
									<Badge
										variant="outline"
										className="border-emerald-200 bg-emerald-50 font-normal text-emerald-700"
									>
										En los teléfonos del cliente
									</Badge>
								) : undefined,
							subtitulo: `${
								h.referenciaNombre
									? `Proporcionado por ${h.referenciaNombre}`
									: "Registrado sin gestión a referencia"
							} · ${h.registradoPor ?? "—"}`,
							tono: "logrado" as const,
							nota: h.notas,
							extra:
								(h.tipo === "telefono" && !h.enTelefonosDelCaso) ||
								esEnlaceSeguro(h.enlaceMapa) ? (
									<div className="flex flex-wrap items-center gap-2">
										{esEnlaceSeguro(h.enlaceMapa) && (
											<a
												href={h.enlaceMapa}
												target="_blank"
												rel="noreferrer"
												className="text-brand text-xs hover:underline"
											>
												Ver en el mapa
											</a>
										)}
										{h.tipo === "telefono" && !h.enTelefonosDelCaso && (
											<Button
												size="sm"
												variant="secondary"
												disabled={agregandoTelefonoAlCaso}
												onClick={() =>
													onAgregarTelefonoAlCaso({
														hallazgoId: h.id,
														telefono: h.valor,
													})
												}
											>
												Agregar a teléfonos del cliente
											</Button>
										)}
									</div>
								) : undefined,
						}))}
					/>
				</SeccionHistorial>

				{/* Bitácora */}
				<SeccionHistorial
					titulo="Gestiones a referencias"
					conteo={contactos.length}
					icono={<ClipboardList />}
					descripcion="No cuentan como contacto con el cliente (SLA, cola del día ni alertas)."
					estado={contactos.length === 0 ? "vacio" : "ok"}
					vacio="Todavía no se ha gestionado ninguna referencia."
				>
					<HistorialGestiones
						items={contactos.map((c) => ({
							id: c.id,
							cuando: formatGuatemalaDateTime(c.fechaContacto),
							titulo: c.referenciaNombre,
							badge: (
								<span className="inline-flex flex-wrap items-center gap-1.5">
									<Badge variant="outline" className="font-normal">
										{etiquetaOrigenReferencia(c.referenciaOrigen)}
									</Badge>
									<Badge
										variant="outline"
										className={cn(
											"font-normal",
											clasesResultadoReferencia(c.resultado),
										)}
									>
										{etiquetaResultadoReferencia(c.resultado)}
									</Badge>
								</span>
							),
							subtitulo: `${etiquetaMetodoReferencia(c.metodoContacto)}${
								c.telefono ? ` al ${c.telefono}` : ""
							} · ${c.realizadoPor ?? "—"}`,
							tono: estadoReferencia(c.resultado).tono,
							nota: c.comentarios,
						}))}
					/>
				</SeccionHistorial>
			</div>

			<RegistrarGestionReferenciaDialog
				casoCobroId={casoCobroId}
				referencia={gestionDe}
				onOpenChange={(open) => !open && setGestionDe(null)}
			/>
			<AgregarTelefonoReferenciaDialog
				casoCobroId={casoCobroId}
				referencia={telefonoPara}
				onOpenChange={(open) => !open && setTelefonoPara(null)}
			/>
			<ReferenciaCobrosDialog
				casoCobroId={casoCobroId}
				open={formAbierto}
				editando={editando}
				onOpenChange={setFormAbierto}
			/>
			<RegistrarHallazgoDialog
				casoCobroId={casoCobroId}
				open={hallazgoAbierto}
				onOpenChange={setHallazgoAbierto}
			/>

			<Dialog
				open={!!borrando}
				onOpenChange={(open) => !open && setBorrando(null)}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Eliminar referencia</DialogTitle>
						<DialogDescription>
							¿Eliminar a{" "}
							<span className="font-medium">{borrando?.nombre}</span>? Las
							gestiones ya realizadas se conservan en la bitácora.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setBorrando(null)}>
							Cancelar
						</Button>
						<Button
							variant="destructive"
							disabled={eliminarReferencia.isPending}
							onClick={() =>
								borrando?.editable &&
								eliminarReferencia.mutate(borrando.editable.referenciaLeadId)
							}
						>
							{eliminarReferencia.isPending ? "Eliminando..." : "Eliminar"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</TooltipProvider>
	);
}
