import * as React from "react";
import { useForm } from "react-hook-form";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DateInput } from "@/components/ui/date-input";
import {
	FieldDescription,
	FieldMessage,
	type FieldMessageVariant,
} from "@/components/ui/field-message";
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input, InputGroup, InputGroupInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { SearchInput } from "@/components/ui/search-input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ShowcaseGroup, type ShowcaseMeta } from "./_layout";

export const meta: ShowcaseMeta = {
	order: 20,
	title: "Inputs y formularios",
	figma:
		"02 · Componentes › Inputs (Input/Text · Input/Variants) · Mensaje inline (Input/Mensaje)",
	description:
		"Input/Text = <Input> (estados por CSS; Success/Error con status o aria-invalid) o <InputGroup status> si lleva ícono. Variantes: Search=<SearchInput> · Password=<PasswordInput> · Date=<DateInput> · Number=<CurrencyInput step> · Textarea=<Textarea showCount>. Input/Mensaje = <FieldMessage variant> (Error=error · Advertencia=warning · Ayuda=help · Éxito=success). Etiqueta = <Label>, ayuda = <FieldDescription>; con react-hook-form, <FormItem>/<FormLabel>/<FormDescription>/<FormMessage>.",
};

/** Campo de ejemplo: nombre del estado + etiqueta + control + mensaje (gap 6 de Figma). */
function Field({
	state,
	label,
	htmlFor,
	disabled,
	className,
	children,
}: {
	state?: string;
	label: string;
	htmlFor: string;
	disabled?: boolean;
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<div className={cn("w-70 space-y-2", className)}>
			{state ? (
				<p className="type-caption text-fg-tertiary uppercase">{state}</p>
			) : null}
			<div
				className="group grid gap-1.5"
				data-disabled={disabled ? "true" : undefined}
			>
				<Label htmlFor={htmlFor}>{label}</Label>
				{children}
			</div>
		</div>
	);
}

function InputTextStates() {
	return (
		<div className="flex flex-wrap gap-x-10 gap-y-8 py-3">
			<Field state="Empty" label="Nombre del cliente" htmlFor="ds-in-empty">
				<Input id="ds-in-empty" placeholder="Placeholder…" />
			</Field>
			<Field state="Filled" label="Nombre del cliente" htmlFor="ds-in-filled">
				<Input id="ds-in-filled" defaultValue="Juan Pérez López" />
			</Field>
			<Field
				state="Hover (simulado)"
				label="Nombre del cliente"
				htmlFor="ds-in-hover"
			>
				<Input
					id="ds-in-hover"
					defaultValue="Juan Pérez López"
					className="bg-canvas"
				/>
			</Field>
			<Field
				state="Focus (simulado)"
				label="Nombre del cliente"
				htmlFor="ds-in-focus"
			>
				<Input
					id="ds-in-focus"
					defaultValue="Juan Pérez López"
					className="inset-ring-1 inset-ring-brand border-brand shadow-clay-subtle"
				/>
			</Field>
			<Field
				state="Disabled"
				label="Nombre del cliente"
				htmlFor="ds-in-disabled"
				disabled
			>
				<Input id="ds-in-disabled" defaultValue="No editable" disabled />
			</Field>
			<Field
				state="ReadOnly"
				label="Nombre del cliente"
				htmlFor="ds-in-readonly"
			>
				<Input id="ds-in-readonly" defaultValue="Solo lectura" readOnly />
				<FieldDescription>Campo de solo lectura</FieldDescription>
			</Field>
			<Field state="Success" label="Nombre del cliente" htmlFor="ds-in-success">
				<InputGroup status="success">
					<InputGroupInput id="ds-in-success" defaultValue="Dato validado" />
				</InputGroup>
				<FieldMessage variant="success">Correcto</FieldMessage>
			</Field>
			<Field state="Error" label="Nombre del cliente" htmlFor="ds-in-error">
				<InputGroup status="error">
					<InputGroupInput id="ds-in-error" defaultValue="Valor inválido" />
				</InputGroup>
				<FieldMessage>Este campo es obligatorio</FieldMessage>
			</Field>
		</div>
	);
}

function InputBareStatus() {
	return (
		<div className="flex flex-wrap gap-x-10 gap-y-8 py-3">
			<Field
				state={'<Input status="success">'}
				label="DPI"
				htmlFor="ds-in-bare-success"
			>
				<Input
					id="ds-in-bare-success"
					status="success"
					defaultValue="2547 89651 0101"
				/>
			</Field>
			<Field
				state="<Input aria-invalid>"
				label="Correo electrónico"
				htmlFor="ds-in-bare-error"
			>
				<Input
					id="ds-in-bare-error"
					aria-invalid
					defaultValue="cliente@correo"
				/>
				<FieldMessage>Ingrese un correo válido.</FieldMessage>
			</Field>
			<Field
				state="Textarea · error"
				label="Motivo del rechazo"
				htmlFor="ds-ta-error"
			>
				<Textarea id="ds-ta-error" status="error" placeholder="Describa…" />
				<FieldMessage>Indique el motivo del rechazo.</FieldMessage>
			</Field>
		</div>
	);
}

function InputVariants() {
	const [monto, setMonto] = React.useState("15000.00");
	const [notas, setNotas] = React.useState("");

	return (
		<div className="flex flex-wrap gap-x-10 gap-y-8 py-3">
			<Field
				state="Search"
				label="Búsqueda"
				htmlFor="ds-var-search"
				className="w-75"
			>
				<SearchInput
					id="ds-var-search"
					placeholder="Buscar cliente, crédito o placa…"
				/>
			</Field>
			<Field
				state="Password"
				label="Contraseña"
				htmlFor="ds-var-password"
				className="w-75"
			>
				<PasswordInput
					id="ds-var-password"
					defaultValue="clave-secreta"
					autoComplete="off"
				/>
			</Field>
			<Field
				state="Date"
				label="Fecha de promesa"
				htmlFor="ds-var-date"
				className="w-75"
			>
				<DateInput id="ds-var-date" />
			</Field>
			<Field
				state="Number"
				label="Monto"
				htmlFor="ds-var-number"
				className="w-75"
			>
				<CurrencyInput
					id="ds-var-number"
					symbol=""
					step={100}
					value={monto}
					onChange={setMonto}
				/>
				<FieldDescription>Monto en Q</FieldDescription>
			</Field>
			<Field
				state="Textarea"
				label="Observaciones"
				htmlFor="ds-var-textarea"
				className="w-75"
			>
				<Textarea
					id="ds-var-textarea"
					placeholder="Notas de la gestión con el cliente…"
					maxLength={500}
					showCount
					value={notas}
					onChange={(e) => setNotas(e.target.value)}
				/>
			</Field>
		</div>
	);
}

function InputVariantsMore() {
	const [montoQ, setMontoQ] = React.useState("2500.50");

	return (
		<div className="flex flex-wrap gap-x-10 gap-y-8 py-3">
			<Field
				state="CurrencyInput (con Q)"
				label="Monto de la boleta"
				htmlFor="ds-more-currency"
				className="w-75"
			>
				<CurrencyInput
					id="ds-more-currency"
					value={montoQ}
					onChange={setMontoQ}
				/>
			</Field>
			<Field
				state="Password visible"
				label="Contraseña"
				htmlFor="ds-more-password"
				className="w-75"
			>
				<PasswordInput
					id="ds-more-password"
					defaultValue="clave-secreta"
					defaultVisible
					autoComplete="off"
				/>
			</Field>
			<Field
				state="Date · con valor"
				label="Fecha de pago"
				htmlFor="ds-more-date"
				className="w-75"
			>
				<DateInput id="ds-more-date" defaultValue="2026-10-15" />
			</Field>
			<Field
				state="Search · disabled"
				label="Búsqueda"
				htmlFor="ds-more-search"
				disabled
				className="w-75"
			>
				<SearchInput
					id="ds-more-search"
					placeholder="Buscar cliente, crédito o placa…"
					disabled
				/>
			</Field>
			<Field
				state="Date · error"
				label="Fecha compromiso"
				htmlFor="ds-more-date-error"
				className="w-75"
			>
				<DateInput id="ds-more-date-error" status="error" />
				<FieldMessage>La fecha compromiso es obligatoria.</FieldMessage>
			</Field>
		</div>
	);
}

const messageVariants: [string, FieldMessageVariant][] = [
	["Error", "error"],
	["Advertencia", "warning"],
	["Ayuda", "help"],
	["Éxito", "success"],
];

const messageExamples: [FieldMessageVariant, string][] = [
	["error", "La fecha compromiso es obligatoria."],
	["warning", "El monto supera el saldo pendiente del crédito."],
	["help", "Formato: dd / mm / aaaa."],
	["success", "Número de comprobante válido."],
];

function InputMessages() {
	return (
		<div className="grid gap-x-16 gap-y-6 py-3 sm:grid-cols-2">
			<div className="space-y-3">
				<p className="type-caption text-fg-tertiary uppercase">Tipo</p>
				{messageVariants.map(([label, variant]) => (
					<div key={variant} className="flex items-center gap-4">
						<span className="type-caption w-24 text-fg-tertiary">{label}</span>
						<FieldMessage variant={variant}>
							Mensaje de validación.
						</FieldMessage>
					</div>
				))}
			</div>
			<div className="space-y-3">
				<p className="type-caption text-fg-tertiary uppercase">Ejemplos</p>
				{messageExamples.map(([variant, text]) => (
					<FieldMessage key={variant} variant={variant}>
						{text}
					</FieldMessage>
				))}
			</div>
		</div>
	);
}

type PromesaForm = { referencia: string; fecha: string };

function FormExample() {
	const form = useForm<PromesaForm>({
		defaultValues: { referencia: "BOL-004821", fecha: "" },
	});

	React.useEffect(() => {
		form.setError("fecha", {
			type: "required",
			message: "La fecha compromiso es obligatoria.",
		});
	}, [form]);

	return (
		<Form {...form}>
			<form
				className="flex flex-wrap gap-x-10 gap-y-8 py-3"
				onSubmit={form.handleSubmit(() => {})}
			>
				<FormField
					control={form.control}
					name="referencia"
					render={({ field }) => (
						<FormItem className="w-75 content-start">
							<FormLabel>Número de boleta</FormLabel>
							<FormControl>
								<Input {...field} />
							</FormControl>
							<FormDescription>
								Tal como aparece en el comprobante del banco.
							</FormDescription>
						</FormItem>
					)}
				/>
				<FormField
					control={form.control}
					name="fecha"
					render={({ field }) => (
						<FormItem className="w-75 content-start">
							<FormLabel>Fecha compromiso</FormLabel>
							<FormControl>
								<DateInput {...field} />
							</FormControl>
							<FormMessage />
						</FormItem>
					)}
				/>
			</form>
		</Form>
	);
}

export default function FormsShowcase() {
	return (
		<div className="space-y-6">
			<ShowcaseGroup title="Input/Text — estados">
				<InputTextStates />
			</ShowcaseGroup>
			<ShowcaseGroup title="Input sin ícono y Textarea con estado">
				<InputBareStatus />
			</ShowcaseGroup>
			<ShowcaseGroup title="Input/Variants (Search · Password · Date · Number · Textarea)">
				<InputVariants />
			</ShowcaseGroup>
			<ShowcaseGroup title="Más combinaciones">
				<InputVariantsMore />
			</ShowcaseGroup>
			<ShowcaseGroup title="Mensaje inline · Input/Mensaje">
				<InputMessages />
			</ShowcaseGroup>
			<ShowcaseGroup title="Formulario (react-hook-form)">
				<FormExample />
			</ShowcaseGroup>
		</div>
	);
}
