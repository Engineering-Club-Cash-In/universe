import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowLeft,
	Banknote,
	CalendarClock,
	Car,
	ChevronLeft,
	ChevronRight,
	Clock,
	FileText,
	Mail,
	MapPin,
	MessageCircle,
	Phone,
	Shield,
	User,
	Users,
} from "lucide-react";
import { useState } from "react";
import { ContactoModal } from "@/components/contacto-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/cobros/$id")({
	component: RouteComponent,
	validateSearch: (search: Record<string, unknown>) => ({
		tipo: (search.tipo as "caso" | "contrato") || "caso",
	}),
});

// Componente de paginación reutilizable
function Pagination({
	currentPage,
	totalItems,
	itemsPerPage,
	onPageChange,
}: {
	currentPage: number;
	totalItems: number;
	itemsPerPage: number;
	onPageChange: (page: number) => void;
}) {
	const totalPages = Math.ceil(totalItems / itemsPerPage);

	if (totalPages <= 1) return null;

	return (
		<div className="flex items-center justify-between border-t pt-4">
			<p className="text-muted-foreground text-sm">
				Mostrando {(currentPage - 1) * itemsPerPage + 1} -{" "}
				{Math.min(currentPage * itemsPerPage, totalItems)} de {totalItems}
			</p>
			<div className="flex items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					onClick={() => onPageChange(currentPage - 1)}
					disabled={currentPage === 1}
				>
					<ChevronLeft className="h-4 w-4" />
				</Button>
				<span className="text-sm">
					Página {currentPage} de {totalPages}
				</span>
				<Button
					variant="outline"
					size="sm"
					onClick={() => onPageChange(currentPage + 1)}
					disabled={currentPage === totalPages}
				>
					<ChevronRight className="h-4 w-4" />
				</Button>
			</div>
		</div>
	);
}

// Helper para detectar si es un UUID o un ID numérico
function isUUID(id: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
		id,
	);
}

function RouteComponent() {
	const { id } = Route.useParams();
	const { tipo } = Route.useSearch();
	const { data: session } = authClient.useSession();

	// Estados de paginación
	const [contactosPage, setContactosPage] = useState(1);
	const [cuotasPage, setCuotasPage] = useState(1);
	const ITEMS_PER_PAGE = 5; // Reducido a 5 para testing, cambia a 10 en producción

	// Determinar si es un crédito de Cartera-Back (ID numérico) o del CRM (UUID)
	const esCarteraBack = !isUUID(id);

	// Obtener detalles del contrato/caso
	// Si es ID numérico, usar endpoint de Cartera-Back, si es UUID usar el del CRM
	const casoDetails = useQuery({
		...(esCarteraBack
			? orpc.getDetallesCreditoCarteraBack.queryOptions({
					input: { creditoId: id },
				})
			: orpc.getDetallesContrato.queryOptions({
					input: { id, tipo },
				})),
		enabled: !!session && !!id,
	});

	// Obtener historial de contactos (solo para casos)
	const historialContactos = useQuery({
		...orpc.getHistorialContactos.queryOptions({
			input: { casoCobroId: id },
		}),
		enabled: !!session && !!id && tipo === "caso",
	});

	// Obtener convenios de pago (solo para casos)
	const conveniosPago = useQuery({
		...orpc.getConveniosPago.queryOptions({
			input: { casoCobroId: id },
		}),
		enabled: !!session && !!id && tipo === "caso",
	});

	// Obtener historial de pagos del contrato
	const historialPagos = useQuery({
		...orpc.getHistorialPagos.queryOptions({
			input: { contratoId: casoDetails.data?.contratoId || "" },
		}),
		enabled: !!session && !!casoDetails.data?.contratoId,
	});

	// Obtener información de recuperación si es caso incobrable
	const recuperacionInfo = useQuery({
		...orpc.getRecuperacionVehiculo.queryOptions({
			input: { casoCobroId: id },
		}),
		enabled:
			!!session &&
			!!id &&
			tipo === "caso" &&
			casoDetails.data?.estadoMora === "incobrable",
	});

	if (casoDetails.isLoading) {
		return (
			<div className="container mx-auto p-6">
				<div className="animate-pulse">
					<div className="mb-4 h-8 rounded bg-gray-200" />
					<div className="mb-2 h-4 rounded bg-gray-200" />
					<div className="mb-2 h-4 rounded bg-gray-200" />
				</div>
			</div>
		);
	}

	if (!casoDetails.data) {
		return (
			<div className="container mx-auto p-6">
				<div className="text-center">
					<h1 className="mb-4 font-bold text-2xl text-gray-900">
						Caso No Encontrado
					</h1>
					<p className="mb-4 text-gray-600">
						No se encontró el caso de cobranza solicitado.
					</p>
					<Link to="/cobros">
						<Button variant="outline">
							<ArrowLeft className="mr-2 h-4 w-4" />
							Volver a Cobros
						</Button>
					</Link>
				</div>
			</div>
		);
	}

	const caso = casoDetails.data;
	const contactos = historialContactos.data || [];
	const convenios = conveniosPago.data || [];
	const cuotas = historialPagos.data || [];
	const recuperacion = recuperacionInfo.data;

	const getEstadoBadge = (estado: string) => {
		const colors: Record<string, string> = {
			mora_30: "bg-yellow-100 text-yellow-800",
			mora_60: "bg-orange-100 text-orange-800",
			mora_90: "bg-red-100 text-red-800",
			mora_120: "bg-red-200 text-red-900",
			pagado: "bg-green-100 text-green-800",
			incobrable: "bg-gray-100 text-gray-800",
		};
		return colors[estado] || "bg-gray-100 text-gray-800";
	};

	const getMetodoIcon = (metodo: string) => {
		switch (metodo) {
			case "llamada":
				return <Phone className="h-3 w-3" />;
			case "whatsapp":
				return <MessageCircle className="h-3 w-3" />;
			case "email":
				return <Mail className="h-3 w-3" />;
			default:
				return <Phone className="h-3 w-3" />;
		}
	};

	const getEstadoContacto = (estado: string) => {
		const estados: Record<string, { label: string; color: string }> = {
			contactado: { label: "Contactado", color: "bg-green-100 text-green-800" },
			promesa_pago: {
				label: "Promesa de Pago",
				color: "bg-blue-100 text-blue-800",
			},
			no_contesta: {
				label: "No Contesta",
				color: "bg-yellow-100 text-yellow-800",
			},
			acuerdo_parcial: {
				label: "Acuerdo Parcial",
				color: "bg-purple-100 text-purple-800",
			},
			rechaza_pagar: {
				label: "Rechaza Pagar",
				color: "bg-red-100 text-red-800",
			},
			numero_equivocado: {
				label: "Número Equivocado",
				color: "bg-gray-100 text-gray-800",
			},
		};
		return (
			estados[estado] || { label: estado, color: "bg-gray-100 text-gray-800" }
		);
	};

	return (
		<div className="container mx-auto space-y-6 p-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-4">
					<Link to="/cobros">
						<Button variant="outline" size="sm">
							<ArrowLeft className="mr-2 h-4 w-4" />
							Volver
						</Button>
					</Link>
					<div>
						<h1 className="font-bold text-2xl">Detalles del Caso</h1>
						<p className="text-muted-foreground">
							{caso.vehiculoMarca} {caso.vehiculoModelo} {caso.vehiculoYear} -{" "}
							{caso.vehiculoPlaca}
						</p>
					</div>
				</div>
				<Badge className={getEstadoBadge(caso.estadoMora || "")}>
					{caso.estadoMora?.replace("_", " ")?.toUpperCase()}
				</Badge>
			</div>

			<div className="grid gap-6 lg:grid-cols-3">
				{/* Información Principal */}
				<div className="space-y-6 lg:col-span-2">
					{/* Resumen del Caso */}
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<FileText className="h-5 w-5" />
								Información del Caso
							</CardTitle>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="grid grid-cols-2 gap-4">
								<div className="space-y-2">
									<div className="flex items-center gap-2 text-sm">
										<Users className="h-4 w-4 text-muted-foreground" />
										<span className="font-medium">Cliente:</span>
									</div>
									<p>{caso.clienteNombre}</p>
								</div>
								<div className="space-y-2">
									<div className="flex items-center gap-2 text-sm">
										<Banknote className="h-4 w-4 text-muted-foreground" />
										<span className="font-medium">Monto en Mora:</span>
									</div>
									<p className="font-bold text-lg text-red-600">
										Q{Number(caso.montoEnMora).toLocaleString()}
									</p>
								</div>
								<div className="space-y-2">
									<div className="flex items-center gap-2 text-sm">
										<CalendarClock className="h-4 w-4 text-muted-foreground" />
										<span className="font-medium">Días de Mora:</span>
									</div>
									<p>{caso.diasMoraMaximo} días</p>
								</div>
								<div className="space-y-2">
									<div className="flex items-center gap-2 text-sm">
										<FileText className="h-4 w-4 text-muted-foreground" />
										<span className="font-medium">Cuotas Vencidas:</span>
									</div>
									<p>{caso.cuotasVencidas} cuotas</p>
								</div>
							</div>
						</CardContent>
					</Card>

					{/* Información de Contacto */}
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<Phone className="h-5 w-5" />
								Información de Contacto
							</CardTitle>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="grid grid-cols-2 gap-4">
								<div>
									<p className="text-muted-foreground text-sm">
										Teléfono Principal
									</p>
									<p className="font-medium">{caso.telefonoPrincipal}</p>
								</div>
								{caso.telefonoAlternativo && (
									<div>
										<p className="text-muted-foreground text-sm">
											Teléfono Alternativo
										</p>
										<p className="font-medium">{caso.telefonoAlternativo}</p>
									</div>
								)}
								<div>
									<p className="text-muted-foreground text-sm">Email</p>
									<p className="font-medium">{caso.emailContacto}</p>
								</div>
								<div>
									<p className="text-muted-foreground text-sm">Dirección</p>
									<p className="font-medium">{caso.direccionContacto}</p>
								</div>
							</div>

							{/* Botones de Contacto - Solo si existe caso de cobros */}
							{caso.id ? (
								<>
									<Separator />
							<div className="flex gap-2">
								<ContactoModal
									casoCobroId={caso.id}
									clienteNombre={caso.clienteNombre || ""}
									telefonoPrincipal={caso.telefonoPrincipal || ""}
									metodoInicial="llamada"
								>
									<Button className="flex items-center gap-2">
										<Phone className="h-4 w-4" />
										Registrar Llamada
									</Button>
								</ContactoModal>

								<ContactoModal
									casoCobroId={caso.id}
									clienteNombre={caso.clienteNombre || ""}
									telefonoPrincipal={caso.telefonoPrincipal || ""}
									metodoInicial="whatsapp"
								>
									<Button variant="outline" className="flex items-center gap-2">
										<MessageCircle className="h-4 w-4" />
										WhatsApp
									</Button>
								</ContactoModal>

								<ContactoModal
									casoCobroId={caso.id}
									clienteNombre={caso.clienteNombre || ""}
									telefonoPrincipal={caso.telefonoPrincipal || ""}
									metodoInicial="email"
								>
									<Button variant="outline" className="flex items-center gap-2">
										<Mail className="h-4 w-4" />
										Email
									</Button>
								</ContactoModal>
							</div>
								</>
							) : (
								<div className="rounded-md border border-yellow-200 bg-yellow-50 p-4">
									<p className="text-sm text-yellow-800">
										Este crédito aún no tiene caso de cobros asignado. Se creará
										automáticamente cuando sea necesario realizar gestión de cobranza.
									</p>
								</div>
							)}
						</CardContent>
					</Card>

					{/* Historial de Contactos */}
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<Clock className="h-5 w-5" />
								Historial de Contactos
							</CardTitle>
							<CardDescription>
								Registro de todas las interacciones con el cliente
							</CardDescription>
						</CardHeader>
						<CardContent>
							{contactos.length === 0 ? (
								<div className="py-8 text-center text-muted-foreground">
									No hay contactos registrados para este caso
								</div>
							) : (
								<>
									<div className="space-y-4">
										{contactos
											.slice(
												(contactosPage - 1) * ITEMS_PER_PAGE,
												contactosPage * ITEMS_PER_PAGE,
											)
											.map((contacto: any) => {
												const estadoInfo = getEstadoContacto(
													contacto.estadoContacto,
												);
												return (
													<div
														key={contacto.id}
														className="rounded-lg border p-4"
													>
														<div className="mb-2 flex items-start justify-between">
															<div className="flex items-center gap-2">
																{getMetodoIcon(contacto.metodoContacto)}
																<span className="font-medium">
																	{contacto.metodoContacto
																		?.charAt(0)
																		.toUpperCase() +
																		contacto.metodoContacto?.slice(1)}
																</span>
																<Badge className={estadoInfo.color}>
																	{estadoInfo.label}
																</Badge>
															</div>
															<p className="text-muted-foreground text-sm">
																{contacto.fechaContacto
																	? new Date(
																			contacto.fechaContacto,
																		).toLocaleDateString("es-GT")
																	: "Sin fecha"}
															</p>
														</div>
														<p className="mb-2 text-sm">
															{contacto.comentarios}
														</p>
														{contacto.acuerdosAlcanzados && (
															<div className="rounded bg-blue-50 p-2 text-sm">
																<span className="font-medium">Acuerdos: </span>
																{contacto.acuerdosAlcanzados}
															</div>
														)}
														{contacto.compromisosPago && (
															<div className="mt-2 rounded bg-green-50 p-2 text-sm">
																<span className="font-medium">
																	Compromisos:{" "}
																</span>
																{contacto.compromisosPago}
															</div>
														)}
														<div className="mt-2 flex items-center justify-between text-muted-foreground text-xs">
															<span>
																Por: {contacto.realizadoPor || "Sin asignar"}
															</span>
															{contacto.duracionLlamada && (
																<span>
																	Duración:{" "}
																	{Math.floor(
																		(contacto.duracionLlamada || 0) / 60,
																	)}
																	:
																	{((contacto.duracionLlamada || 0) % 60)
																		.toString()
																		.padStart(2, "0")}{" "}
																	min
																</span>
															)}
														</div>
													</div>
												);
											})}
									</div>
									<Pagination
										currentPage={contactosPage}
										totalItems={contactos.length}
										itemsPerPage={ITEMS_PER_PAGE}
										onPageChange={setContactosPage}
									/>
								</>
							)}
						</CardContent>
					</Card>

					{/* Historial de Pagos */}
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<Banknote className="h-5 w-5" />
								Historial de Cuotas
							</CardTitle>
							<CardDescription>
								Estado de todas las cuotas del contrato de financiamiento
							</CardDescription>
						</CardHeader>
						<CardContent>
							{cuotas.length === 0 ? (
								<div className="py-8 text-center text-muted-foreground">
									No hay historial de cuotas disponible
								</div>
							) : (
								<>
									<div className="space-y-2">
										{cuotas
											.slice(
												(cuotasPage - 1) * ITEMS_PER_PAGE,
												cuotasPage * ITEMS_PER_PAGE,
											)
											.map((cuota: any) => {
												const estadoBadge = getEstadoBadge(cuota.estadoMora);
												const esPagada = cuota.estadoMora === "pagado";
												const tieneMora = Number(cuota.montoMora) > 0;
												const pagoConMora = esPagada && tieneMora; // Pagado pero con mora

												return (
													<div
														key={cuota.id}
														className="rounded-lg border p-3 hover:bg-muted/50"
													>
														<div className="mb-2 flex items-center justify-between">
															<div className="flex items-center gap-3">
																<span className="font-medium text-sm">
																	Cuota #{cuota.numeroCuota}
																</span>
																<Badge className={estadoBadge}>
																	{cuota.estadoMora
																		?.replace("_", " ")
																		?.toUpperCase()}
																</Badge>
																{pagoConMora && (
																	<Badge className="bg-orange-100 text-orange-800 text-xs">
																		Pagado con Mora
																	</Badge>
																)}
																{!esPagada && tieneMora && (
																	<Badge
																		variant="destructive"
																		className="text-xs"
																	>
																		{cuota.diasMora} días mora
																	</Badge>
																)}
															</div>
															<div className="text-right">
																<p className="font-medium text-sm">
																	Q{Number(cuota.montoCuota).toLocaleString()}
																</p>
																{tieneMora && (
																	<p className="text-red-600 text-xs">
																		+Q{Number(cuota.montoMora).toLocaleString()}{" "}
																		mora
																	</p>
																)}
															</div>
														</div>

														<div className="grid grid-cols-2 gap-4 text-muted-foreground text-xs">
															<div>
																<span className="font-medium">
																	Vencimiento:
																</span>
																<br />
																{new Date(
																	cuota.fechaVencimiento,
																).toLocaleDateString("es-GT")}
															</div>
															{esPagada ? (
																<div>
																	<span className="font-medium">Pagado:</span>
																	<br />
																	{cuota.fechaPago
																		? new Date(
																				cuota.fechaPago,
																			).toLocaleDateString("es-GT")
																		: "Sin fecha"}
																	<br />
																	<span className="font-medium text-green-600">
																		Q
																		{Number(
																			cuota.montoPagado || 0,
																		).toLocaleString()}
																	</span>
																	{pagoConMora && (
																		<span className="block text-orange-600 text-xs">
																			(incluye Q
																			{Number(cuota.montoMora).toLocaleString()}{" "}
																			de mora)
																		</span>
																	)}
																</div>
															) : (
																<div>
																	<span className="font-medium">Estado:</span>
																	<br />
																	<span className="text-red-600">
																		Pendiente de pago
																	</span>
																	{tieneMora && (
																		<span className="block font-medium text-red-600 text-xs">
																			Total: Q
																			{(
																				Number(cuota.montoCuota) +
																				Number(cuota.montoMora)
																			).toLocaleString()}
																		</span>
																	)}
																</div>
															)}
														</div>
													</div>
												);
											})}
									</div>
									<Pagination
										currentPage={cuotasPage}
										totalItems={cuotas.length}
										itemsPerPage={ITEMS_PER_PAGE}
										onPageChange={setCuotasPage}
									/>
								</>
							)}
						</CardContent>
					</Card>
				</div>

				{/* Sidebar */}
				<div className="space-y-6">
					{/* Próximo Contacto */}
					{caso.proximoContacto && (
						<Card>
							<CardHeader>
								<CardTitle className="flex items-center gap-2">
									<CalendarClock className="h-5 w-5" />
									Próximo Contacto
								</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="space-y-2">
									<div className="flex items-center gap-2">
										{getMetodoIcon(caso.metodoContactoProximo || "")}
										<span className="font-medium">
											{caso.metodoContactoProximo?.charAt(0).toUpperCase() +
												(caso.metodoContactoProximo?.slice(1) || "")}
										</span>
									</div>
									<p className="text-muted-foreground text-sm">
										{caso.proximoContacto
											? new Date(caso.proximoContacto).toLocaleDateString(
													"es-GT",
												)
											: "Sin fecha programada"}
									</p>
								</div>
							</CardContent>
						</Card>
					)}

					{/* Información del Contrato */}
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<FileText className="h-5 w-5" />
								Contrato
							</CardTitle>
						</CardHeader>
						<CardContent className="space-y-3">
							<div>
								<p className="text-muted-foreground text-sm">
									Monto Financiado
								</p>
								<p className="font-medium">
									Q{Number(caso.montoFinanciado || 0).toLocaleString()}
								</p>
							</div>
							<div>
								<p className="text-muted-foreground text-sm">Cuota Mensual</p>
								<p className="font-medium">
									Q{Number(caso.cuotaMensual || 0).toLocaleString()}
								</p>
							</div>
							<div>
								<p className="text-muted-foreground text-sm">Cuotas Totales</p>
								<p className="font-medium">{caso.numeroCuotas}</p>
							</div>
							<div>
								<p className="text-muted-foreground text-sm">Día de Pago</p>
								<p className="font-medium">
									Día {caso.diaPagoMensual || 15} de cada mes
								</p>
							</div>
							<div>
								<p className="text-muted-foreground text-sm">Fecha de Inicio</p>
								<p className="font-medium">
									{caso.fechaInicio
										? new Date(caso.fechaInicio).toLocaleDateString("es-GT")
										: "Sin fecha"}
								</p>
							</div>
						</CardContent>
					</Card>

					{/* Información del Vehículo */}
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<Car className="h-5 w-5" />
								Vehículo
							</CardTitle>
						</CardHeader>
						<CardContent className="space-y-3">
							<div>
								<p className="text-muted-foreground text-sm">Vehículo</p>
								<p className="font-medium">
									{caso.vehiculoMarca} {caso.vehiculoModelo} {caso.vehiculoYear}
								</p>
							</div>
							<div>
								<p className="text-muted-foreground text-sm">Placa</p>
								<p className="font-medium">{caso.vehiculoPlaca}</p>
							</div>
						</CardContent>
					</Card>

					{/* Convenios Activos */}
					{convenios.length > 0 && (
						<Card>
							<CardHeader>
								<CardTitle className="flex items-center gap-2">
									<Shield className="h-5 w-5" />
									Convenios de Pago
								</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="space-y-3">
									{convenios.map((convenio: any) => (
										<div key={convenio.id} className="rounded border p-3">
											<div className="mb-2 flex items-center justify-between">
												<Badge
													variant={convenio.activo ? "default" : "secondary"}
												>
													{convenio.activo ? "Activo" : "Inactivo"}
												</Badge>
												{convenio.cumplido && (
													<Badge className="bg-green-100 text-green-800">
														Cumplido
													</Badge>
												)}
											</div>
											<div className="space-y-1 text-sm">
												<p>
													<span className="font-medium">Monto:</span> Q
													{Number(convenio.montoAcordado).toLocaleString()}
												</p>
												<p>
													<span className="font-medium">Cuotas:</span>{" "}
													{convenio.cuotasCumplidas}/
													{convenio.numeroCuotasConvenio}
												</p>
												<p>
													<span className="font-medium">Cuota:</span> Q
													{Number(convenio.montoCuotaConvenio).toLocaleString()}
												</p>
												{convenio.condicionesEspeciales && (
													<p className="mt-2 text-muted-foreground text-xs">
														{convenio.condicionesEspeciales}
													</p>
												)}
											</div>
										</div>
									))}
								</div>
							</CardContent>
						</Card>
					)}

					{/* Información de Recuperación - Solo para casos incobrables */}
					{caso.estadoMora === "incobrable" && recuperacion && (
						<Card>
							<CardHeader>
								<CardTitle className="flex items-center gap-2">
									<Car className="h-5 w-5" />
									Recuperación de Vehículo
								</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="space-y-3">
									<div>
										<p className="text-muted-foreground text-sm">
											Tipo de Recuperación
										</p>
										<Badge
											className={
												recuperacion.tipoRecuperacion === "entrega_voluntaria"
													? "bg-blue-100 text-blue-800"
													: recuperacion.tipoRecuperacion === "tomado"
														? "bg-orange-100 text-orange-800"
														: recuperacion.tipoRecuperacion ===
																"orden_secuestro"
															? "bg-red-100 text-red-800"
															: "bg-gray-100 text-gray-800"
											}
										>
											{recuperacion.tipoRecuperacion === "entrega_voluntaria"
												? "Entrega Voluntaria"
												: recuperacion.tipoRecuperacion === "tomado"
													? "Tomado"
													: recuperacion.tipoRecuperacion === "orden_secuestro"
														? "Orden de Secuestro"
														: recuperacion.tipoRecuperacion}
										</Badge>
									</div>

									{recuperacion.fechaRecuperacion && (
										<div>
											<p className="text-muted-foreground text-sm">
												Fecha de Recuperación
											</p>
											<p className="font-medium">
												{new Date(
													recuperacion.fechaRecuperacion,
												).toLocaleDateString("es-GT")}
											</p>
										</div>
									)}

									{recuperacion.ordenSecuestro && (
										<div className="border-red-500 border-l-4 bg-red-50 py-2 pl-3">
											<h4 className="mb-1 font-medium text-red-800">
												Proceso Legal
											</h4>
											{recuperacion.numeroExpediente && (
												<p className="text-sm">
													<span className="font-medium">Expediente:</span>{" "}
													{recuperacion.numeroExpediente}
												</p>
											)}
											{recuperacion.juzgadoCompetente && (
												<p className="text-sm">
													<span className="font-medium">Juzgado:</span>{" "}
													{recuperacion.juzgadoCompetente}
												</p>
											)}
										</div>
									)}

									<div>
										<p className="text-muted-foreground text-sm">Estado</p>
										<Badge
											variant={
												recuperacion.completada ? "default" : "secondary"
											}
										>
											{recuperacion.completada ? "Completada" : "En Proceso"}
										</Badge>
									</div>

									{recuperacion.observaciones && (
										<div>
											<p className="text-muted-foreground text-sm">
												Observaciones
											</p>
											<p className="text-sm">{recuperacion.observaciones}</p>
										</div>
									)}

									{recuperacion.responsableRecuperacion && (
										<div>
											<p className="text-muted-foreground text-sm">
												Responsable
											</p>
											<p className="font-medium text-sm">
												{recuperacion.responsableRecuperacion}
											</p>
										</div>
									)}
								</div>
							</CardContent>
						</Card>
					)}
				</div>
			</div>
		</div>
	);
}
