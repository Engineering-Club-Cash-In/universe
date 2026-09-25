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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export function ReferenciasView({ casoCobroId }: ReferenciasViewProps) {
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

	const agregarAlCaso = useMutation({
		mutationFn: (hallazgoId: string) =>
			client.agregarHallazgoATelefonosCaso({ casoCobroId, hallazgoId }),
		onSuccess: (res) => {
			invalidar();
			// La ficha pinta los teléfonos del caso desde este detalle.
			queryClient.invalidateQueries({
				queryKey: orpc.getDetallesCreditoCarteraBack.key(),
			});
			toast.success(
				res.agregado
					? "Teléfono agregado a los del cliente"
					: "Ese teléfono ya estaba entre los del cliente",
			);
		},
		onError: (error) => {
			toast.error(`No se pudo agregar el teléfono: ${error.message}`);
		},
	});

	if (isLoading) {
		return (
			<Card>
				<CardContent className="py-10 text-center text-muted-foreground text-sm">
					Cargando referencias...
				</CardContent>
			</Card>
		);
	}

	if (isError || !data) {
		return (
			<Card>
				<CardContent className="flex flex-col items-center gap-3 py-10 text-center text-muted-foreground text-sm">
					No se pudieron cargar las referencias.
					<Button variant="outline" size="sm" onClick={() => refetch()}>
						Reintentar
					</Button>
				</CardContent>
			</Card>
		);
	}

	const { referencias, contactos, hallazgos } = data;
	const gestionadas = referencias.filter((r) => r.totalContactos > 0).length;

	return (
		<TooltipProvider>
			<div className="space-y-6">
				{/* Referencias */}
				<Card>
					<CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
						<div className="space-y-1">
							<CardTitle className="flex items-center gap-2">
								<User className="h-5 w-5" />
								Referencias
							</CardTitle>
							{referencias.length > 0 && (
								<p className="text-muted-foreground text-sm">
									{gestionadas} de {referencias.length} gestionadas
								</p>
							)}
						</div>
						{data.enlazado && (
							<Button
								size="sm"
								onClick={() => {
									setEditando(null);
									setFormAbierto(true);
								}}
							>
								<Plus className="mr-2 h-4 w-4" />
								Agregar
							</Button>
						)}
					</CardHeader>
					<CardContent>
						{!data.enlazado ? (
							<p className="py-6 text-center text-muted-foreground text-sm">
								Este crédito no está enlazado a una oportunidad del CRM, así que
								no se pueden mostrar sus referencias.
							</p>
						) : referencias.length === 0 ? (
							<div className="flex flex-col items-center justify-center py-6">
								<User className="mb-2 h-8 w-8 text-muted-foreground" />
								<p className="text-muted-foreground text-sm">
									No hay referencias registradas
								</p>
								<p className="text-muted-foreground text-xs">
									Ni en cobros, ni en la solicitud de crédito, ni cofirmantes.
								</p>
							</div>
						) : (
							<div className="space-y-3">
								{referencias.map((ref) => (
									<div
										key={ref.key}
										className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between"
									>
										<div className="min-w-0 space-y-1.5">
											<div className="flex flex-wrap items-center gap-1.5">
												<span className="font-medium">{ref.nombre}</span>
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
												<p className="text-muted-foreground text-xs">
													También aparece como: {ref.otrosNombres.join(", ")}
												</p>
											)}
											{ref.detalle && ref.origen !== "ventas_personal" && (
												<p className="text-muted-foreground text-xs">
													{ref.detalle}
												</p>
											)}

											{ref.telefonos.length === 0 ? (
												<p className="text-muted-foreground text-sm italic">
													Sin teléfono
												</p>
											) : (
												<div className="flex flex-wrap gap-1.5">
													{ref.telefonos.map((t) => (
														<span
															key={t.telefono}
															className={cn(
																"inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-sm",
																!t.original && "border-dashed",
															)}
														>
															<a
																href={urlLlamada(t.telefono)}
																className="font-medium text-primary hover:underline"
															>
																{t.telefono}
															</a>
															{t.etiqueta && (
																<span className="text-muted-foreground text-xs">
																	{t.etiqueta}
																</span>
															)}
															<a
																href={urlWhatsapp(t.telefono)}
																target="_blank"
																rel="noreferrer"
																className="text-muted-foreground hover:text-emerald-600"
																aria-label={`Abrir WhatsApp con ${t.telefono}`}
															>
																<MessageCircle className="h-3.5 w-3.5" />
															</a>
															{t.agregados[0] && (
																<Tooltip>
																	<TooltipTrigger asChild>
																		<button
																			type="button"
																			className="text-muted-foreground hover:text-red-600"
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
																			? "Ya venía en la referencia y cobros lo volvió a agregar"
																			: "Agregado en cobros"}
																		{t.agregados[0].registradoPor
																			? ` por ${t.agregados[0].registradoPor}`
																			: ""}
																		{t.agregados[0].notas
																			? ` · ${t.agregados[0].notas}`
																			: ""}
																		.{" "}
																		{t.original
																			? "Clic para quitar el repetido (el número se queda)."
																			: "Clic para quitarlo."}
																	</TooltipContent>
																</Tooltip>
															)}
														</span>
													))}
												</div>
											)}

											{ref.notas && (
												<p className="text-muted-foreground text-xs">
													{ref.notas}
												</p>
											)}

											<p className="text-muted-foreground text-xs">
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
														<span className="font-medium text-foreground">
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

										<div className="flex shrink-0 flex-wrap items-center gap-1">
											<Button
												size="sm"
												variant="outline"
												onClick={() => setGestionDe(ref)}
											>
												<PhoneCall className="mr-2 h-4 w-4" />
												Registrar gestión
											</Button>
											<Tooltip>
												<TooltipTrigger asChild>
													<Button
														variant="ghost"
														size="icon"
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
														size="icon"
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
														size="icon"
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
								))}
							</div>
						)}
					</CardContent>
				</Card>

				{/* Información nueva del cliente */}
				<Card>
					<CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
						<CardTitle className="flex items-center gap-2">
							<MapPin className="h-5 w-5" />
							Información nueva del cliente
						</CardTitle>
						<Button
							size="sm"
							variant="outline"
							onClick={() => setHallazgoAbierto(true)}
						>
							<Plus className="mr-2 h-4 w-4" />
							Registrar dato
						</Button>
					</CardHeader>
					<CardContent>
						{hallazgos.length === 0 ? (
							<p className="py-4 text-center text-muted-foreground text-sm">
								Todavía no se ha conseguido información nueva.
							</p>
						) : (
							<div className="space-y-2">
								{hallazgos.map((h: Hallazgo) => (
									<div
										key={h.id}
										className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between"
									>
										<div className="flex min-w-0 gap-3">
											<div className="mt-0.5 text-muted-foreground">
												<IconoHallazgo tipo={h.tipo} />
											</div>
											<div className="min-w-0 space-y-1">
												<div className="flex flex-wrap items-center gap-2">
													<span className="text-muted-foreground text-xs uppercase">
														{TIPO_HALLAZGO_LABELS[
															h.tipo as keyof typeof TIPO_HALLAZGO_LABELS
														] ?? h.tipo}
													</span>
													{h.tipo === "telefono" ? (
														<a
															href={urlLlamada(h.valor)}
															className="font-medium text-primary hover:underline"
														>
															{h.valor}
														</a>
													) : (
														<span className="font-medium">{h.valor}</span>
													)}
													{esEnlaceSeguro(h.enlaceMapa) && (
														<a
															href={h.enlaceMapa}
															target="_blank"
															rel="noreferrer"
															className="text-primary text-xs hover:underline"
														>
															Ver en el mapa
														</a>
													)}
												</div>
												{h.notas && (
													<p className="text-muted-foreground text-xs">
														{h.notas}
													</p>
												)}
												<p className="text-muted-foreground text-xs">
													{h.referenciaNombre
														? `Lo dio ${h.referenciaNombre}`
														: "Registrado sin gestión a referencia"}{" "}
													· {h.registradoPor ?? "—"} ·{" "}
													{formatGuatemalaDateTime(h.createdAt)}
												</p>
											</div>
										</div>
										{h.tipo === "telefono" &&
											(h.agregadoAlCasoAt ? (
												<Badge
													variant="outline"
													className="shrink-0 border-emerald-200 bg-emerald-50 font-normal text-emerald-700"
												>
													En los teléfonos del cliente
												</Badge>
											) : (
												<Button
													size="sm"
													variant="outline"
													className="shrink-0"
													disabled={agregarAlCaso.isPending}
													onClick={() => agregarAlCaso.mutate(h.id)}
												>
													Agregar a teléfonos del cliente
												</Button>
											))}
									</div>
								))}
							</div>
						)}
					</CardContent>
				</Card>

				{/* Bitácora */}
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<ClipboardList className="h-5 w-5" />
							Gestiones a referencias
							{contactos.length > 0 && (
								<Badge variant="secondary">{contactos.length}</Badge>
							)}
						</CardTitle>
						<p className="text-muted-foreground text-xs">
							No cuentan como contacto con el cliente (SLA, cola del día ni
							alertas).
						</p>
					</CardHeader>
					<CardContent>
						{contactos.length === 0 ? (
							<p className="py-4 text-center text-muted-foreground text-sm">
								Todavía no se ha gestionado ninguna referencia.
							</p>
						) : (
							<div className="space-y-2">
								{contactos.map((c) => (
									<div key={c.id} className="rounded-lg border p-3">
										<div className="flex flex-wrap items-center justify-between gap-2">
											<div className="flex flex-wrap items-center gap-1.5">
												<span className="font-medium">
													{c.referenciaNombre}
												</span>
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
											</div>
											<span className="text-muted-foreground text-xs">
												{formatGuatemalaDateTime(c.fechaContacto)}
											</span>
										</div>
										<p className="mt-1 text-muted-foreground text-xs">
											{etiquetaMetodoReferencia(c.metodoContacto)}
											{c.telefono ? ` al ${c.telefono}` : ""} ·{" "}
											{c.realizadoPor ?? "—"}
										</p>
										{c.comentarios && (
											<p className="mt-2 whitespace-pre-line text-sm">
												{c.comentarios}
											</p>
										)}
									</div>
								))}
							</div>
						)}
					</CardContent>
				</Card>
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
							gestiones que ya se le hicieron se quedan en la bitácora.
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
