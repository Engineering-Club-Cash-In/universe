import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo } from "react";
import {
	type SubmitHandler,
	useFieldArray,
	useForm,
	useWatch,
} from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	type FinancialStatementFormData,
	financialStatementSchema,
} from "./form-schemas";

interface FinancialStatementFormProps {
	defaultValues?: Partial<FinancialStatementFormData>;
	onSubmit: (data: FinancialStatementFormData) => void;
	isSubmitting?: boolean;
}

function parseNum(val: string | undefined): number {
	if (!val) return 0;
	const n = Number.parseFloat(val);
	return Number.isNaN(n) ? 0 : n;
}

function sumArray(arr: { monto?: string }[] | undefined): number {
	if (!arr) return 0;
	return arr.reduce((sum, item) => sum + parseNum(item.monto), 0);
}

function formatQ(val: number): string {
	return `Q ${val.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const emptyDescMonto = { descripcion: "", monto: "" };
const emptyDeposito = { descripcion: "", monto: "" };

export function FinancialStatementForm({
	defaultValues,
	onSubmit,
	isSubmitting,
}: FinancialStatementFormProps) {
	const {
		register,
		handleSubmit,
		control,
		formState: { errors },
	} = useForm<FinancialStatementFormData>({
		resolver: zodResolver(financialStatementSchema),
		defaultValues: {
			primerNombre: "",
			segundoNombre: "",
			primerApellido: "",
			segundoApellido: "",
			apellidoCasada: "",
			dpi: "",
			dpiExtendidoEn: "",
			nit: "",
			efectivo: "",
			depositosBancarios: [emptyDeposito, emptyDeposito, emptyDeposito],
			cuentasCobrarAmigos: "",
			cuentasCobrarOtros: "",
			documentosCobrar: "",
			bienesInmueblesValor: "",
			vehiculosValor: "",
			maquinaria: "",
			muebles: "",
			menaje: "",
			otrosActivos: [emptyDescMonto, emptyDescMonto, emptyDescMonto],
			cuentasPagarAmigos: "",
			cuentasPagarOtros: "",
			letrasPagar: "",
			obligacionesParticulares: [emptyDescMonto, emptyDescMonto],
			obligacionesCortoPlazo: [emptyDescMonto, emptyDescMonto],
			obligacionesLargoPlazo: [emptyDescMonto, emptyDescMonto],
			otrosPasivos: [emptyDescMonto, emptyDescMonto],
			sueldos: "",
			bonificaciones: "",
			arrendamientos: "",
			otrosIngresos: [emptyDescMonto, emptyDescMonto, emptyDescMonto],
			gastosPersonales: "",
			alquileres: "",
			amortizacionVivienda: "",
			deudasPersonales: "",
			otrosEgresos: [emptyDescMonto, emptyDescMonto, emptyDescMonto],
			origenIngresos: "",
			comoAcreditanIngresos: "",
			anexoInmuebles: [],
			anexoVehiculos: [],
			...defaultValues,
		},
	});

	const {
		fields: anexoInmueblesFields,
		append: appendInmueble,
		remove: removeInmueble,
	} = useFieldArray({ control, name: "anexoInmuebles" });
	const {
		fields: anexoVehiculosFields,
		append: appendVehiculo,
		remove: removeVehiculo,
	} = useFieldArray({ control, name: "anexoVehiculos" });

	// Watch values for totals calculation
	const watchedValues = useWatch({ control });

	const totals = useMemo(() => {
		const v = watchedValues;
		const totalActivos =
			parseNum(v.efectivo) +
			sumArray(v.depositosBancarios) +
			parseNum(v.cuentasCobrarAmigos) +
			parseNum(v.cuentasCobrarOtros) +
			parseNum(v.documentosCobrar) +
			parseNum(v.bienesInmueblesValor) +
			parseNum(v.vehiculosValor) +
			parseNum(v.maquinaria) +
			parseNum(v.muebles) +
			parseNum(v.menaje) +
			sumArray(v.otrosActivos);

		const totalPasivos =
			parseNum(v.cuentasPagarAmigos) +
			parseNum(v.cuentasPagarOtros) +
			parseNum(v.letrasPagar) +
			sumArray(v.obligacionesParticulares) +
			sumArray(v.obligacionesCortoPlazo) +
			sumArray(v.obligacionesLargoPlazo) +
			sumArray(v.otrosPasivos);

		const patrimonio = totalActivos - totalPasivos;

		const totalIngresos =
			parseNum(v.sueldos) +
			parseNum(v.bonificaciones) +
			parseNum(v.arrendamientos) +
			sumArray(v.otrosIngresos);

		const totalEgresos =
			parseNum(v.gastosPersonales) +
			parseNum(v.alquileres) +
			parseNum(v.amortizacionVivienda) +
			parseNum(v.deudasPersonales) +
			sumArray(v.otrosEgresos);

		const diferencia = totalIngresos - totalEgresos;

		return {
			totalActivos,
			totalPasivos,
			patrimonio,
			totalIngresos,
			totalEgresos,
			diferencia,
		};
	}, [watchedValues]);

	const submit: SubmitHandler<FinancialStatementFormData> = (data) =>
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
						<Label>Primer Nombre</Label>
						<Input {...register("primerNombre")} />
					</div>
					<div className="space-y-2">
						<Label>Segundo Nombre</Label>
						<Input {...register("segundoNombre")} />
					</div>
					<div className="space-y-2">
						<Label>Primer Apellido</Label>
						<Input {...register("primerApellido")} />
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
						<Label>DPI</Label>
						<Input {...register("dpi")} />
					</div>
					<div className="space-y-2">
						<Label>DPI Extendido en</Label>
						<Input {...register("dpiExtendidoEn")} />
					</div>
					<div className="space-y-2">
						<Label>NIT</Label>
						<Input {...register("nit")} />
					</div>
				</CardContent>
			</Card>

			{/* Activos */}
			<Card>
				<CardHeader>
					<CardTitle>Activos</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div className="space-y-2">
							<Label>Efectivo (Q)</Label>
							<Input type="number" step="0.01" {...register("efectivo")} />
						</div>
					</div>

					<div>
						<Label className="mb-2 block font-medium">
							Depósitos Bancarios
						</Label>
						{[0, 1, 2].map((i) => (
							<div
								key={i}
								className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2"
							>
								<Input
									placeholder="Descripción"
									{...register(`depositosBancarios.${i}.descripcion`)}
								/>
								<Input
									type="number"
									step="0.01"
									placeholder="Monto"
									{...register(`depositosBancarios.${i}.monto`)}
								/>
							</div>
						))}
					</div>

					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div className="space-y-2">
							<Label>Cuentas por Cobrar (Amigos/Parientes) (Q)</Label>
							<Input
								type="number"
								step="0.01"
								{...register("cuentasCobrarAmigos")}
							/>
						</div>
						<div className="space-y-2">
							<Label>Cuentas por Cobrar (Otros) (Q)</Label>
							<Input
								type="number"
								step="0.01"
								{...register("cuentasCobrarOtros")}
							/>
						</div>
						<div className="space-y-2">
							<Label>Documentos por Cobrar (Q)</Label>
							<Input
								type="number"
								step="0.01"
								{...register("documentosCobrar")}
							/>
						</div>
					</div>

					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div className="space-y-2">
							<Label>Bienes Inmuebles - Cantidad</Label>
							<Input type="number" {...register("bienesInmueblesCantidad")} />
						</div>
						<div className="space-y-2">
							<Label>Bienes Inmuebles - Valor (Q)</Label>
							<Input
								type="number"
								step="0.01"
								{...register("bienesInmueblesValor")}
							/>
						</div>
						<div className="space-y-2">
							<Label>Vehículos - Cantidad</Label>
							<Input type="number" {...register("vehiculosCantidad")} />
						</div>
						<div className="space-y-2">
							<Label>Vehículos - Valor (Q)</Label>
							<Input
								type="number"
								step="0.01"
								{...register("vehiculosValor")}
							/>
						</div>
						<div className="space-y-2">
							<Label>Maquinaria (Q)</Label>
							<Input type="number" step="0.01" {...register("maquinaria")} />
						</div>
						<div className="space-y-2">
							<Label>Muebles (Q)</Label>
							<Input type="number" step="0.01" {...register("muebles")} />
						</div>
						<div className="space-y-2">
							<Label>Menaje (Q)</Label>
							<Input type="number" step="0.01" {...register("menaje")} />
						</div>
					</div>

					<div>
						<Label className="mb-2 block font-medium">Otros Activos</Label>
						{[0, 1, 2].map((i) => (
							<div
								key={i}
								className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2"
							>
								<Input
									placeholder="Descripción"
									{...register(`otrosActivos.${i}.descripcion`)}
								/>
								<Input
									type="number"
									step="0.01"
									placeholder="Monto"
									{...register(`otrosActivos.${i}.monto`)}
								/>
							</div>
						))}
					</div>

					<div className="rounded-lg border bg-muted/50 p-3 text-right font-medium">
						Total Activos: {formatQ(totals.totalActivos)}
					</div>
				</CardContent>
			</Card>

			{/* Pasivos */}
			<Card>
				<CardHeader>
					<CardTitle>Pasivos</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div className="space-y-2">
							<Label>Cuentas por Pagar (Amigos/Parientes) (Q)</Label>
							<Input
								type="number"
								step="0.01"
								{...register("cuentasPagarAmigos")}
							/>
						</div>
						<div className="space-y-2">
							<Label>Cuentas por Pagar (Otros) (Q)</Label>
							<Input
								type="number"
								step="0.01"
								{...register("cuentasPagarOtros")}
							/>
						</div>
						<div className="space-y-2">
							<Label>Letras por Pagar (Q)</Label>
							<Input type="number" step="0.01" {...register("letrasPagar")} />
						</div>
					</div>

					{(
						[
							["obligacionesParticulares", "Obligaciones Particulares"],
							["obligacionesCortoPlazo", "Obligaciones a Corto Plazo"],
							["obligacionesLargoPlazo", "Obligaciones a Largo Plazo"],
							["otrosPasivos", "Otros Pasivos"],
						] as const
					).map(([fieldName, label]) => (
						<div key={fieldName}>
							<Label className="mb-2 block font-medium">{label}</Label>
							{[0, 1].map((i) => (
								<div
									key={i}
									className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2"
								>
									<Input
										placeholder="Descripción"
										{...register(`${fieldName}.${i}.descripcion`)}
									/>
									<Input
										type="number"
										step="0.01"
										placeholder="Monto"
										{...register(`${fieldName}.${i}.monto`)}
									/>
								</div>
							))}
						</div>
					))}

					<div className="rounded-lg border bg-muted/50 p-3 text-right font-medium">
						Total Pasivos: {formatQ(totals.totalPasivos)}
					</div>
				</CardContent>
			</Card>

			{/* Patrimonio */}
			<Card>
				<CardHeader>
					<CardTitle>Patrimonio</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="rounded-lg border bg-primary/5 p-4 text-center font-bold text-lg">
						Patrimonio (Activos - Pasivos): {formatQ(totals.patrimonio)}
					</div>
				</CardContent>
			</Card>

			{/* Ingresos y Egresos Anuales */}
			<Card>
				<CardHeader>
					<CardTitle>Ingresos y Egresos Anuales</CardTitle>
				</CardHeader>
				<CardContent className="space-y-6">
					<div>
						<h4 className="mb-3 font-medium">Ingresos</h4>
						<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
							<div className="space-y-2">
								<Label>Sueldos (Q)</Label>
								<Input type="number" step="0.01" {...register("sueldos")} />
							</div>
							<div className="space-y-2">
								<Label>Bonificaciones (Q)</Label>
								<Input
									type="number"
									step="0.01"
									{...register("bonificaciones")}
								/>
							</div>
							<div className="space-y-2">
								<Label>Arrendamientos (Q)</Label>
								<Input
									type="number"
									step="0.01"
									{...register("arrendamientos")}
								/>
							</div>
						</div>
						<div className="mt-3">
							<Label className="mb-2 block font-medium">Otros Ingresos</Label>
							{[0, 1, 2].map((i) => (
								<div
									key={i}
									className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2"
								>
									<Input
										placeholder="Descripción"
										{...register(`otrosIngresos.${i}.descripcion`)}
									/>
									<Input
										type="number"
										step="0.01"
										placeholder="Monto"
										{...register(`otrosIngresos.${i}.monto`)}
									/>
								</div>
							))}
						</div>
						<div className="mt-2 rounded-lg border bg-muted/50 p-3 text-right font-medium">
							Total Ingresos: {formatQ(totals.totalIngresos)}
						</div>
					</div>

					<div>
						<h4 className="mb-3 font-medium">Egresos</h4>
						<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
							<div className="space-y-2">
								<Label>Gastos Personales (Q)</Label>
								<Input
									type="number"
									step="0.01"
									{...register("gastosPersonales")}
								/>
							</div>
							<div className="space-y-2">
								<Label>Alquileres (Q)</Label>
								<Input type="number" step="0.01" {...register("alquileres")} />
							</div>
							<div className="space-y-2">
								<Label>Amortización Vivienda (Q)</Label>
								<Input
									type="number"
									step="0.01"
									{...register("amortizacionVivienda")}
								/>
							</div>
							<div className="space-y-2">
								<Label>Deudas Personales (Q)</Label>
								<Input
									type="number"
									step="0.01"
									{...register("deudasPersonales")}
								/>
							</div>
						</div>
						<div className="mt-3">
							<Label className="mb-2 block font-medium">Otros Egresos</Label>
							{[0, 1, 2].map((i) => (
								<div
									key={i}
									className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2"
								>
									<Input
										placeholder="Descripción"
										{...register(`otrosEgresos.${i}.descripcion`)}
									/>
									<Input
										type="number"
										step="0.01"
										placeholder="Monto"
										{...register(`otrosEgresos.${i}.monto`)}
									/>
								</div>
							))}
						</div>
						<div className="mt-2 rounded-lg border bg-muted/50 p-3 text-right font-medium">
							Total Egresos: {formatQ(totals.totalEgresos)}
						</div>
					</div>

					<div className="rounded-lg border bg-primary/5 p-4 text-center font-bold text-lg">
						Diferencia (Ingresos - Egresos): {formatQ(totals.diferencia)}
					</div>
				</CardContent>
			</Card>

			{/* Origen de Ingresos */}
			<Card>
				<CardHeader>
					<CardTitle>Origen de Ingresos</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="space-y-2">
						<Label>¿De dónde provienen sus ingresos?</Label>
						<textarea
							className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
							{...register("origenIngresos")}
						/>
					</div>
					<div className="space-y-2">
						<Label>¿Cómo acreditan sus ingresos?</Label>
						<textarea
							className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
							{...register("comoAcreditanIngresos")}
						/>
					</div>
				</CardContent>
			</Card>

			{/* Anexo Inmuebles */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between">
					<CardTitle>Anexo: Bienes Inmuebles</CardTitle>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() =>
							appendInmueble({
								finca: "",
								folio: "",
								libro: "",
								valor: "",
								hipotecada: false,
								aFavorDe: "",
								direccion: "",
							})
						}
					>
						+ Agregar
					</Button>
				</CardHeader>
				<CardContent className="space-y-4">
					{anexoInmueblesFields.length === 0 && (
						<p className="text-muted-foreground text-sm">
							No hay inmuebles agregados
						</p>
					)}
					{anexoInmueblesFields.map((field, index) => (
						<div key={field.id} className="rounded-lg border p-4">
							<div className="mb-2 flex items-center justify-between">
								<span className="font-medium text-sm">
									Inmueble {index + 1}
								</span>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									onClick={() => removeInmueble(index)}
								>
									Eliminar
								</Button>
							</div>
							<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
								<div className="space-y-1">
									<Label className="text-xs">Finca</Label>
									<Input {...register(`anexoInmuebles.${index}.finca`)} />
								</div>
								<div className="space-y-1">
									<Label className="text-xs">Folio</Label>
									<Input {...register(`anexoInmuebles.${index}.folio`)} />
								</div>
								<div className="space-y-1">
									<Label className="text-xs">Libro</Label>
									<Input {...register(`anexoInmuebles.${index}.libro`)} />
								</div>
								<div className="space-y-1">
									<Label className="text-xs">Valor (Q)</Label>
									<Input
										type="number"
										step="0.01"
										{...register(`anexoInmuebles.${index}.valor`)}
									/>
								</div>
								<div className="flex items-center gap-2 pt-4">
									<input
										type="checkbox"
										className="h-4 w-4 rounded border-input"
										{...register(`anexoInmuebles.${index}.hipotecada`)}
									/>
									<Label className="font-normal text-xs">Hipotecada</Label>
								</div>
								<div className="space-y-1">
									<Label className="text-xs">A Favor De</Label>
									<Input {...register(`anexoInmuebles.${index}.aFavorDe`)} />
								</div>
								<div className="space-y-1 sm:col-span-3">
									<Label className="text-xs">Dirección</Label>
									<Input {...register(`anexoInmuebles.${index}.direccion`)} />
								</div>
							</div>
						</div>
					))}
				</CardContent>
			</Card>

			{/* Anexo Vehículos */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between">
					<CardTitle>Anexo: Vehículos</CardTitle>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() =>
							appendVehiculo({
								marca: "",
								linea: "",
								placa: "",
								modeloAnio: "",
								valor: "",
							})
						}
					>
						+ Agregar
					</Button>
				</CardHeader>
				<CardContent className="space-y-4">
					{anexoVehiculosFields.length === 0 && (
						<p className="text-muted-foreground text-sm">
							No hay vehículos agregados
						</p>
					)}
					{anexoVehiculosFields.map((field, index) => (
						<div key={field.id} className="rounded-lg border p-4">
							<div className="mb-2 flex items-center justify-between">
								<span className="font-medium text-sm">
									Vehículo {index + 1}
								</span>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									onClick={() => removeVehiculo(index)}
								>
									Eliminar
								</Button>
							</div>
							<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
								<div className="space-y-1">
									<Label className="text-xs">Marca</Label>
									<Input {...register(`anexoVehiculos.${index}.marca`)} />
								</div>
								<div className="space-y-1">
									<Label className="text-xs">Línea</Label>
									<Input {...register(`anexoVehiculos.${index}.linea`)} />
								</div>
								<div className="space-y-1">
									<Label className="text-xs">Placa</Label>
									<Input {...register(`anexoVehiculos.${index}.placa`)} />
								</div>
								<div className="space-y-1">
									<Label className="text-xs">Modelo/Año</Label>
									<Input {...register(`anexoVehiculos.${index}.modeloAnio`)} />
								</div>
								<div className="space-y-1">
									<Label className="text-xs">Valor (Q)</Label>
									<Input
										type="number"
										step="0.01"
										{...register(`anexoVehiculos.${index}.valor`)}
									/>
								</div>
							</div>
						</div>
					))}
				</CardContent>
			</Card>

			<div className="flex justify-end">
				<Button type="submit" size="lg" disabled={isSubmitting}>
					{isSubmitting ? "Guardando..." : "Continuar a Firma"}
				</Button>
			</div>
		</form>
	);
}
