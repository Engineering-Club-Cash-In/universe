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
	interpolar,
	PLANTILLAS_MENSAJES,
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

	const variables: VariablesPlantilla = useMemo(
		() => ({
			clienteNombre,
			fechaPago,
			cuotaMensual,
			placa,
			marcaLineaModelo,
			montoAdeudado,
			cuotasAtraso,
			telefonoAsesor,
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
			telefonoAsesor,
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

	const form = useForm({
		defaultValues: {
			metodoContacto: metodoInicial,
			estadoContacto: "contactado" as const,
			comentarios: "",
			acuerdosAlcanzados: "",
			compromisosPago: "",
			requiereSeguimiento: false,
			fechaProximoContacto: undefined as Date | undefined,
			duracionLlamada: undefined as number | undefined,
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
		const mensajeWhatsapp = mensajeWhatsappEditado || mensajeEditado;
		switch (metodo) {
			case "llamada":
				window.open(`tel:${tel}`);
				break;
			case "whatsapp-link": {
				const url = mensajeEditado
					? `https://wa.me/${telLimpio}?text=${encodeURIComponent(mensajeEditado)}`
					: `https://wa.me/${telLimpio}`;
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
				if (mensajeEditado) params.set("body", mensajeEditado);
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
				if (!mensajeEditado.trim()) {
					toast.error("El mensaje es requerido");
					return;
				}
				emailApiMutation.mutate({
					destinatario: emailCliente,
					asunto: asuntoEditado,
					mensaje: mensajeEditado,
				});
				break;
			case "sms-api":
				if (!telLimpio) {
					toast.error("No hay teléfono para enviar SMS");
					return;
				}
				if (!mensajeEditado.trim()) {
					toast.error("No hay mensaje para enviar");
					return;
				}
				smsApiMutation.mutate({
					telefono: telLimpio,
					mensaje: mensajeEditado,
				});
				break;
		}
	};

	const mostrarPlantillas =
		metodoInicial === "whatsapp" || metodoInicial === "email";

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			{children && <DialogTrigger asChild>{children}</DialogTrigger>}
			<DialogContent className="max-h-[90vh] min-w-3xl max-w-4xl overflow-y-auto">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						{getIconoMetodo(metodoInicial)}
						Registrar Contacto - {clienteNombre}
					</DialogTitle>
					<DialogDescription>
						Registra los detalles de la interacción con el cliente y programa el
						próximo seguimiento.
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
					{/* Sección: Información del Contacto */}
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
												<SelectItem value="promesa_pago">
													🤝 Promesa de Pago
												</SelectItem>
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
											value={mensajeEditado}
											onChange={(e) => setMensajeEditado(e.target.value)}
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
									<DropdownMenuItem onClick={() => ejecutarAccion("email-api")}>
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

					{/* Sección: Próximo Seguimiento */}
					<div className="space-y-4">
						<h3 className="font-medium text-lg">Próximo Seguimiento</h3>

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

						<form.Field name="requiereSeguimiento">
							{(seguimientoField) =>
								seguimientoField.state.value && (
									<form.Field name="fechaProximoContacto">
										{(field) => (
											<div className="space-y-2">
												<Label>Fecha de próximo contacto *</Label>
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
