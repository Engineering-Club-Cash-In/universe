import { zodResolver } from "@hookform/resolvers/zod";
import { type SubmitHandler, useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	creditApplicationSchema,
	type CreditApplicationFormData,
} from "./form-schemas";

interface CreditApplicationFormProps {
	defaultValues?: Partial<CreditApplicationFormData>;
	onSubmit: (data: CreditApplicationFormData) => void;
	isSubmitting?: boolean;
}

function FieldError({ message }: { message?: string }) {
	if (!message) return null;
	return <p className="text-sm text-destructive">{message}</p>;
}

export function CreditApplicationForm({
	defaultValues,
	onSubmit,
	isSubmitting,
}: CreditApplicationFormProps) {
	const {
		register,
		handleSubmit,
		formState: { errors },
		watch,
		setValue,
	} = useForm<CreditApplicationFormData>({
		resolver: zodResolver(creditApplicationSchema),
		defaultValues: {
			primerApellido: "",
			segundoApellido: "",
			apellidoCasada: "",
			primerNombre: "",
			segundoNombre: "",
			dpi: "",
			nit: "",
			licenciaNo: "",
			estadoCivil: "",
			fechaNacimiento: "",
			sexo: "",
			nacionalidad: "guatemalteca",
			direccionResidencia: "",
			telResidencia: "",
			telMovil: "",
			telEmergencia: "",
			email: "",
			vehiculoMarca: "",
			vehiculoLinea: "",
			vehiculoModelo: "",
			valorEstimado: "",
			montoSolicitado: "",
			usoUber: false,
			profesion: "",
			puesto: "",
			sueldo: "",
			sueldoPeriodicidad: "mensual",
			egresos: "",
			egresosPeriodicidad: "mensual",
			fechaProximoPago: "",
			empresa: "",
			direccionTrabajo: "",
			fechaInicioLabores: "",
			tiempoTrabajado: "",
			horarios: "",
			telTrabajo: "",
			supervisor: "",
			rrhh: "",
			bancoPago: "",
			numCuenta: "",
			tipoCuenta: "monetaria",
			conyugeNombre: "",
			conyugeEmpresa: "",
			conyugeDireccion: "",
			conyugeTelOficina: "",
			conyugeTelMovil: "",
			referenciasCrediticias: [
				{ nombre: "", telefono: "" },
				{ nombre: "", telefono: "" },
				{ nombre: "", telefono: "" },
			],
			cuentasBancarias: [
				{ numero: "", tipo: "", banco: "" },
				{ numero: "", tipo: "", banco: "" },
			],
			referenciasPersonales: [
				{ nombre: "", relacion: "", telefono: "" },
				{ nombre: "", relacion: "", telefono: "" },
				{ nombre: "", relacion: "", telefono: "" },
			],
			esPep: false,
			comoSeEntero: "",
			utilizacionCredito: "",
			...defaultValues,
		},
	});

	const submit: SubmitHandler<CreditApplicationFormData> = (data) =>
		onSubmit(data);

	return (
		<form onSubmit={handleSubmit(submit)} className="space-y-6">
			{/* Datos Personales */}
			<Card>
				<CardHeader>
					<CardTitle>Datos Personales</CardTitle>
				</CardHeader>
				<CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<div className="space-y-2">
						<Label>Primer Apellido *</Label>
						<Input {...register("primerApellido")} />
						<FieldError message={errors.primerApellido?.message} />
					</div>
					<div className="space-y-2">
						<Label>Segundo Apellido</Label>
						<Input {...register("segundoApellido")} />
					</div>
					<div className="space-y-2">
						<Label>Apellido de Casada</Label>
						<Input {...register("apellidoCasada")} />
					</div>
					<div className="space-y-2">
						<Label>Primer Nombre *</Label>
						<Input {...register("primerNombre")} />
						<FieldError message={errors.primerNombre?.message} />
					</div>
					<div className="space-y-2">
						<Label>Segundo Nombre</Label>
						<Input {...register("segundoNombre")} />
					</div>
					<div className="space-y-2">
						<Label>DPI *</Label>
						<Input {...register("dpi")} />
						<FieldError message={errors.dpi?.message} />
					</div>
					<div className="space-y-2">
						<Label>NIT</Label>
						<Input {...register("nit")} />
					</div>
					<div className="space-y-2">
						<Label>No. de Licencia</Label>
						<Input {...register("licenciaNo")} />
					</div>
					<div className="space-y-2">
						<Label>Edad</Label>
						<Input type="number" {...register("edad")} />
					</div>
					<div className="space-y-2">
						<Label>Estado Civil</Label>
						<select
							className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
							{...register("estadoCivil")}
						>
							<option value="">Seleccionar</option>
							<option value="soltero">Soltero(a)</option>
							<option value="casado">Casado(a)</option>
							<option value="unido">Unido(a)</option>
							<option value="divorciado">Divorciado(a)</option>
							<option value="viudo">Viudo(a)</option>
						</select>
					</div>
					<div className="space-y-2">
						<Label>Dependientes</Label>
						<Input type="number" {...register("dependientes")} />
					</div>
					<div className="space-y-2">
						<Label>Fecha de Nacimiento</Label>
						<Input type="date" {...register("fechaNacimiento")} />
					</div>
					<div className="space-y-2">
						<Label>Sexo</Label>
						<select
							className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
							{...register("sexo")}
						>
							<option value="">Seleccionar</option>
							<option value="masculino">Masculino</option>
							<option value="femenino">Femenino</option>
						</select>
					</div>
					<div className="space-y-2">
						<Label>Nacionalidad</Label>
						<Input {...register("nacionalidad")} />
					</div>
					<div className="space-y-2 sm:col-span-2">
						<Label>Dirección de Residencia</Label>
						<Input {...register("direccionResidencia")} />
					</div>
					<div className="space-y-2">
						<Label>Tel. Residencia</Label>
						<Input type="tel" {...register("telResidencia")} />
					</div>
					<div className="space-y-2">
						<Label>Tel. Móvil</Label>
						<Input type="tel" {...register("telMovil")} />
					</div>
					<div className="space-y-2">
						<Label>Tel. Emergencia</Label>
						<Input type="tel" {...register("telEmergencia")} />
					</div>
					<div className="space-y-2">
						<Label>Email</Label>
						<Input type="email" {...register("email")} />
						<FieldError message={errors.email?.message} />
					</div>
				</CardContent>
			</Card>

			{/* Datos del Vehículo */}
			<Card>
				<CardHeader>
					<CardTitle>Datos del Vehículo</CardTitle>
				</CardHeader>
				<CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<div className="space-y-2">
						<Label>Marca</Label>
						<Input {...register("vehiculoMarca")} />
					</div>
					<div className="space-y-2">
						<Label>Línea</Label>
						<Input {...register("vehiculoLinea")} />
					</div>
					<div className="space-y-2">
						<Label>Modelo/Año</Label>
						<Input {...register("vehiculoModelo")} />
					</div>
					<div className="space-y-2">
						<Label>Valor Estimado (Q)</Label>
						<Input type="number" step="0.01" {...register("valorEstimado")} />
					</div>
					<div className="space-y-2">
						<Label>Monto Solicitado (Q)</Label>
						<Input
							type="number"
							step="0.01"
							{...register("montoSolicitado")}
						/>
					</div>
					<div className="flex items-center gap-2 pt-6">
						<input
							type="checkbox"
							className="h-4 w-4 rounded border-input"
							{...register("usoUber")}
						/>
						<Label className="font-normal">Uso para Uber/plataformas</Label>
					</div>
				</CardContent>
			</Card>

			{/* Datos Laborales */}
			<Card>
				<CardHeader>
					<CardTitle>Datos Laborales</CardTitle>
				</CardHeader>
				<CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<div className="space-y-2">
						<Label>Profesión</Label>
						<Input {...register("profesion")} />
					</div>
					<div className="space-y-2">
						<Label>Puesto</Label>
						<Input {...register("puesto")} />
					</div>
					<div className="space-y-2">
						<Label>Sueldo (Q)</Label>
						<Input type="number" step="0.01" {...register("sueldo")} />
					</div>
					<div className="space-y-2">
						<Label>Periodicidad Sueldo</Label>
						<select
							className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
							{...register("sueldoPeriodicidad")}
						>
							<option value="mensual">Mensual</option>
							<option value="quincenal">Quincenal</option>
						</select>
					</div>
					<div className="space-y-2">
						<Label>Egresos (Q)</Label>
						<Input type="number" step="0.01" {...register("egresos")} />
					</div>
					<div className="space-y-2">
						<Label>Periodicidad Egresos</Label>
						<select
							className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
							{...register("egresosPeriodicidad")}
						>
							<option value="mensual">Mensual</option>
							<option value="quincenal">Quincenal</option>
						</select>
					</div>
					<div className="space-y-2">
						<Label>Fecha Próximo Pago</Label>
						<Input type="date" {...register("fechaProximoPago")} />
					</div>
					<div className="space-y-2">
						<Label>Empresa</Label>
						<Input {...register("empresa")} />
					</div>
					<div className="space-y-2 sm:col-span-2">
						<Label>Dirección de Trabajo</Label>
						<Input {...register("direccionTrabajo")} />
					</div>
					<div className="space-y-2">
						<Label>Fecha Inicio Labores</Label>
						<Input type="date" {...register("fechaInicioLabores")} />
					</div>
					<div className="space-y-2">
						<Label>Tiempo Trabajado</Label>
						<Input
							placeholder="Ej: 2 años 3 meses"
							{...register("tiempoTrabajado")}
						/>
					</div>
					<div className="space-y-2">
						<Label>Horarios</Label>
						<Input
							placeholder="Ej: 8:00 - 17:00"
							{...register("horarios")}
						/>
					</div>
					<div className="space-y-2">
						<Label>Tel. Trabajo</Label>
						<Input type="tel" {...register("telTrabajo")} />
					</div>
					<div className="space-y-2">
						<Label>Supervisor</Label>
						<Input {...register("supervisor")} />
					</div>
					<div className="space-y-2">
						<Label>RRHH</Label>
						<Input {...register("rrhh")} />
					</div>
					<div className="space-y-2">
						<Label>Banco de Pago</Label>
						<Input {...register("bancoPago")} />
					</div>
					<div className="space-y-2">
						<Label>No. de Cuenta</Label>
						<Input {...register("numCuenta")} />
					</div>
					<div className="space-y-2">
						<Label>Tipo de Cuenta</Label>
						<select
							className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
							{...register("tipoCuenta")}
						>
							<option value="monetaria">Monetaria</option>
							<option value="ahorro">Ahorro</option>
						</select>
					</div>
				</CardContent>
			</Card>

			{/* Datos del Cónyuge */}
			<Card>
				<CardHeader>
					<CardTitle>Datos del Cónyuge</CardTitle>
				</CardHeader>
				<CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<div className="space-y-2 sm:col-span-2">
						<Label>Nombre Completo</Label>
						<Input {...register("conyugeNombre")} />
					</div>
					<div className="space-y-2">
						<Label>Empresa</Label>
						<Input {...register("conyugeEmpresa")} />
					</div>
					<div className="space-y-2">
						<Label>Dirección</Label>
						<Input {...register("conyugeDireccion")} />
					</div>
					<div className="space-y-2">
						<Label>Tel. Oficina</Label>
						<Input type="tel" {...register("conyugeTelOficina")} />
					</div>
					<div className="space-y-2">
						<Label>Tel. Móvil</Label>
						<Input type="tel" {...register("conyugeTelMovil")} />
					</div>
				</CardContent>
			</Card>

			{/* Referencias Crediticias */}
			<Card>
				<CardHeader>
					<CardTitle>Referencias Crediticias</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					{[0, 1, 2].map((i) => (
						<div key={i} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
							<div className="space-y-2">
								<Label>Nombre {i + 1}</Label>
								<Input
									{...register(`referenciasCrediticias.${i}.nombre`)}
								/>
							</div>
							<div className="space-y-2">
								<Label>Teléfono {i + 1}</Label>
								<Input
									type="tel"
									{...register(`referenciasCrediticias.${i}.telefono`)}
								/>
							</div>
						</div>
					))}
				</CardContent>
			</Card>

			{/* Otras Cuentas Bancarias */}
			<Card>
				<CardHeader>
					<CardTitle>Otras Cuentas Bancarias</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					{[0, 1].map((i) => (
						<div key={i} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
							<div className="space-y-2">
								<Label>No. Cuenta {i + 1}</Label>
								<Input {...register(`cuentasBancarias.${i}.numero`)} />
							</div>
							<div className="space-y-2">
								<Label>Tipo</Label>
								<select
									className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
									{...register(`cuentasBancarias.${i}.tipo`)}
								>
									<option value="">Seleccionar</option>
									<option value="monetaria">Monetaria</option>
									<option value="ahorro">Ahorro</option>
								</select>
							</div>
							<div className="space-y-2">
								<Label>Banco</Label>
								<Input {...register(`cuentasBancarias.${i}.banco`)} />
							</div>
						</div>
					))}
				</CardContent>
			</Card>

			{/* Referencias Personales */}
			<Card>
				<CardHeader>
					<CardTitle>Referencias Personales</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					{[0, 1, 2].map((i) => (
						<div key={i} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
							<div className="space-y-2">
								<Label>Nombre {i + 1}</Label>
								<Input
									{...register(`referenciasPersonales.${i}.nombre`)}
								/>
							</div>
							<div className="space-y-2">
								<Label>Relación</Label>
								<Input
									{...register(`referenciasPersonales.${i}.relacion`)}
								/>
							</div>
							<div className="space-y-2">
								<Label>Teléfono</Label>
								<Input
									type="tel"
									{...register(`referenciasPersonales.${i}.telefono`)}
								/>
							</div>
						</div>
					))}
				</CardContent>
			</Card>

			{/* Control Interno */}
			<Card>
				<CardHeader>
					<CardTitle>Control Interno</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="flex items-center gap-2">
						<input
							type="checkbox"
							className="h-4 w-4 rounded border-input"
							{...register("esPep")}
						/>
						<Label className="font-normal">
							Es Persona Expuesta Políticamente (PEP)
						</Label>
					</div>
					<div className="space-y-2">
						<Label>¿Cómo se enteró de nosotros?</Label>
						<Input {...register("comoSeEntero")} />
					</div>
					<div className="space-y-2">
						<Label>Utilización del Crédito</Label>
						<Input {...register("utilizacionCredito")} />
					</div>
				</CardContent>
			</Card>

			<div className="flex justify-end">
				<Button type="submit" size="lg" disabled={isSubmitting}>
					{isSubmitting ? "Guardando..." : "Continuar"}
				</Button>
			</div>
		</form>
	);
}
