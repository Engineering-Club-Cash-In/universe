import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
	CalendarIcon,
	ChevronDown,
	Loader2,
	Mail,
	MessageCircle,
	MessageSquare,
	Phone,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
	accionUsaCuerpoNoReply,
	crearUrlWhatsappManual,
	cuerpoParaValidarNoReply,
	interpolar,
	mensajeEmailEditable,
	mensajePlantillaEditable,
	mensajeSmsEditable,
	PLANTILLAS_MENSAJES,
	prepararTelefonoAsesorParaEnvio,
	sugerirPlantilla,
	type VariablesPlantilla,
} from "@/lib/cobros/plantillas-mensajes";
import { cn } from "@/lib/utils";
import { client, orpc } from "@/utils/orpc";

interface ContactoModalProps {
	casoCobroId: string;
	clienteNombre: string;
	telefonoPrincipal: string;
	telefonoAlternativo?: string;
	emailCliente?: string;
	metodoInicial: "llamada" | "whatsapp" | "email";
	children?: React.ReactNode;
	// Modo controlado opcional (cuando el padre maneja el estado open)
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	// CB-020: "promesa" = modal reducido — solo Detalles de la Conversación +
	// fecha prometida (obligatoria). Oculta método/estado/plantilla/envío:
	// esos ya quedan fijos (estadoContacto=promesa_pago) porque la promesa se
	// registra DESPUÉS de haber contactado al cliente por otro medio.
	variante?: "completo" | "promesa";
	// CB-020: cuotas ATRASADAS (no pagadas Y ya vencidas — no incluye cuotas
	// futuras aún no vencidas) para el selector de rango en variante "promesa".
	// $id.tsx filtra por fechaVencimiento < hoy antes de pasarlas — reusa la
	// data que ya carga vía getHistorialPagos, no duplica el fetch aquí.
	cuotasDisponibles?: Array<{ numeroCuota: number }>;
	// Variables para plantillas de mensaje
	fechaPago?: string;
	cuotaMensual?: string;
	placa?: string;
	marcaLineaModelo?: string;
	montoAdeudado?: string;
	cuotasAtraso?: number;
	estadoMora?: string;
	fechaInicio?: string | null;
	nombreAsesor?: string;
	telefonoAsesor?: string;
}

export function ContactoModal({
	casoCobroId,
	clienteNombre,
	telefonoPrincipal,
	telefonoAlternativo,
	emailCliente,
	metodoInicial,
	children,
	open,
	onOpenChange,
	variante = "completo",
	cuotasDisponibles = [],
	fechaPago = "",
	cuotaMensual = "",
	placa = "",
	marcaLineaModelo = "",
	montoAdeudado = "",
	cuotasAtraso = 0,
	estadoMora,
	fechaInicio,
	nombreAsesor = "",
	telefonoAsesor = "",
}: ContactoModalProps) {
	const queryClient = useQueryClient();

	const telefonos = useMemo(() => {
		const lista: string[] = [];
		// telefonoPrincipal puede traer varios números separados por coma
		if (telefonoPrincipal) {
			for (const t of telefonoPrincipal.split(",")) {
				const limpio = t.trim();
				if (limpio) lista.push(limpio);
			}
		}
		if (telefonoAlternativo) {
			for (const t of telefonoAlternativo.split(",")) {
				const limpio = t.trim();
				if (limpio && !lista.includes(limpio)) lista.push(limpio);
			}
		}
		return lista;
	}, [telefonoPrincipal, telefonoAlternativo]);

	const [telefonoSeleccionado, setTelefonoSeleccionado] = useState(
		() => telefonos[0] || telefonoPrincipal,
	);

	const [plantillaId, setPlantillaId] = useState<string>("");
	const [mensajeEditado, setMensajeEditado] = useState("");
	const [mensajeWhatsappEditado, setMensajeWhatsappEditado] = useState("");
	const [asuntoEditado, setAsuntoEditado] = useState("");

	const telefonoAsesorLimpio = telefonoAsesor.trim();

	const variables: VariablesPlantilla = useMemo(
		() => ({
			clienteNombre,
			fechaPago,
			cuotaMensual,
			placa,
			marcaLineaModelo,
			montoAdeudado,
			cuotasAtraso,
			telefonoAsesor: telefonoAsesorLimpio,
			nombreAsesor,
		}),
		[
			clienteNombre,
			fechaPago,
			cuotaMensual,
			placa,
			marcaLineaModelo,
			montoAdeudado,
			cuotasAtraso,
			telefonoAsesorLimpio,
			nombreAsesor,
		],
	);

	// Pre-seleccionar plantilla sugerida al abrir
	useEffect(() => {
		const sugerida = sugerirPlantilla(estadoMora, fechaInicio);
		setPlantillaId(sugerida);
		const plantilla = PLANTILLAS_MENSAJES.find((p) => p.id === sugerida);
		if (plantilla) {
			setMensajeEditado(interpolar(plantilla.cuerpo, variables));
			setMensajeWhatsappEditado(
				interpolar(plantilla.cuerpoWhastapp || plantilla.cuerpo, variables),
			);
			setAsuntoEditado(interpolar(plantilla.asunto, variables));
		}
	}, [estadoMora, fechaInicio, variables]);

	const handlePlantillaChange = (id: string) => {
		setPlantillaId(id);
		const plantilla = PLANTILLAS_MENSAJES.find((p) => p.id === id);
		if (plantilla) {
			setMensajeEditado(interpolar(plantilla.cuerpo, variables));
			setMensajeWhatsappEditado(
				interpolar(plantilla.cuerpoWhastapp || plantilla.cuerpo, variables),
			);
			setAsuntoEditado(interpolar(plantilla.asunto, variables));
		}
	};

	const esPromesa = variante === "promesa";

	const form = useForm({
		defaultValues: {
			metodoContacto: metodoInicial,
			// CB-020: variante promesa fija el estado — no pasa por el selector.
			estadoContacto: (esPromesa ? "promesa_pago" : "contactado") as
				| "contactado"
				| "no_contesta"
				| "numero_equivocado"
				| "promesa_pago"
				| "acuerdo_parcial"
				| "rechaza_pagar",
			comentarios: "",
			acuerdosAlcanzados: "",
			compromisosPago: "",
			// La fecha prometida ES la fecha de próximo contacto — nunca opcional
			// en la variante promesa (por eso arranca en true).
			requiereSeguimiento: esPromesa,
			fechaProximoContacto: undefined as Date | undefined,
			duracionLlamada: undefined as number | undefined,
			// CB-020: rango de cuotas + mora — solo relevantes en variante promesa.
			cuotaInicio: undefined as number | undefined,
			cuotaFin: undefined as number | undefined,
			incluyeMora: false,
		},
		onSubmit: async ({ value }) => {
			createContactoMutation.mutate(value);
		},
	});

	const createContactoMutation = useMutation({
		mutationFn: (data: any) =>
			client.createContactoCobros({
				casoCobroId,
				...data,
			}),
		onSuccess: () => {
			toast.success("Contacto registrado correctamente");
			queryClient.invalidateQueries(
				orpc.getHistorialContactos.queryOptions({ input: { casoCobroId } }),
			);
			queryClient.invalidateQueries({
				predicate: (query) =>
					query.queryKey.some(
						(k) =>
							typeof k === "string" &&
							k.includes("getDetallesCreditoCarteraBack"),
					),
			});
			form.reset();
			document
				.querySelector<HTMLButtonElement>("[data-radix-dialog-close]")
				?.click();
		},
		onError: (error: any) => {
			toast.error(error.message || "Error al registrar el contacto");
		},
	});

	const getIconoMetodo = (metodo: string) => {
		switch (metodo) {
			case "llamada":
				return <Phone className="h-4 w-4" />;
			case "whatsapp":
				return <MessageCircle className="h-4 w-4" />;
			case "email":
				return <Mail className="h-4 w-4" />;
			default:
				return <Phone className="h-4 w-4" />;
		}
	};

	type AccionContacto =
		| "llamada"
		| "whatsapp-link"
		| "whatsapp-api"
		| "email-link"
		| "email-api"
		| "sms-api";

	const whatsappApiMutation = useMutation({
		mutationFn: (vars: { telefono: string; mensaje: string }) =>
			client.enviarWhatsappCobros({
				...vars,
				casoCobroId,
				plantillaId: plantillaId || undefined,
			}),
		onSuccess: (res) => {
			if (res.success) toast.success("WhatsApp enviado correctamente");
		},
		onError: (error: any) =>
			toast.error(error?.message || "Error enviando WhatsApp"),
	});

	const emailApiMutation = useMutation({
		mutationFn: (vars: {
			destinatario: string;
			asunto: string;
			mensaje: string;
		}) =>
			client.enviarEmailCobros({
				...vars,
				casoCobroId,
				plantillaId: plantillaId || undefined,
			}),
		onSuccess: (res) => {
			if (res.success) toast.success("Email enviado correctamente");
		},
		onError: (error: any) =>
			toast.error(error?.message || "Error enviando email"),
	});

	const smsApiMutation = useMutation({
		mutationFn: (vars: { telefono: string; mensaje: string }) =>
			client.enviarSmsCobros({
				...vars,
				casoCobroId,
				plantillaId: plantillaId || undefined,
			}),
		onSuccess: (res) => {
			if (res.success) toast.success("SMS enviado correctamente");
		},
		onError: (error: any) =>
			toast.error(error?.message || "Error enviando SMS"),
	});

	const envioEnCurso =
		whatsappApiMutation.isPending ||
		emailApiMutation.isPending ||
		smsApiMutation.isPending;

	const ejecutarAccion = (metodo: AccionContacto) => {
		const tel = telefonoSeleccionado || telefonoPrincipal;
		const telLimpio = tel.replace(/[^0-9]/g, "");
		const mensajeWhatsapp = mensajePlantillaEditable(
			"whatsapp",
			mensajeEditado,
			mensajeWhatsappEditado,
		);
		const mensajeSms = mensajeSmsEditable(
			metodoInicial,
			mensajeEditado,
			mensajeWhatsappEditado,
		);
		const mensajeEmail = mensajeEmailEditable(
			metodoInicial,
			mensajeEditado,
			mensajeWhatsappEditado,
		);
		const cuerpoNoReply = cuerpoParaValidarNoReply(
			metodo,
			mensajeWhatsapp,
			mensajeSms,
			mensajeEmail,
		);
		const telefonoAsesorNoReply = prepararTelefonoAsesorParaEnvio(
			cuerpoNoReply,
			telefonoAsesorLimpio,
		);
		if (accionUsaCuerpoNoReply(metodo) && !telefonoAsesorNoReply.enviar) {
			toast.error(
				"No se puede enviar esta plantilla no-reply porque el asesor no tiene teléfono registrado",
			);
			return;
		}
		switch (metodo) {
			case "llamada":
				window.open(`tel:${tel}`);
				break;
			case "whatsapp-link": {
				const url = crearUrlWhatsappManual(telLimpio, mensajeWhatsapp);
				window.open(url);
				break;
			}
			case "whatsapp-api":
				if (!telLimpio) {
					toast.error("No hay teléfono para enviar WhatsApp");
					return;
				}
				if (!mensajeWhatsapp.trim()) {
					toast.error("No hay mensaje para enviar");
					return;
				}
				whatsappApiMutation.mutate({
					telefono: telLimpio,
					mensaje: mensajeWhatsapp,
				});
				break;
			case "email-link": {
				const params = new URLSearchParams();
				if (asuntoEditado) params.set("subject", asuntoEditado);
				if (mensajeEmail) params.set("body", mensajeEmail);
				const query = params.toString();
				window.open(`mailto:${emailCliente || ""}${query ? `?${query}` : ""}`);
				break;
			}
			case "email-api":
				if (!emailCliente) {
					toast.error("No hay email de destino");
					return;
				}
				if (!asuntoEditado.trim()) {
					toast.error("El asunto es requerido");
					return;
				}
				if (!mensajeEmail.trim()) {
					toast.error("El mensaje es requerido");
					return;
				}
				emailApiMutation.mutate({
					destinatario: emailCliente,
					asunto: asuntoEditado,
					mensaje: mensajeEmail,
				});
				break;
			case "sms-api":
				if (!telLimpio) {
					toast.error("No hay teléfono para enviar SMS");
					return;
				}
				if (!mensajeSms.trim()) {
					toast.error("No hay mensaje para enviar");
					return;
				}
				smsApiMutation.mutate({
					telefono: telLimpio,
					mensaje: mensajeSms,
				});
				break;
		}
	};

	const mostrarPlantillas =
		metodoInicial === "whatsapp" || metodoInicial === "email";
	const mensajeEditable = mensajePlantillaEditable(
		metodoInicial,
		mensajeEditado,
		mensajeWhatsappEditado,
	);
	const handleMensajeEditableChange = (mensaje: string) => {
		if (metodoInicial === "whatsapp") {
			setMensajeWhatsappEditado(mensaje);
			return;
		}

		setMensajeEditado(mensaje);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			{children && <DialogTrigger asChild>{children}</DialogTrigger>}
			<DialogContent className="max-h-[90vh] min-w-3xl max-w-4xl overflow-y-auto">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						{esPromesa ? (
							<MessageSquare className="h-4 w-4" />
						) : (
							getIconoMetodo(metodoInicial)
						)}
						{esPromesa ? "Promesa de Pago" : "Registrar Contacto"} -{" "}
						{clienteNombre}
					</DialogTitle>
					<DialogDescription>
						{esPromesa
							? "Registra lo hablado y la fecha en la que el cliente prometió pagar."
							: "Registra los detalles de la interacción con el cliente y programa el próximo seguimiento."}
					</DialogDescription>
				</DialogHeader>

				<form
					onSubmit={(e) => {
						e.preventDefault();
						e.stopPropagation();
						form.handleSubmit();
					}}
					className="space-y-6"
				>
					{/* Sección: Información del Contacto — oculta en variante "promesa":
					    el método/estado/plantilla/envío no aplican, la promesa se
					    registra sobre un contacto que ya ocurrió por otro medio. */}
					{!esPromesa && (
						<div className="space-y-4">
							<h3 className="font-medium text-lg">Información del Contacto</h3>

							<div className="grid grid-cols-2 gap-4">
								<form.Field name="metodoContacto">
									{(field) => (
										<div className="space-y-2">
											<Label>Método de Contacto</Label>
											<Select
												onValueChange={(value) =>
													form.setFieldValue(
														field.name,
														value as typeof field.state.value,
													)
												}
												defaultValue={field.state.value}
											>
												<SelectTrigger>
													<SelectValue placeholder="Seleccionar método" />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="llamada">📞 Llamada</SelectItem>
													<SelectItem value="whatsapp">💬 WhatsApp</SelectItem>
													<SelectItem value="email">📧 Email</SelectItem>
													<SelectItem value="visita_domicilio">
														🏠 Visita Domicilio
													</SelectItem>
													<SelectItem value="carta_notarial">
														📋 Carta Notarial
													</SelectItem>
												</SelectContent>
											</Select>
										</div>
									)}
								</form.Field>

								<form.Field name="estadoContacto">
									{(field) => (
										<div className="space-y-2">
											<Label>Estado del Contacto</Label>
											<Select
												onValueChange={(value) =>
													form.setFieldValue(
														field.name,
														value as typeof field.state.value,
													)
												}
												defaultValue={field.state.value}
											>
												<SelectTrigger>
													<SelectValue placeholder="Estado del contacto" />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="contactado">
														✅ Contactado
													</SelectItem>
													<SelectItem value="no_contesta">
														❌ No Contesta
													</SelectItem>
													<SelectItem value="numero_equivocado">
														📱 Número Equivocado
													</SelectItem>
													{/* CB-020: "Promesa de Pago" se registra SOLO desde el
													    botón dedicado (modal reducido) — no aquí. */}
													<SelectItem value="acuerdo_parcial">
														📝 Acuerdo Parcial
													</SelectItem>
													<SelectItem value="rechaza_pagar">
														🚫 Rechaza Pagar
													</SelectItem>
												</SelectContent>
											</Select>
										</div>
									)}
								</form.Field>
							</div>

							{/* Selector de plantilla para WhatsApp y Email */}
							{mostrarPlantillas && (
								<div className="space-y-3 rounded-md border p-3">
									<div className="space-y-2">
										<Label>Plantilla de mensaje</Label>
										<Select
											value={plantillaId}
											onValueChange={handlePlantillaChange}
										>
											<SelectTrigger>
												<SelectValue placeholder="Seleccionar plantilla..." />
											</SelectTrigger>
											<SelectContent>
												{PLANTILLAS_MENSAJES.map((p) => (
													<SelectItem key={p.id} value={p.id}>
														{p.nombre}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>

									{plantillaId && metodoInicial === "email" && (
										<div className="space-y-2">
											<Label>Asunto</Label>
											<Input
												value={asuntoEditado}
												onChange={(e) => setAsuntoEditado(e.target.value)}
											/>
										</div>
									)}

									{plantillaId && (
										<div className="space-y-2">
											<Label>Mensaje (editable)</Label>
											<Textarea
												className="min-h-[150px] text-sm"
												value={mensajeEditable}
												onChange={(e) =>
													handleMensajeEditableChange(e.target.value)
												}
											/>
										</div>
									)}
								</div>
							)}

							{/* Selector de teléfono cuando hay múltiples */}
							{telefonos.length > 1 && (
								<div className="space-y-2">
									<Label>Teléfono a contactar</Label>
									<Select
										value={telefonoSeleccionado}
										onValueChange={setTelefonoSeleccionado}
									>
										<SelectTrigger>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{telefonos.map((t) => (
												<SelectItem key={t} value={t}>
													{t}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							)}

							{/* Botones para ejecutar acción */}
							<div className="flex flex-wrap gap-2">
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => ejecutarAccion("llamada")}
									disabled={envioEnCurso}
									className="flex items-center gap-2"
								>
									<Phone className="h-4 w-4" />
									Llamar {telefonos.length <= 1 ? telefonos[0] || "" : ""}
								</Button>

								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button
											type="button"
											variant="outline"
											size="sm"
											disabled={envioEnCurso}
											className="flex items-center gap-2"
										>
											{whatsappApiMutation.isPending ? (
												<Loader2 className="h-4 w-4 animate-spin" />
											) : (
												<MessageCircle className="h-4 w-4" />
											)}
											WhatsApp
											{whatsappApiMutation.isPending ? null : (
												<ChevronDown className="h-3 w-3" />
											)}
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="start">
										<DropdownMenuItem
											onClick={() => ejecutarAccion("whatsapp-api")}
										>
											Enviar Directo (Automático)
										</DropdownMenuItem>
										<DropdownMenuItem
											onClick={() => ejecutarAccion("whatsapp-link")}
										>
											Abrir WhatsApp Web (Manual)
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>

								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button
											type="button"
											variant="outline"
											size="sm"
											disabled={envioEnCurso}
											className="flex items-center gap-2"
										>
											{emailApiMutation.isPending ? (
												<Loader2 className="h-4 w-4 animate-spin" />
											) : (
												<Mail className="h-4 w-4" />
											)}
											Email
											{emailApiMutation.isPending ? null : (
												<ChevronDown className="h-3 w-3" />
											)}
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="start">
										<DropdownMenuItem
											onClick={() => ejecutarAccion("email-api")}
										>
											Enviar Directo (Automático)
										</DropdownMenuItem>
										<DropdownMenuItem
											onClick={() => ejecutarAccion("email-link")}
										>
											Abrir cliente de correo (Manual)
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>

								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => ejecutarAccion("sms-api")}
									disabled={envioEnCurso}
									className="flex items-center gap-2"
								>
									{smsApiMutation.isPending ? (
										<Loader2 className="h-4 w-4 animate-spin" />
									) : (
										<MessageSquare className="h-4 w-4" />
									)}
									{smsApiMutation.isPending ? "Enviando SMS..." : "SMS"}
								</Button>
							</div>

							<form.Field name="metodoContacto">
								{(metodoField) =>
									metodoField.state.value === "llamada" && (
										<form.Field name="duracionLlamada">
											{(field) => (
												<div className="space-y-2">
													<Label>Duración de la Llamada (segundos)</Label>
													<Input
														type="number"
														placeholder="Ej: 180"
														value={field.state.value}
														onChange={(e) =>
															field.handleChange(Number(e.target.value))
														}
													/>
												</div>
											)}
										</form.Field>
									)
								}
							</form.Field>
						</div>
					)}

					{/* Sección: Detalles de la Conversación */}
					<div className="space-y-4">
						<h3 className="font-medium text-lg">Detalles de la Conversación</h3>

						<form.Field
							name="comentarios"
							validators={{
								onChange: ({ value }) =>
									!value ? "Los comentarios son requeridos" : undefined,
							}}
						>
							{(field) => (
								<div className="space-y-2">
									<Label>Comentarios *</Label>
									<Textarea
										placeholder="Describe qué se habló en el contacto, la actitud del cliente, etc."
										className="min-h-[100px]"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
									/>
									{field.state.meta.isTouched &&
										field.state.meta.errors.length > 0 && (
											<p className="text-red-500 text-sm">
												{field.state.meta.errors.join(", ")}
											</p>
										)}
								</div>
							)}
						</form.Field>

						<div className="grid grid-cols-2 gap-4">
							<form.Field name="acuerdosAlcanzados">
								{(field) => (
									<div className="space-y-2">
										<Label>Acuerdos Alcanzados</Label>
										<Textarea
											placeholder="Describe cualquier acuerdo o compromiso establecido"
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
										/>
									</div>
								)}
							</form.Field>

							<form.Field name="estadoContacto">
								{(estadoField) => (
									<form.Field
										name="compromisosPago"
										validators={{
											onChange: ({ value, fieldApi }) => {
												const estadoContacto =
													form.getFieldValue("estadoContacto");
												const estadosExitosos = [
													"contactado",
													"promesa_pago",
													"acuerdo_parcial",
												];

												// Requerir compromisos solo para contactos exitosos
												if (
													estadosExitosos.includes(estadoContacto) &&
													(!value || value.trim() === "")
												) {
													return "El compromiso de pago es obligatorio cuando el contacto fue exitoso";
												}
												return undefined;
											},
										}}
									>
										{(field) => {
											const estadoContacto =
												form.getFieldValue("estadoContacto");
											const estadosExitosos = [
												"contactado",
												"promesa_pago",
												"acuerdo_parcial",
											];
											const esRequerido =
												estadosExitosos.includes(estadoContacto);

											return (
												<div className="space-y-2">
													<Label>
														Compromisos de Pago {esRequerido && "*"}
													</Label>
													<Textarea
														placeholder="Fechas y montos específicos prometidos por el cliente"
														value={field.state.value}
														onChange={(e) => field.handleChange(e.target.value)}
														className={
															field.state.meta.isTouched &&
															field.state.meta.errors.length > 0
																? "border-red-500"
																: ""
														}
													/>
													{field.state.meta.isTouched &&
														field.state.meta.errors.length > 0 && (
															<p className="text-red-500 text-sm">
																{field.state.meta.errors.join(", ")}
															</p>
														)}
												</div>
											);
										}}
									</form.Field>
								)}
							</form.Field>
						</div>
					</div>

					{/* CB-020: Sección de cuotas — SOLO en variante promesa. cartera-back
					    NO separa la mora por cuota (moras_credito es un monto agregado
					    del crédito, no por cuota individual) — por eso el checkbox de
					    mora es independiente del rango: puede haber rango sin mora,
					    mora sin rango ("solo mora"), o ambos. */}
					{esPromesa && (
						<div className="space-y-4">
							<h3 className="font-medium text-lg">¿Qué prometió pagar?</h3>

							{cuotasDisponibles.length === 0 ? (
								<p className="text-muted-foreground text-sm">
									Este contrato no tiene cuotas atrasadas.
								</p>
							) : (
								<div className="grid grid-cols-2 gap-4">
									<form.Field
										name="cuotaInicio"
										validators={{
											// listenTo cuotaFin: si el usuario baja cuotaFin por
											// debajo de un cuotaInicio ya elegido, este validator
											// re-corre aunque cuotaInicio no haya cambiado (mismo
											// fix que cuotaFin de abajo, en la dirección opuesta).
											onChangeListenTo: ["cuotaFin"],
											onChange: ({ value, fieldApi }) => {
												const cuotaFin =
													fieldApi.form.getFieldValue("cuotaFin");
												if (
													value != null &&
													cuotaFin != null &&
													cuotaFin < value
												) {
													return "Debe ser menor o igual a la cuota final";
												}
												return undefined;
											},
										}}
									>
										{(field) => (
											<div className="space-y-2">
												<Label>Cuota desde</Label>
												<Select
													value={field.state.value?.toString() ?? ""}
													onValueChange={(value) =>
														field.handleChange(
															value ? Number(value) : undefined,
														)
													}
												>
													<SelectTrigger>
														<SelectValue placeholder="Sin cuota" />
													</SelectTrigger>
													<SelectContent>
														{cuotasDisponibles.map((c) => (
															<SelectItem
																key={c.numeroCuota}
																value={c.numeroCuota.toString()}
															>
																Cuota #{c.numeroCuota}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
												{field.state.meta.errors.length > 0 && (
													<p className="text-red-500 text-sm">
														{field.state.meta.errors.join(", ")}
													</p>
												)}
											</div>
										)}
									</form.Field>

									<form.Field
										name="cuotaFin"
										validators={{
											// Espejo del validator de cuotaInicio: sin esto, cambiar
											// SOLO cuotaFin a un valor menor que cuotaInicio ya
											// elegido no muestra error ni bloquea el submit (el
											// validator de cuotaInicio no se re-corre porque ese
											// campo no cambió) — el .refine() del server sí lo
											// atrapa, pero como error de red, no como UX inmediata.
											onChangeListenTo: ["cuotaInicio"],
											onChange: ({ value, fieldApi }) => {
												const cuotaInicio =
													fieldApi.form.getFieldValue("cuotaInicio");
												if (
													value != null &&
													cuotaInicio != null &&
													value < cuotaInicio
												) {
													return "Debe ser mayor o igual a la cuota inicial";
												}
												return undefined;
											},
										}}
									>
										{(field) => (
											<div className="space-y-2">
												<Label>Cuota hasta</Label>
												<Select
													value={field.state.value?.toString() ?? ""}
													onValueChange={(value) =>
														field.handleChange(
															value ? Number(value) : undefined,
														)
													}
												>
													<SelectTrigger>
														<SelectValue placeholder="Igual a 'desde' si es solo una" />
													</SelectTrigger>
													<SelectContent>
														{cuotasDisponibles.map((c) => (
															<SelectItem
																key={c.numeroCuota}
																value={c.numeroCuota.toString()}
															>
																Cuota #{c.numeroCuota}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
												{field.state.meta.errors.length > 0 && (
													<p className="text-red-500 text-sm">
														{field.state.meta.errors.join(", ")}
													</p>
												)}
											</div>
										)}
									</form.Field>
								</div>
							)}

							<form.Field
								name="incluyeMora"
								validators={{
									// Re-corre cuando cuotaInicio/cuotaFin cambian (no solo
									// cuando cambia este checkbox) para que canSubmit refleje
									// la regla "rango O mora" en tiempo real — antes el error
									// solo se mostraba como texto, sin bloquear el submit.
									onChangeListenTo: ["cuotaInicio", "cuotaFin"],
									onChange: ({ value, fieldApi }) => {
										const cuotaInicio =
											fieldApi.form.getFieldValue("cuotaInicio");
										const cuotaFin = fieldApi.form.getFieldValue("cuotaFin");
										if (cuotaInicio == null && cuotaFin == null && !value) {
											return "Indica un rango de cuotas, marca que incluye mora, o ambos";
										}
										return undefined;
									},
								}}
							>
								{(field) => (
									<div className="flex items-center space-x-2">
										<Checkbox
											id="incluyeMora"
											checked={field.state.value}
											onCheckedChange={(checked) =>
												field.handleChange(!!checked)
											}
										/>
										<Label htmlFor="incluyeMora">
											Incluye pago de mora del crédito
										</Label>
									</div>
								)}
							</form.Field>

							<form.Subscribe
								selector={(state) => [
									state.values.cuotaInicio,
									state.values.cuotaFin,
									state.values.incluyeMora,
								]}
							>
								{([cuotaInicio, cuotaFin, incluyeMora]) =>
									cuotaInicio == null &&
									cuotaFin == null &&
									!incluyeMora && (
										<p className="text-red-500 text-sm">
											Indica un rango de cuotas, marca que incluye mora, o
											ambos.
										</p>
									)
								}
							</form.Subscribe>
						</div>
					)}

					{/* Sección: Próximo Seguimiento — en variante "promesa" la fecha ES
					    la fecha prometida y es obligatoria: no hay checkbox que la
					    haga opcional (requiereSeguimiento arranca en true y no se
					    puede desmarcar). */}
					<div className="space-y-4">
						<h3 className="font-medium text-lg">
							{esPromesa ? "Fecha Prometida" : "Próximo Seguimiento"}
						</h3>

						{!esPromesa && (
							<form.Field name="requiereSeguimiento">
								{(field) => (
									<div className="flex items-center space-x-2">
										<Checkbox
											id="requiereSeguimiento"
											checked={field.state.value}
											onCheckedChange={(checked) => {
												field.handleChange(!!checked);
												if (!checked) {
													form.setFieldValue("fechaProximoContacto", undefined);
												}
											}}
										/>
										<Label htmlFor="requiereSeguimiento">
											Requiere seguimiento programado
										</Label>
									</div>
								)}
							</form.Field>
						)}

						<form.Field name="requiereSeguimiento">
							{(seguimientoField) =>
								(esPromesa || seguimientoField.state.value) && (
									<form.Field
										name="fechaProximoContacto"
										validators={{
											onChange: ({ value }) =>
												esPromesa && !value
													? "La fecha prometida es obligatoria"
													: undefined,
										}}
									>
										{(field) => (
											<div className="space-y-2">
												<Label>
													{esPromesa
														? "Fecha en la que prometió pagar *"
														: "Fecha de próximo contacto *"}
												</Label>
												<Popover>
													<PopoverTrigger asChild>
														<Button
															type="button"
															variant="outline"
															className={cn(
																"w-full justify-start text-left font-normal",
																!field.state.value && "text-muted-foreground",
															)}
														>
															<CalendarIcon className="mr-2 h-4 w-4" />
															{field.state.value
																? format(field.state.value, "dd MMM, yyyy", {
																		locale: es,
																	})
																: "Seleccionar fecha"}
														</Button>
													</PopoverTrigger>
													<PopoverContent className="w-auto p-0" align="start">
														<Calendar
															mode="single"
															selected={field.state.value}
															onSelect={(date) => field.handleChange(date)}
															disabled={(date) =>
																date < new Date(new Date().setHours(0, 0, 0, 0))
															}
															locale={es}
														/>
													</PopoverContent>
												</Popover>
												{field.state.meta.errors.length > 0 && (
													<p className="text-red-500 text-sm">
														{field.state.meta.errors.join(", ")}
													</p>
												)}
											</div>
										)}
									</form.Field>
								)
							}
						</form.Field>
					</div>

					<DialogFooter>
						<DialogClose asChild>
							<Button
								type="button"
								variant="outline"
								disabled={createContactoMutation.isPending}
							>
								Cancelar
							</Button>
						</DialogClose>
						<form.Subscribe
							selector={(state) => [state.canSubmit, state.isSubmitting]}
						>
							{([canSubmit, isSubmitting]) => (
								<Button
									type="submit"
									disabled={!canSubmit || createContactoMutation.isPending}
								>
									{createContactoMutation.isPending
										? "Guardando..."
										: "Registrar Contacto"}
								</Button>
							)}
						</form.Subscribe>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
