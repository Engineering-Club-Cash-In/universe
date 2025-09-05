import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowLeft,
	CalendarClock,
	Car,
	Clock,
	DollarSign,
	FileText,
	Mail,
	MapPin,
	MessageCircle,
	Phone,
	Shield,
	User,
	Users,
} from "lucide-react";
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
import { ContactoModal } from "@/components/contacto-modal";

export const Route = createFileRoute("/cobros/$id")({
	component: RouteComponent,
	validateSearch: (search: Record<string, unknown>) => ({
		tipo: (search.tipo as "caso" | "contrato") || "caso",
	}),
});

function RouteComponent() {
	const { id } = Route.useParams();
	const { tipo } = Route.useSearch();
	const { data: session } = authClient.useSession();

	// Obtener detalles del contrato/caso usando la nueva API unificada
	const casoDetails = useQuery({
		...orpc.getDetallesContrato.queryOptions({
			input: { id, tipo }
		}),
		enabled: !!session && !!id,
	})

	// Obtener historial de contactos (solo para casos)
	const historialContactos = useQuery({
		...orpc.getHistorialContactos.queryOptions({
			input: { casoCobroId: id }
		}),
		enabled: !!session && !!id && tipo === "caso",
	})

	// Obtener convenios de pago (solo para casos)
	const conveniosPago = useQuery({
		...orpc.getConveniosPago.queryOptions({
			input: { casoCobroId: id }
		}),
		enabled: !!session && !!id && tipo === "caso",
	});

	// Obtener historial de pagos del contrato
	const historialPagos = useQuery({
		...orpc.getHistorialPagos.queryOptions({
			input: { contratoId: casoDetails.data?.contratoId || "" }
		}),
		enabled: !!session && !!casoDetails.data?.contratoId,
	});

	// Obtener información de recuperación si es caso incobrable
	const recuperacionInfo = useQuery({
		...orpc.getRecuperacionVehiculo.queryOptions({
			input: { casoCobroId: id }
		}),
		enabled: !!session && !!id && tipo === "caso" && casoDetails.data?.estadoMora === "incobrable",
	});

	if (casoDetails.isLoading) {
		return (
			<div className="container mx-auto p-6">
				<div className="animate-pulse">
					<div className="h-8 bg-gray-200 rounded mb-4"></div>
					<div className="h-4 bg-gray-200 rounded mb-2"></div>
					<div className="h-4 bg-gray-200 rounded mb-2"></div>
				</div>
			</div>
		)
	}

	if (!casoDetails.data) {
		return (
			<div className="container mx-auto p-6">
				<div className="text-center">
					<h1 className="text-2xl font-bold text-gray-900 mb-4">
						Caso No Encontrado
					</h1>
					<p className="text-gray-600 mb-4">
						No se encontró el caso de cobranza solicitado.
					</p>
					<Link to="/cobros">
						<Button variant="outline">
							<ArrowLeft className="h-4 w-4 mr-2" />
							Volver a Cobros
						</Button>
					</Link>
				</div>
			</div>
		)
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
		}
		return colors[estado] || "bg-gray-100 text-gray-800";
	}

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
	}

	const getEstadoContacto = (estado: string) => {
		const estados: Record<string, { label: string; color: string }> = {
			contactado: { label: "Contactado", color: "bg-green-100 text-green-800" },
			promesa_pago: { label: "Promesa de Pago", color: "bg-blue-100 text-blue-800" },
			no_contesta: { label: "No Contesta", color: "bg-yellow-100 text-yellow-800" },
			acuerdo_parcial: { label: "Acuerdo Parcial", color: "bg-purple-100 text-purple-800" },
			rechaza_pagar: { label: "Rechaza Pagar", color: "bg-red-100 text-red-800" },
			numero_equivocado: { label: "Número Equivocado", color: "bg-gray-100 text-gray-800" },
		}
		return estados[estado] || { label: estado, color: "bg-gray-100 text-gray-800" };
	}

	return (
		<div className="container mx-auto p-6 space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-4">
					<Link to="/cobros">
						<Button variant="outline" size="sm">
							<ArrowLeft className="h-4 w-4 mr-2" />
							Volver
						</Button>
					</Link>
					<div>
						<h1 className="text-2xl font-bold">Detalles del Caso</h1>
						<p className="text-muted-foreground">
							{caso.vehiculoMarca} {caso.vehiculoModelo} {caso.vehiculoYear} - {caso.vehiculoPlaca}
						</p>
					</div>
				</div>
				<Badge className={getEstadoBadge(caso.estadoMora || "")}>
					{caso.estadoMora?.replace("_", " ")?.toUpperCase()}
				</Badge>
			</div>

			<div className="grid gap-6 lg:grid-cols-3">
				{/* Información Principal */}
				<div className="lg:col-span-2 space-y-6">
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
										<DollarSign className="h-4 w-4 text-muted-foreground" />
										<span className="font-medium">Monto en Mora:</span>
									</div>
									<p className="text-lg font-bold text-red-600">
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
									<p className="text-sm text-muted-foreground">Teléfono Principal</p>
									<p className="font-medium">{caso.telefonoPrincipal}</p>
								</div>
								{caso.telefonoAlternativo && (
									<div>
										<p className="text-sm text-muted-foreground">Teléfono Alternativo</p>
										<p className="font-medium">{caso.telefonoAlternativo}</p>
									</div>
								)}
								<div>
									<p className="text-sm text-muted-foreground">Email</p>
									<p className="font-medium">{caso.emailContacto}</p>
								</div>
								<div>
									<p className="text-sm text-muted-foreground">Dirección</p>
									<p className="font-medium">{caso.direccionContacto}</p>
								</div>
							</div>

							{/* Botones de Contacto */}
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
								<div className="text-center py-8 text-muted-foreground">
									No hay contactos registrados para este caso
								</div>
							) : (
								<div className="space-y-4">
									{contactos.map((contacto: any) => {
										const estadoInfo = getEstadoContacto(contacto.estadoContacto);
										return (
											<div key={contacto.id} className="border rounded-lg p-4">
												<div className="flex items-start justify-between mb-2">
													<div className="flex items-center gap-2">
														{getMetodoIcon(contacto.metodoContacto)}
														<span className="font-medium">
															{contacto.metodoContacto?.charAt(0).toUpperCase() + contacto.metodoContacto?.slice(1)}
														</span>
														<Badge className={estadoInfo.color}>
															{estadoInfo.label}
														</Badge>
													</div>
													<p className="text-sm text-muted-foreground">
														{contacto.fechaContacto ? new Date(contacto.fechaContacto).toLocaleDateString("es-GT") : "Sin fecha"}
													</p>
												</div>
												<p className="text-sm mb-2">{contacto.comentarios}</p>
												{contacto.acuerdosAlcanzados && (
													<div className="bg-blue-50 p-2 rounded text-sm">
														<span className="font-medium">Acuerdos: </span>
														{contacto.acuerdosAlcanzados}
													</div>
												)}
												{contacto.compromisosPago && (
													<div className="bg-green-50 p-2 rounded text-sm mt-2">
														<span className="font-medium">Compromisos: </span>
														{contacto.compromisosPago}
													</div>
												)}
												<div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
													<span>Por: {contacto.realizadoPor || "Sin asignar"}</span>
													{contacto.duracionLlamada && (
														<span>Duración: {Math.floor((contacto.duracionLlamada || 0) / 60)}:{((contacto.duracionLlamada || 0) % 60).toString().padStart(2, "0")} min</span>
													)}
												</div>
											</div>
										)
									})}
								</div>
							)}
						</CardContent>
					</Card>

					{/* Historial de Pagos */}
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<DollarSign className="h-5 w-5" />
								Historial de Cuotas
							</CardTitle>
							<CardDescription>
								Estado de todas las cuotas del contrato de financiamiento
							</CardDescription>
						</CardHeader>
						<CardContent>
							{cuotas.length === 0 ? (
								<div className="text-center py-8 text-muted-foreground">
									No hay historial de cuotas disponible
								</div>
							) : (
								<div className="space-y-2">
									{cuotas.map((cuota: any) => {
										const estadoBadge = getEstadoBadge(cuota.estadoMora);
										const esPagada = cuota.estadoMora === "pagado";
										const tieneMora = Number(cuota.montoMora) > 0;
										const pagoConMora = esPagada && tieneMora; // Pagado pero con mora
										
										return (
											<div key={cuota.id} className="border rounded-lg p-3 hover:bg-muted/50">
												<div className="flex items-center justify-between mb-2">
													<div className="flex items-center gap-3">
														<span className="font-medium text-sm">
															Cuota #{cuota.numeroCuota}
														</span>
														<Badge className={estadoBadge}>
															{cuota.estadoMora?.replace("_", " ")?.toUpperCase()}
														</Badge>
														{pagoConMora && (
															<Badge className="bg-orange-100 text-orange-800 text-xs">
																Pagado con Mora
															</Badge>
														)}
														{!esPagada && tieneMora && (
															<Badge variant="destructive" className="text-xs">
																{cuota.diasMora} días mora
															</Badge>
														)}
													</div>
													<div className="text-right">
														<p className="font-medium text-sm">
															Q{Number(cuota.montoCuota).toLocaleString()}
														</p>
														{tieneMora && (
															<p className="text-xs text-red-600">
																+Q{Number(cuota.montoMora).toLocaleString()} mora
															</p>
														)}
													</div>
												</div>
												
												<div className="grid grid-cols-2 gap-4 text-xs text-muted-foreground">
													<div>
														<span className="font-medium">Vencimiento:</span><br />
														{new Date(cuota.fechaVencimiento).toLocaleDateString("es-GT")}
													</div>
													{esPagada ? (
														<div>
															<span className="font-medium">Pagado:</span><br />
															{cuota.fechaPago ? new Date(cuota.fechaPago).toLocaleDateString("es-GT") : "Sin fecha"}
															<br />
															<span className="text-green-600 font-medium">
																Q{Number(cuota.montoPagado || 0).toLocaleString()}
															</span>
															{pagoConMora && (
																<span className="block text-xs text-orange-600">
																	(incluye Q{Number(cuota.montoMora).toLocaleString()} de mora)
																</span>
															)}
														</div>
													) : (
														<div>
															<span className="font-medium">Estado:</span><br />
															<span className="text-red-600">Pendiente de pago</span>
															{tieneMora && (
																<span className="block text-xs text-red-600 font-medium">
																	Total: Q{(Number(cuota.montoCuota) + Number(cuota.montoMora)).toLocaleString()}
																</span>
															)}
														</div>
													)}
												</div>
											</div>
										);
									})}
								</div>
							)}
						</CardContent>
					</Card>
				</div>

				{/* Sidebar */}
				<div className="space-y-6">
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
								<p className="text-sm text-muted-foreground">Monto Financiado</p>
								<p className="font-medium">Q{Number(caso.montoFinanciado || 0).toLocaleString()}</p>
							</div>
							<div>
								<p className="text-sm text-muted-foreground">Cuota Mensual</p>
								<p className="font-medium">Q{Number(caso.cuotaMensual || 0).toLocaleString()}</p>
							</div>
							<div>
								<p className="text-sm text-muted-foreground">Cuotas Totales</p>
								<p className="font-medium">{caso.numeroCuotas}</p>
							</div>
							<div>
								<p className="text-sm text-muted-foreground">Día de Pago</p>
								<p className="font-medium">Día {caso.diaPagoMensual || 15} de cada mes</p>
							</div>
							<div>
								<p className="text-sm text-muted-foreground">Fecha de Inicio</p>
								<p className="font-medium">{caso.fechaInicio ? new Date(caso.fechaInicio).toLocaleDateString("es-GT") : "Sin fecha"}</p>
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
								<p className="text-sm text-muted-foreground">Vehículo</p>
								<p className="font-medium">
									{caso.vehiculoMarca} {caso.vehiculoModelo} {caso.vehiculoYear}
								</p>
							</div>
							<div>
								<p className="text-sm text-muted-foreground">Placa</p>
								<p className="font-medium">{caso.vehiculoPlaca}</p>
							</div>
						</CardContent>
					</Card>

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
											{caso.metodoContactoProximo?.charAt(0).toUpperCase() + (caso.metodoContactoProximo?.slice(1) || "")}
										</span>
									</div>
									<p className="text-sm text-muted-foreground">
										{caso.proximoContacto ? new Date(caso.proximoContacto).toLocaleDateString("es-GT") : "Sin fecha programada"}
									</p>
								</div>
							</CardContent>
						</Card>
					)}

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
										<div key={convenio.id} className="border rounded p-3">
											<div className="flex items-center justify-between mb-2">
												<Badge variant={convenio.activo ? "default" : "secondary"}>
													{convenio.activo ? "Activo" : "Inactivo"}
												</Badge>
												{convenio.cumplido && (
													<Badge className="bg-green-100 text-green-800">
														Cumplido
													</Badge>
												)}
											</div>
											<div className="text-sm space-y-1">
												<p><span className="font-medium">Monto:</span> Q{Number(convenio.montoAcordado).toLocaleString()}</p>
												<p><span className="font-medium">Cuotas:</span> {convenio.cuotasCumplidas}/{convenio.numeroCuotasConvenio}</p>
												<p><span className="font-medium">Cuota:</span> Q{Number(convenio.montoCuotaConvenio).toLocaleString()}</p>
												{convenio.condicionesEspeciales && (
													<p className="text-xs text-muted-foreground mt-2">
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
										<p className="text-sm text-muted-foreground">Tipo de Recuperación</p>
										<Badge className={
											recuperacion.tipoRecuperacion === "entrega_voluntaria" ? "bg-blue-100 text-blue-800" :
											recuperacion.tipoRecuperacion === "tomado" ? "bg-orange-100 text-orange-800" :
											recuperacion.tipoRecuperacion === "orden_secuestro" ? "bg-red-100 text-red-800" :
											"bg-gray-100 text-gray-800"
										}>
											{recuperacion.tipoRecuperacion === "entrega_voluntaria" ? "Entrega Voluntaria" :
											 recuperacion.tipoRecuperacion === "tomado" ? "Tomado" :
											 recuperacion.tipoRecuperacion === "orden_secuestro" ? "Orden de Secuestro" :
											 recuperacion.tipoRecuperacion}
										</Badge>
									</div>

									{recuperacion.fechaRecuperacion && (
										<div>
											<p className="text-sm text-muted-foreground">Fecha de Recuperación</p>
											<p className="font-medium">
												{new Date(recuperacion.fechaRecuperacion).toLocaleDateString("es-GT")}
											</p>
										</div>
									)}

									{recuperacion.ordenSecuestro && (
										<div className="border-l-4 border-red-500 pl-3 py-2 bg-red-50">
											<h4 className="font-medium text-red-800 mb-1">Proceso Legal</h4>
											{recuperacion.numeroExpediente && (
												<p className="text-sm">
													<span className="font-medium">Expediente:</span> {recuperacion.numeroExpediente}
												</p>
											)}
											{recuperacion.juzgadoCompetente && (
												<p className="text-sm">
													<span className="font-medium">Juzgado:</span> {recuperacion.juzgadoCompetente}
												</p>
											)}
										</div>
									)}

									<div>
										<p className="text-sm text-muted-foreground">Estado</p>
										<Badge variant={recuperacion.completada ? "default" : "secondary"}>
											{recuperacion.completada ? "Completada" : "En Proceso"}
										</Badge>
									</div>

									{recuperacion.observaciones && (
										<div>
											<p className="text-sm text-muted-foreground">Observaciones</p>
											<p className="text-sm">{recuperacion.observaciones}</p>
										</div>
									)}

									{recuperacion.responsableRecuperacion && (
										<div>
											<p className="text-sm text-muted-foreground">Responsable</p>
											<p className="text-sm font-medium">{recuperacion.responsableRecuperacion}</p>
										</div>
									)}
								</div>
							</CardContent>
						</Card>
					)}
				</div>
			</div>
		</div>
	)
}