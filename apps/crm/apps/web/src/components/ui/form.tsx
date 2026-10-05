"use client";

import type * as LabelPrimitive from "@radix-ui/react-label";
import { Slot } from "@radix-ui/react-slot";
import * as React from "react";
import {
	Controller,
	type ControllerProps,
	type FieldPath,
	type FieldValues,
	FormProvider,
	useFormContext,
	useFormState,
} from "react-hook-form";
import {
	FieldDescription,
	FieldMessage,
	type FieldMessageVariant,
} from "@/components/ui/field-message";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Form (react-hook-form) — anatomía de Figma "02 · Componentes › Inputs" › Input/Text
 * (79:914) y "Mensaje inline" › Input/Mensaje (479:914):
 *   FormItem        → columna con gap 6 (label · campo · mensaje)
 *   FormLabel       → Label (13px 500 text/secondary). En error NO se pinta de rojo: en
 *                     Figma "Estado=Error" la etiqueta sigue en text/secondary (queda
 *                     `data-error` para quien lo necesite).
 *   FormControl     → pasa id, aria-describedby y aria-invalid al campo (Input, Textarea,
 *                     InputGroupInput… toman el estado Error de Figma con aria-invalid)
 *   FormDescription → FieldDescription (12px text/tertiary, sin ícono)
 *   FormMessage     → FieldMessage (Input/Mensaje). Con error de validación usa Tipo=Error;
 *                     sin error muestra `children` con el `variant` que se le pase.
 */

const Form = FormProvider;

type FormFieldContextValue<
	TFieldValues extends FieldValues = FieldValues,
	TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = {
	name: TName;
};

const FormFieldContext = React.createContext<FormFieldContextValue>(
	{} as FormFieldContextValue,
);

const FormField = <
	TFieldValues extends FieldValues = FieldValues,
	TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
	...props
}: ControllerProps<TFieldValues, TName>) => {
	return (
		<FormFieldContext.Provider value={{ name: props.name }}>
			<Controller {...props} />
		</FormFieldContext.Provider>
	);
};

const useFormField = () => {
	const fieldContext = React.useContext(FormFieldContext);
	const itemContext = React.useContext(FormItemContext);
	const { getFieldState } = useFormContext();
	const formState = useFormState({ name: fieldContext.name });
	const fieldState = getFieldState(fieldContext.name, formState);

	if (!fieldContext) {
		throw new Error("useFormField should be used within <FormField>");
	}

	const { id } = itemContext;

	return {
		id,
		name: fieldContext.name,
		formItemId: `${id}-form-item`,
		formDescriptionId: `${id}-form-item-description`,
		formMessageId: `${id}-form-item-message`,
		...fieldState,
	};
};

type FormItemContextValue = {
	id: string;
};

const FormItemContext = React.createContext<FormItemContextValue>(
	{} as FormItemContextValue,
);

function FormItem({ className, ...props }: React.ComponentProps<"div">) {
	const id = React.useId();

	return (
		<FormItemContext.Provider value={{ id }}>
			<div
				data-slot="form-item"
				className={cn("grid gap-1.5", className)}
				{...props}
			/>
		</FormItemContext.Provider>
	);
}

function FormLabel({
	className,
	...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
	const { error, formItemId } = useFormField();

	return (
		<Label
			data-slot="form-label"
			data-error={!!error}
			className={className}
			htmlFor={formItemId}
			{...props}
		/>
	);
}

function FormControl({ ...props }: React.ComponentProps<typeof Slot>) {
	const { error, formItemId, formDescriptionId, formMessageId } =
		useFormField();

	return (
		<Slot
			data-slot="form-control"
			id={formItemId}
			aria-describedby={
				!error
					? `${formDescriptionId}`
					: `${formDescriptionId} ${formMessageId}`
			}
			aria-invalid={!!error}
			{...props}
		/>
	);
}

function FormDescription({ className, ...props }: React.ComponentProps<"p">) {
	const { formDescriptionId } = useFormField();

	return (
		<FieldDescription
			data-slot="form-description"
			id={formDescriptionId}
			className={className}
			{...props}
		/>
	);
}

function FormMessage({
	className,
	variant,
	...props
}: React.ComponentProps<"p"> & {
	/** Tipo de Input/Mensaje cuando no hay error de validación (por defecto "error"). */
	variant?: FieldMessageVariant;
}) {
	const { error, formMessageId } = useFormField();
	const body = error ? String(error?.message ?? "") : props.children;

	if (!body) {
		return null;
	}

	return (
		<FieldMessage
			data-slot="form-message"
			id={formMessageId}
			variant={error ? "error" : variant}
			className={className}
			{...props}
		>
			{body}
		</FieldMessage>
	);
}

export {
	Form,
	FormItem,
	FormLabel,
	FormControl,
	FormDescription,
	FormMessage,
	FormField,
};
