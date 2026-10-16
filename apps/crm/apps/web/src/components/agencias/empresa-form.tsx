import { useForm } from "@tanstack/react-form";
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

export type EmpresaInput = {
	name: string;
	industry?: string;
	size?: string;
	website?: string;
	email?: string;
	phone?: string;
	address?: string;
	notes?: string;
};

export type EmpresaValores = {
	name: string;
	industry: string;
	size: string;
	website: string;
	email: string;
	phone: string;
	address: string;
	notes: string;
};

const VALORES_VACIOS: EmpresaValores = {
	name: "",
	industry: "",
	size: "",
	website: "",
	email: "",
	phone: "",
	address: "",
	notes: "",
};

/** Convierte lo escrito en el formulario al formato que esperan los endpoints. */
export function aEmpresaInput(value: EmpresaValores): EmpresaInput {
	return {
		...value,
		industry:
			value.industry && value.industry !== "none" ? value.industry : undefined,
		size: value.size && value.size !== "none" ? value.size : undefined,
		website: value.website || undefined,
		email: value.email || undefined,
		phone: value.phone || undefined,
		address: value.address || undefined,
		notes: value.notes || undefined,
	};
}

export function useEmpresaForm(onSubmit: (value: EmpresaValores) => void) {
	return useForm({
		defaultValues: VALORES_VACIOS,
		validators: {
			onChange: ({ value }) => {
				if (!value.name || value.name.trim() === "") {
					return { form: "El nombre de la empresa es requerido" };
				}
				if (value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) {
					return { form: "El correo electrónico no es válido" };
				}
				return undefined;
			},
		},
		onSubmit: async ({ value }) => {
			onSubmit(value);
		},
	});
}

export type EmpresaForm = ReturnType<typeof useEmpresaForm>;

function Errores({ errors }: { errors: unknown[] }) {
	return (
		<>
			{errors.map((error) => (
				<p key={String(error)} className="text-red-500 text-sm">
					{String(error)}
				</p>
			))}
		</>
	);
}

/**
 * Campos compartidos por el alta y la edición. `mostrarErrores` conserva la
 * diferencia histórica: el alta muestra los errores bajo nombre y correo.
 */
export function CamposEmpresa({
	form,
	mostrarErrores,
}: {
	form: EmpresaForm;
	mostrarErrores: boolean;
}) {
	return (
		<>
			<div>
				<form.Field name="name">
					{(field) => (
						<div className="space-y-2">
							<Label htmlFor={field.name}>
								Nombre de la Empresa <span className="text-red-500">*</span>
							</Label>
							<Input
								id={field.name}
								name={field.name}
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(e) => field.handleChange(e.target.value)}
								placeholder="Ingresa el nombre de la empresa..."
							/>
							{mostrarErrores && <Errores errors={field.state.meta.errors} />}
						</div>
					)}
				</form.Field>
			</div>

			<div className="grid grid-cols-2 gap-4">
				<div>
					<form.Field name="industry">
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor={field.name}>Industria</Label>
								<Select
									value={field.state.value}
									onValueChange={(value) => field.handleChange(value)}
								>
									<SelectTrigger>
										<SelectValue placeholder="Seleccionar industria" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="none">Sin industria</SelectItem>
										<SelectItem value="technology">Tecnología</SelectItem>
										<SelectItem value="finance">Finanzas</SelectItem>
										<SelectItem value="healthcare">Salud</SelectItem>
										<SelectItem value="retail">Venta al por menor</SelectItem>
										<SelectItem value="manufacturing">Manufactura</SelectItem>
										<SelectItem value="education">Educación</SelectItem>
										<SelectItem value="consulting">Consultoría</SelectItem>
										<SelectItem value="other">Otro</SelectItem>
									</SelectContent>
								</Select>
							</div>
						)}
					</form.Field>
				</div>
				<div>
					<form.Field name="size">
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor={field.name}>Tamaño de la Empresa</Label>
								<Select
									value={field.state.value}
									onValueChange={(value) => field.handleChange(value)}
								>
									<SelectTrigger>
										<SelectValue placeholder="Seleccionar tamaño" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="none">Sin tamaño</SelectItem>
										<SelectItem value="startup">Startup (1-10)</SelectItem>
										<SelectItem value="small">Pequeña (11-50)</SelectItem>
										<SelectItem value="medium">Mediana (51-200)</SelectItem>
										<SelectItem value="large">Grande (201-1000)</SelectItem>
										<SelectItem value="enterprise">
											Corporativa (1000+)
										</SelectItem>
									</SelectContent>
								</Select>
							</div>
						)}
					</form.Field>
				</div>
			</div>

			<div className="grid grid-cols-2 gap-4">
				<div>
					<form.Field name="website">
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor={field.name}>Sitio Web</Label>
								<Input
									id={field.name}
									name={field.name}
									type="url"
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(e) => field.handleChange(e.target.value)}
									placeholder="https://empresa.com"
								/>
							</div>
						)}
					</form.Field>
				</div>
				<div>
					<form.Field name="email">
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor={field.name}>Correo Electrónico</Label>
								<Input
									id={field.name}
									name={field.name}
									type="email"
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(e) => field.handleChange(e.target.value)}
									placeholder="contacto@empresa.com"
								/>
								{mostrarErrores && <Errores errors={field.state.meta.errors} />}
							</div>
						)}
					</form.Field>
				</div>
			</div>

			<div className="grid grid-cols-2 gap-4">
				<div>
					<form.Field name="phone">
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor={field.name}>Teléfono</Label>
								<Input
									id={field.name}
									name={field.name}
									type="tel"
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(e) => field.handleChange(e.target.value)}
									placeholder="+1 (555) 123-4567"
								/>
							</div>
						)}
					</form.Field>
				</div>
				<div>
					<form.Field name="address">
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor={field.name}>Dirección</Label>
								<Input
									id={field.name}
									name={field.name}
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(e) => field.handleChange(e.target.value)}
									placeholder="Dirección de la empresa..."
								/>
							</div>
						)}
					</form.Field>
				</div>
			</div>

			<div>
				<form.Field name="notes">
					{(field) => (
						<div className="space-y-2">
							<Label htmlFor={field.name}>Notas</Label>
							<Textarea
								id={field.name}
								name={field.name}
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(e) => field.handleChange(e.target.value)}
								placeholder="Notas adicionales sobre esta empresa..."
								rows={3}
							/>
						</div>
					)}
				</form.Field>
			</div>
		</>
	);
}
