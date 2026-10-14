import type { ReactFormExtendedApi } from "@tanstack/react-form";
import { format } from "date-fns";
import * as React from "react";
import type { LeadSource } from "server/src/lib/lead-sources";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { DatePicker } from "@/components/ui/date-picker";
import {
	DialogClose,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { FieldDescription, FieldMessage } from "@/components/ui/field-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PopoverPortalContext } from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { LEAD_SOURCE_OPTIONS } from "@/lib/crm-formatters";
import { getLeadNameAutocomplete } from "@/lib/lead-name-autocomplete";
import { cn } from "@/lib/utils";

/**
 * Formulario «Crear Nuevo Lead» / «Editar Lead» (los dos son el mismo formulario).
 *
 * Solo la presentación: el `useForm` (valores por defecto, validación al enviar y
 * envío) vive en `routes/crm/leads.tsx` y llega por `form`. Aquí van los campos con
 * sus validaciones en vivo, igual que antes, agrupados por secciones:
 * en escritorio ancho cada sección lleva el título a la izquierda y los campos en
 * 4 columnas; en celular, una columna. Las acciones quedan fijas al pie.
 */

/** Valores del formulario (los mismos `defaultValues` de leads.tsx). */
export type LeadFormValues = {
	firstName: string;
	middleName: string;
	lastName: string;
	secondLastName: string;
	email: string;
	phone: string;
	age: string;
	dpi: string;
	nit: string;
	direccion: string;
	departamento: string;
	municipio: string;
	zona: string;
	clientType: "individual" | "comerciante" | "empresa";
	maritalStatus: "single" | "married" | "divorced" | "widowed";
	dependents: string;
	monthlyIncome: string;
	loanAmount: string;
	occupation: "owner" | "employee";
	workTime: "less_than_1" | "1_to_5" | "5_to_10" | "10_plus";
	ownsHome: boolean;
	ownsVehicle: boolean;
	hasCreditCard: boolean;
	jobTitle: string;
	companyId: string;
	source: LeadSource;
	assignedTo: string;
	notes: string;
	score: string;
	fit: boolean;
	birthDate: string;
	gender: "male" | "female" | "";
	nationality: string;
};

// biome-ignore lint/suspicious/noExplicitAny: los validadores de nivel formulario los define leads.tsx; aquí no importan.
type CualquierValidador = any;

/** El `useForm` de leads.tsx (con sus validadores, que aquí no importan). */
export type LeadFormApi = ReactFormExtendedApi<
	LeadFormValues,
	CualquierValidador,
	CualquierValidador,
	CualquierValidador,
	CualquierValidador,
	CualquierValidador,
	CualquierValidador,
	CualquierValidador,
	CualquierValidador,
	CualquierValidador,
	CualquierValidador,
	CualquierValidador
>;

function validatePositiveFinancialValue(value: string, label: string) {
	const normalizedValue = value.trim();

	if (!normalizedValue) {
		return undefined;
	}

	const numericValue = Number(normalizedValue);
	if (!Number.isFinite(numericValue) || numericValue <= 0) {
		return `${label} debe ser mayor a 0`;
	}

	return undefined;
}

function getUniqueFieldErrors(errors: readonly unknown[]) {
	return Array.from(new Set(errors.map((error) => String(error))));
}

/** «1990-05-17» → Date local de ese día (sin corrimiento por zona horaria). */
function isoAFecha(iso: string): Date | undefined {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
	if (!m) return undefined;
	return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Rejilla de campos: 1 columna en celular, 2 en tableta y 4 en escritorio. */
const camposClassName = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4";

/**
 * Sección del formulario: título (y nota) arriba; desde xl, a la izquierda de los
 * campos, para que el modal crezca a lo ancho y no a lo alto.
 */
function Seccion({
	titulo,
	nota,
	children,
}: {
	titulo: React.ReactNode;
	nota?: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<section className="grid gap-4 py-4 xl:grid-cols-[11rem_minmax(0,1fr)] xl:gap-6">
			<div className="flex flex-col gap-1">
				<h3 className="type-heading-sm text-fg">{titulo}</h3>
				{nota ? <p className="type-caption text-fg-tertiary">{nota}</p> : null}
			</div>
			{children}
		</section>
	);
}

/** Etiqueta + control + mensajes, con el espacio de Input/Text de Figma (6px). */
function Campo({
	className,
	children,
}: {
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<div
			className={cn(
				"grid min-w-0 grid-cols-1 content-start gap-1.5",
				className,
			)}
		>
			{children}
		</div>
	);
}

function Obligatorio() {
	return <span className="text-danger-solid">*</span>;
}

function ErroresCampo({ errors }: { errors: readonly unknown[] }) {
	return getUniqueFieldErrors(errors).map((error) => (
		<FieldMessage key={error}>{error}</FieldMessage>
	));
}

export function LeadFormDialogContent({
	form,
	isEditing,
	isSaving,
	companies,
	departamentos,
	municipios,
	selectedDepartamento,
	onDepartamentoChange,
}: {
	form: LeadFormApi;
	/** Editar un lead existente (muestra Score y Capacidad de Pago). */
	isEditing: boolean;
	/** La mutación de crear o editar está en curso. */
	isSaving: boolean;
	companies?: { id: string; name: string }[];
	departamentos?: string[];
	municipios?: string[];
	selectedDepartamento: string;
	onDepartamentoChange: (departamento: string) => void;
}) {
	// El calendario y el combobox se montan en la caja del modal (no en el área
	// con scroll), así no salen cortados.
	const [cajaModal, setCajaModal] = React.useState<HTMLDivElement | null>(null);

	return (
		<DialogContent
			ref={setCajaModal}
			aria-describedby={undefined}
			className="flex max-h-[calc(100dvh-2rem)] w-[min(1280px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
		>
			<PopoverPortalContext.Provider value={cajaModal}>
				<DialogHeader className="border-line-subtle border-b px-4 pt-5 pb-4 sm:px-6 sm:pt-6">
					<DialogTitle>
						{isEditing ? "Editar Lead" : "Crear Nuevo Lead"}
					</DialogTitle>
				</DialogHeader>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						e.stopPropagation();
						void form.handleSubmit().catch(() => undefined);
					}}
					autoComplete="off"
					className="flex min-h-0 flex-1 flex-col"
				>
					<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6">
						<div className="divide-y divide-line-subtle">
							<Seccion titulo="Información de Contacto">
								<div className={camposClassName}>
									<form.Field
										name="firstName"
										validators={{
											onChange: ({ value }) => {
												if (!value.trim()) {
													return "El nombre es requerido";
												}
												return undefined;
											},
										}}
									>
										{(field) => (
											<Campo>
												<Label htmlFor={field.name} className="gap-1">
													Primer Nombre <Obligatorio />
												</Label>
												<Input
													id={field.name}
													name={field.name}
													autoComplete={getLeadNameAutocomplete("firstName")}
													value={field.state.value}
													onBlur={field.handleBlur}
													onChange={(e) => field.handleChange(e.target.value)}
													aria-invalid={field.state.meta.errors.length > 0}
												/>
												<ErroresCampo errors={field.state.meta.errors} />
											</Campo>
										)}
									</form.Field>
									<form.Field name="middleName">
										{(field) => (
											<Campo>
												<Label htmlFor={field.name}>Segundo Nombre</Label>
												<Input
													id={field.name}
													name={field.name}
													autoComplete={getLeadNameAutocomplete("middleName")}
													value={field.state.value}
													onBlur={field.handleBlur}
													onChange={(e) => field.handleChange(e.target.value)}
												/>
											</Campo>
										)}
									</form.Field>
									<form.Field
										name="lastName"
										validators={{
											onChange: ({ value }) => {
												if (!value.trim()) {
													return "El apellido es requerido";
												}
												return undefined;
											},
										}}
									>
										{(field) => (
											<Campo>
												<Label htmlFor={field.name} className="gap-1">
													Primer Apellido <Obligatorio />
												</Label>
												<Input
													id={field.name}
													name={field.name}
													autoComplete={getLeadNameAutocomplete("lastName")}
													value={field.state.value}
													onBlur={field.handleBlur}
													onChange={(e) => field.handleChange(e.target.value)}
													aria-invalid={field.state.meta.errors.length > 0}
												/>
												<ErroresCampo errors={field.state.meta.errors} />
											</Campo>
										)}
									</form.Field>
									<form.Field name="secondLastName">
										{(field) => (
											<Campo>
												<Label htmlFor={field.name}>Segundo Apellido</Label>
												<Input
													id={field.name}
													name={field.name}
													autoComplete={getLeadNameAutocomplete(
														"secondLastName",
													)}
													value={field.state.value}
													onBlur={field.handleBlur}
													onChange={(e) => field.handleChange(e.target.value)}
												/>
											</Campo>
										)}
									</form.Field>
									<form.Field
										name="email"
										validators={{
											onChange: ({ value }) => {
												if (
													value.trim() &&
													!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
												) {
													return "El correo electrónico no es válido";
												}
												return undefined;
											},
										}}
									>
										{(field) => (
											<Campo>
												<Label htmlFor={field.name}>Correo Electrónico</Label>
												<Input
													id={field.name}
													name={field.name}
													type="email"
													value={field.state.value}
													onBlur={field.handleBlur}
													onChange={(e) => field.handleChange(e.target.value)}
													aria-invalid={field.state.meta.errors.length > 0}
												/>
												<ErroresCampo errors={field.state.meta.errors} />
											</Campo>
										)}
									</form.Field>
									<form.Field
										name="phone"
										validators={{
											onChange: ({ value }) => {
												if (!value.trim()) {
													return "El teléfono es requerido";
												}
												return undefined;
											},
										}}
									>
										{(field) => (
											<Campo>
												<Label htmlFor={field.name} className="gap-1">
													Teléfono <Obligatorio />
												</Label>
												<Input
													id={field.name}
													name={field.name}
													type="tel"
													value={field.state.value}
													onBlur={field.handleBlur}
													onChange={(e) => field.handleChange(e.target.value)}
													aria-invalid={field.state.meta.errors.length > 0}
												/>
												<ErroresCampo errors={field.state.meta.errors} />
											</Campo>
										)}
									</form.Field>
									<form.Field
										name="source"
										validators={{
											onChange: ({ value }) => {
												if (!value) {
													return "La fuente del lead es requerida";
												}
												return undefined;
											},
										}}
									>
										{(field) => (
											<Campo>
												<Label htmlFor={field.name} className="gap-1">
													Fuente del Lead <Obligatorio />
												</Label>
												<Select
													value={field.state.value}
													onValueChange={(value) =>
														field.handleChange(value as LeadSource)
													}
												>
													<SelectTrigger
														id={field.name}
														aria-invalid={field.state.meta.errors.length > 0}
													>
														<SelectValue placeholder="Seleccionar fuente" />
													</SelectTrigger>
													<SelectContent>
														{LEAD_SOURCE_OPTIONS.map((option) => (
															<SelectItem
																key={option.value}
																value={option.value}
															>
																{option.label}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
												<ErroresCampo errors={field.state.meta.errors} />
											</Campo>
										)}
									</form.Field>
									<form.Field name="companyId">
										{(field) => (
											<Campo>
												<Label htmlFor={field.name}>Empresa</Label>
												<Combobox
													id={field.name}
													options={[
														{ value: "none", label: "Sin empresa" },
														...(companies?.map((company) => ({
															value: company.id,
															label: company.name,
														})) || []),
													]}
													value={field.state.value ?? null}
													onChange={(value) => field.handleChange(value)}
													placeholder="Seleccionar empresa"
													width="full"
												/>
											</Campo>
										)}
									</form.Field>
								</div>
							</Seccion>

							<Seccion titulo="Información Personal">
								<div className={camposClassName}>
									<form.Field name="age">
										{(field) => (
											<Campo>
												<Label htmlFor={field.name}>Edad</Label>
												<Input
													id={field.name}
													name={field.name}
													type="number"
													value={field.state.value}
													onBlur={field.handleBlur}
													onChange={(e) => field.handleChange(e.target.value)}
													min="18"
													max="100"
												/>
											</Campo>
										)}
									</form.Field>
									<form.Field name="dpi">
										{(field) => (
											<Campo>
												<Label htmlFor={field.name}>DPI</Label>
												<Input
													id={field.name}
													name={field.name}
													value={field.state.value}
													onBlur={field.handleBlur}
													onChange={(e) => {
														const val = e.target.value
															.replace(/\D/g, "")
															.slice(0, 13);
														field.handleChange(val);
													}}
													placeholder="1234567890101"
													maxLength={13}
													inputMode="numeric"
												/>
												{field.state.value &&
													field.state.value.length > 0 &&
													field.state.value.length !== 13 && (
														<FieldMessage>
															El DPI debe tener 13 dígitos (
															{field.state.value.length}/13)
														</FieldMessage>
													)}
											</Campo>
										)}
									</form.Field>
									<form.Field name="nit">
										{(field) => (
											<Campo>
												<Label htmlFor={field.name}>NIT</Label>
												<Input
													id={field.name}
													name={field.name}
													value={field.state.value}
													onBlur={field.handleBlur}
													onChange={(e) => field.handleChange(e.target.value)}
													placeholder="0000000-0"
												/>
											</Campo>
										)}
									</form.Field>
									<form.Field name="clientType">
										{(field) => (
											<Campo>
												<Label htmlFor={field.name} className="gap-1">
													Tipo de Cliente <Obligatorio />
												</Label>
												<Select
													value={field.state.value}
													onValueChange={(value) =>
														field.handleChange(
															value as "individual" | "comerciante" | "empresa",
														)
													}
												>
													<SelectTrigger id={field.name}>
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="individual">
															Cliente Individual
														</SelectItem>
														<SelectItem value="comerciante">
															Comerciante Individual
														</SelectItem>
														<SelectItem value="empresa">
															Empresa (S.A, Ltda, etc.)
														</SelectItem>
													</SelectContent>
												</Select>
											</Campo>
										)}
									</form.Field>
									<form.Field name="maritalStatus">
										{(field) => (
											<Campo>
												<Label htmlFor={field.name}>Estado Civil</Label>
												<Select
													value={field.state.value}
													onValueChange={(value) =>
														field.handleChange(
															value as
																| "single"
																| "married"
																| "divorced"
																| "widowed",
														)
													}
												>
													<SelectTrigger id={field.name}>
														<SelectValue placeholder="Seleccionar estado civil" />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="single">Soltero/a</SelectItem>
														<SelectItem value="married">Casado/a</SelectItem>
														<SelectItem value="divorced">
															Divorciado/a
														</SelectItem>
														<SelectItem value="widowed">Viudo/a</SelectItem>
													</SelectContent>
												</Select>
											</Campo>
										)}
									</form.Field>
									<form.Field name="dependents">
										{(field) => (
											<Campo>
												<Label htmlFor={field.name}>
													Dependientes Económicos
												</Label>
												<Input
													id={field.name}
													name={field.name}
													type="number"
													value={field.state.value}
													onBlur={field.handleBlur}
													onChange={(e) => field.handleChange(e.target.value)}
													min="0"
													max="20"
												/>
											</Campo>
										)}
									</form.Field>
									<form.Field name="jobTitle">
										{(field) => (
											<Campo>
												<Label htmlFor={field.name}>Cargo</Label>
												<Input
													id={field.name}
													name={field.name}
													value={field.state.value}
													onBlur={field.handleBlur}
													onChange={(e) => field.handleChange(e.target.value)}
												/>
											</Campo>
										)}
									</form.Field>
								</div>
							</Seccion>

							<Seccion
								titulo="Datos para Contratos"
								nota="(requeridos para generar documentos legales)"
							>
								<div className={camposClassName}>
									<form.Field name="birthDate">
										{(field) => (
											<Campo>
												<Label htmlFor={field.name}>Fecha de Nacimiento</Label>
												<DatePicker
													id={field.name}
													date={isoAFecha(field.state.value)}
													onDateChange={(fecha) =>
														field.handleChange(
															fecha ? format(fecha, "yyyy-MM-dd") : "",
														)
													}
													captionLayout="dropdown"
													applyOnSelect
												/>
											</Campo>
										)}
									</form.Field>
									<form.Field name="gender">
										{(field) => (
											<Campo>
												<Label htmlFor={field.name}>Género</Label>
												<Select
													value={field.state.value}
													onValueChange={(value) =>
														field.handleChange(value as "male" | "female" | "")
													}
												>
													<SelectTrigger id={field.name}>
														<SelectValue placeholder="Seleccionar género" />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="male">Masculino</SelectItem>
														<SelectItem value="female">Femenino</SelectItem>
													</SelectContent>
												</Select>
											</Campo>
										)}
									</form.Field>
									<form.Field name="nationality">
										{(field) => (
											<Campo>
												<Label htmlFor={field.name}>Nacionalidad</Label>
												<Input
													id={field.name}
													name={field.name}
													value={field.state.value}
													onBlur={field.handleBlur}
													onChange={(e) => field.handleChange(e.target.value)}
													placeholder="Ej: guatemalteco"
												/>
											</Campo>
										)}
									</form.Field>
								</div>
							</Seccion>

							<Seccion titulo="Dirección">
								<div className={camposClassName}>
									<form.Field name="direccion">
										{(field) => (
											<Campo>
												<Label htmlFor={field.name}>Dirección Completa</Label>
												<Input
													id={field.name}
													name={field.name}
													value={field.state.value}
													onBlur={field.handleBlur}
													onChange={(e) => field.handleChange(e.target.value)}
													placeholder="Ej: 4ta Calle 5-67, Zona 1"
												/>
											</Campo>
										)}
									</form.Field>
									<form.Field name="departamento">
										{(field) => (
											<Campo>
												<Label htmlFor={field.name}>Departamento</Label>
												<Select
													value={field.state.value}
													onValueChange={(value) => {
														field.handleChange(value);
														onDepartamentoChange(value);
														// Reset municipio when departamento changes
														form.setFieldValue("municipio", "");
													}}
												>
													<SelectTrigger id={field.name}>
														<SelectValue placeholder="Seleccionar departamento" />
													</SelectTrigger>
													<SelectContent>
														{departamentos?.map((dep) => (
															<SelectItem key={dep} value={dep}>
																{dep}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</Campo>
										)}
									</form.Field>
									<form.Field name="municipio">
										{(field) => (
											<Campo>
												<Label htmlFor={field.name}>Municipio</Label>
												<Select
													value={field.state.value}
													onValueChange={(value) => field.handleChange(value)}
													disabled={!selectedDepartamento}
												>
													<SelectTrigger id={field.name}>
														<SelectValue
															placeholder={
																// En columnas angostas se corta con «…».
																<span className="truncate">
																	{selectedDepartamento
																		? "Seleccionar municipio"
																		: "Primero seleccione departamento"}
																</span>
															}
														/>
													</SelectTrigger>
													<SelectContent>
														{municipios?.map((mun) => (
															<SelectItem key={mun} value={mun}>
																{mun}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</Campo>
										)}
									</form.Field>
									<form.Field name="zona">
										{(field) => (
											<Campo>
												<Label htmlFor={field.name}>Zona</Label>
												<Input
													id={field.name}
													name={field.name}
													value={field.state.value}
													onBlur={field.handleBlur}
													onChange={(e) => field.handleChange(e.target.value)}
													placeholder="Ej: 1, 10, etc."
												/>
											</Campo>
										)}
									</form.Field>
								</div>
							</Seccion>

							<Seccion titulo="Información Financiera">
								<div className={camposClassName}>
									<form.Field
										name="monthlyIncome"
										validators={{
											onChange: ({ value }) =>
												validatePositiveFinancialValue(
													value,
													"El ingreso mensual",
												),
										}}
									>
										{(field) => (
											<Campo>
												<Label htmlFor={field.name}>Ingreso Mensual</Label>
												<Input
													id={field.name}
													name={field.name}
													type="number"
													value={field.state.value}
													onBlur={field.handleBlur}
													onChange={(e) => field.handleChange(e.target.value)}
													placeholder="0.00"
													step="0.01"
													min="0"
													aria-invalid={field.state.meta.errors.length > 0}
												/>
												<ErroresCampo errors={field.state.meta.errors} />
											</Campo>
										)}
									</form.Field>
									<form.Field
										name="loanAmount"
										validators={{
											onChange: ({ value }) =>
												validatePositiveFinancialValue(
													value,
													"El monto a financiar",
												),
										}}
									>
										{(field) => (
											<Campo>
												<Label htmlFor={field.name}>Monto a Financiar</Label>
												<Input
													id={field.name}
													name={field.name}
													type="number"
													value={field.state.value}
													onBlur={field.handleBlur}
													onChange={(e) => field.handleChange(e.target.value)}
													placeholder="0.00"
													step="0.01"
													min="0"
													aria-invalid={field.state.meta.errors.length > 0}
												/>
												<ErroresCampo errors={field.state.meta.errors} />
											</Campo>
										)}
									</form.Field>
									<form.Field name="occupation">
										{(field) => (
											<Campo>
												<Label htmlFor={field.name}>Ocupación</Label>
												<Select
													value={field.state.value}
													onValueChange={(value) =>
														field.handleChange(value as "owner" | "employee")
													}
												>
													<SelectTrigger id={field.name}>
														<SelectValue placeholder="Seleccionar ocupación" />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="owner">Dueño</SelectItem>
														<SelectItem value="employee">Empleado</SelectItem>
													</SelectContent>
												</Select>
											</Campo>
										)}
									</form.Field>
									<form.Field name="workTime">
										{(field) => (
											<Campo>
												<Label htmlFor={field.name}>Tiempo en el Trabajo</Label>
												<Select
													value={field.state.value}
													onValueChange={(value) =>
														field.handleChange(
															value as
																| "less_than_1"
																| "1_to_5"
																| "5_to_10"
																| "10_plus",
														)
													}
												>
													<SelectTrigger id={field.name}>
														<SelectValue placeholder="Seleccionar tiempo" />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="less_than_1">
															Menos de un año
														</SelectItem>
														<SelectItem value="1_to_5">1 a 5 años</SelectItem>
														<SelectItem value="5_to_10">5 a 10 años</SelectItem>
														<SelectItem value="10_plus">
															Más de 10 años
														</SelectItem>
													</SelectContent>
												</Select>
											</Campo>
										)}
									</form.Field>
								</div>
							</Seccion>

							<Seccion titulo="Activos">
								<div className="flex flex-wrap gap-x-8 gap-y-3">
									<form.Field name="ownsHome">
										{(field) => (
											<div className="flex items-center gap-2">
												<Checkbox
													id={field.name}
													checked={field.state.value}
													onCheckedChange={(checked) =>
														field.handleChange(checked as boolean)
													}
												/>
												<Label htmlFor={field.name}>Posee Casa Propia</Label>
											</div>
										)}
									</form.Field>
									<form.Field name="ownsVehicle">
										{(field) => (
											<div className="flex items-center gap-2">
												<Checkbox
													id={field.name}
													checked={field.state.value}
													onCheckedChange={(checked) =>
														field.handleChange(checked as boolean)
													}
												/>
												<Label htmlFor={field.name}>
													Posee Vehículo Propio
												</Label>
											</div>
										)}
									</form.Field>
									<form.Field name="hasCreditCard">
										{(field) => (
											<div className="flex items-center gap-2">
												<Checkbox
													id={field.name}
													checked={field.state.value}
													onCheckedChange={(checked) =>
														field.handleChange(checked as boolean)
													}
												/>
												<Label htmlFor={field.name}>
													Tiene Tarjeta de Crédito
												</Label>
											</div>
										)}
									</form.Field>
								</div>
							</Seccion>

							<Seccion titulo="Notas">
								<form.Field name="notes">
									{(field) => (
										<Textarea
											id={field.name}
											name={field.name}
											aria-label="Notas"
											value={field.state.value}
											onBlur={field.handleBlur}
											onChange={(e) => field.handleChange(e.target.value)}
											placeholder="Notas adicionales sobre este lead..."
											rows={3}
										/>
									)}
								</form.Field>
							</Seccion>

							{/* Score y Capacidad de Pago - Solo visible al editar */}
							{isEditing && (
								<Seccion titulo="Score y Capacidad de Pago">
									<div className={camposClassName}>
										<form.Field name="score">
											{(field) => (
												<Campo>
													<Label htmlFor={field.name}>
														Score Crediticio (0-1)
													</Label>
													<Input
														id={field.name}
														name={field.name}
														type="number"
														min="0"
														max="1"
														step="0.01"
														value={field.state.value}
														onBlur={field.handleBlur}
														onChange={(e) => field.handleChange(e.target.value)}
														placeholder="Ej: 0.75"
													/>
													<FieldDescription>
														Puntaje de 0 a 1 (1 = excelente)
													</FieldDescription>
												</Campo>
											)}
										</form.Field>

										<form.Field name="fit">
											{(field) => (
												<Campo className="sm:col-span-1 lg:col-span-2">
													<Label htmlFor={field.name}>Capacidad de Pago</Label>
													<div className="flex min-h-10.5 items-center gap-2">
														<Checkbox
															id={field.name}
															checked={field.state.value}
															onCheckedChange={(checked) =>
																field.handleChange(checked === true)
															}
														/>
														<Label htmlFor={field.name}>
															Pre-aprobado (tiene capacidad de pago)
														</Label>
													</div>
													<FieldDescription>
														Indica si el lead cumple con la capacidad de pago
														requerida
													</FieldDescription>
												</Campo>
											)}
										</form.Field>
									</div>
								</Seccion>
							)}
						</div>
					</div>

					<DialogFooter className="sticky bottom-0 flex-row border-line-subtle border-t bg-surface px-4 py-4 sm:px-6">
						<DialogClose asChild>
							<Button
								type="button"
								variant="outline"
								className="flex-1 sm:flex-none"
							>
								Cancelar
							</Button>
						</DialogClose>
						<form.Subscribe>
							{(state) => (
								<Button
									type="submit"
									className="flex-1 sm:flex-none"
									disabled={!state.canSubmit || state.isSubmitting || isSaving}
								>
									{state.isSubmitting || isSaving
										? "Cargando..."
										: isEditing
											? "Editar Lead"
											: "Crear Lead"}
								</Button>
							)}
						</form.Subscribe>
					</DialogFooter>
				</form>
			</PopoverPortalContext.Provider>
		</DialogContent>
	);
}
