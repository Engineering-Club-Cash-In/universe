import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarIcon, Mail, MessageCircle, Phone } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { client, orpc } from "@/utils/orpc";

interface ContactoModalProps {
	casoCobroId: string;
	clienteNombre: string;
	telefonoPrincipal: string;
	metodoInicial: "llamada" | "whatsapp" | "email";
	children: React.ReactNode;
}

export function ContactoModal({
	casoCobroId,
	clienteNombre,
	telefonoPrincipal,
	metodoInicial,
	children,
}: ContactoModalProps) {
	const queryClient = useQueryClient();

	const form = useForm({
		defaultValues: {
			metodoContacto: metodoInicial,
			estadoContacto: "contactado" as const,
			comentarios: "",
			acuerdosAlcanzados: "",
			compromisosPago: "",
			requiereSeguimiento: false,
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
			queryClient.invalidateQueries({ queryKey: ["getCasosCobros"] });
			queryClient.invalidateQueries({ queryKey: ["getHistorialContactos"] });
			form.reset();
			// Cerrar el dialogo
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

	const ejecutarAccion = (metodo: "llamada" | "whatsapp" | "email") => {
		switch (metodo) {
			case "llamada":
				window.open(`tel:${telefonoPrincipal}`);
				break;
			case "whatsapp":
				window.open(
					`https://wa.me/${telefonoPrincipal.replace(/[^0-9]/g, "")}`,
				);
				break;
			case "email":
				// El email se obtendría del caso, por ahora placeholder
				window.open("mailto:cliente@email.com");
				break;
		}
	};

	return (
		<Dialog>
			<DialogTrigger asChild>{children}</DialogTrigger>
			<DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
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
							<form.Field
								name="metodoContacto"
								children={(field) => (
									<div className="space-y-2">
										<Label>Método de Contacto</Label>
										<Select
											onValueChange={(value) =>
												form.setFieldValue(field.name, value)
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
							/>

							<form.Field
								name="estadoContacto"
								children={(field) => (
									<div className="space-y-2">
										<Label>Estado del Contacto</Label>
										<Select
											onValueChange={(value) =>
												form.setFieldValue(field.name, value)
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
							/>
						</div>

						{/* Botón para ejecutar acción */}
						<div className="flex gap-2">
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => ejecutarAccion("llamada")}
								className="flex items-center gap-2"
							>
								<Phone className="h-4 w-4" />
								Llamar {telefonoPrincipal}
							</Button>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => ejecutarAccion("whatsapp")}
								className="flex items-center gap-2"
							>
								<MessageCircle className="h-4 w-4" />
								WhatsApp
							</Button>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => ejecutarAccion("email")}
								className="flex items-center gap-2"
							>
								<Mail className="h-4 w-4" />
								Email
							</Button>
						</div>

						<form.Field
							name="metodoContacto"
							children={(metodoField) =>
								metodoField.state.value === "llamada" && (
									<form.Field
										name="duracionLlamada"
										children={(field) => (
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
									/>
								)
							}
						/>
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
							children={(field) => (
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
						/>

						<div className="grid grid-cols-2 gap-4">
							<form.Field
								name="acuerdosAlcanzados"
								children={(field) => (
									<div className="space-y-2">
										<Label>Acuerdos Alcanzados</Label>
										<Textarea
											placeholder="Describe cualquier acuerdo o compromiso establecido"
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
										/>
									</div>
								)}
							/>

							<form.Field
								name="compromisosPago"
								children={(field) => (
									<div className="space-y-2">
										<Label>Compromisos de Pago</Label>
										<Textarea
											placeholder="Fechas y montos específicos prometidos por el cliente"
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
										/>
									</div>
								)}
							/>
						</div>
					</div>

					{/* Sección: Próximo Seguimiento */}
					<div className="space-y-4">
						<h3 className="font-medium text-lg">Próximo Seguimiento</h3>

						<form.Field
							name="requiereSeguimiento"
							children={(field) => (
								<div className="flex items-center space-x-2">
									<input
										type="checkbox"
										checked={field.state.value}
										onChange={(e) => field.handleChange(e.target.checked)}
									/>
									<Label>Requiere seguimiento programado</Label>
								</div>
							)}
						/>
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
							children={([canSubmit, isSubmitting]) => (
								<Button
									type="submit"
									disabled={!canSubmit || createContactoMutation.isPending}
								>
									{createContactoMutation.isPending
										? "Guardando..."
										: "Registrar Contacto"}
								</Button>
							)}
						/>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
