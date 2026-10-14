/**
 * Modales «Registrar Vehículo» y «Editar Vehículo» del Panel de Vehículos.
 *
 * Son formularios hermanos: comparten el armazón (`VehiculoDialog`: encabezado,
 * cuerpo con scroll y botones fijos al pie) y los campos (`CamposVehiculo`), así
 * que se presentan igual. El de editar agrega el estado del vehículo junto al
 * título y, si es un vendido bloqueado, el aviso arriba de las secciones.
 *
 * Solo es presentación: el estado de cada formulario, las validaciones y el
 * envío siguen en `routes/vehicles/index.tsx`, que pasa `onSubmit`.
 *
 * Rejilla por sección: 6 columnas en escritorio (lg) y 2 en celular, donde los
 * campos largos y los desplegables van a lo ancho.
 */
import { Pencil, Sparkles } from "lucide-react";
import type * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { FieldDescription, FieldMessage } from "@/components/ui/field-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
	VEHICLE_BODY_TYPE_OPTIONS,
	VEHICLE_CONDITION_OPTIONS,
	VEHICLE_PROVENANCE_OPTIONS,
	VEHICLE_USE_OPTIONS,
} from "@/lib/vehicle-form-options";

export type EstadoVehiculo =
	| "pending"
	| "available"
	| "sold"
	| "maintenance"
	| "auction";

/** Campos que comparten los dos formularios. */
export type DatosVehiculoForm = {
	make: string;
	model: string;
	year: number;
	color: string;
	vehicleType: string;
	licensePlate: string;
	vinNumber: string;
	motorNumber: string;
	origin: string;
	fuelType: string;
	transmission: string;
	kmMileage: number;
	isNew: boolean;
	isOwned: boolean;
	seats: number | null;
	doors: number | null;
	axles: number | null;
	vehicleUse: string;
	series: string;
	iscvCode: string;
	cylinders: string;
	engineCC: string;
};

export type EditarVehiculoForm = DatosVehiculoForm & {
	id: string;
	status: EstadoVehiculo;
	/** Estado al abrir el modal (no se envía al server). */
	initialStatus: EstadoVehiculo;
};

type Modo = "registrar" | "editar";

/**
 * Lo único que cambia entre los dos formularios dentro de los campos: el año
 * mínimo y algunos textos, tal como los tenía cada modal.
 */
const VARIANTES: Record<
	Modo,
	{
		idPrefix: string;
		anioMinimo: number;
		asientos: string;
		puertas: string;
		ejes: string;
		usoEtiqueta: string;
		usoPlaceholder: string;
		serie: string;
		iscv: string;
	}
> = {
	registrar: {
		idPrefix: "",
		anioMinimo: 2000,
		asientos: "5",
		puertas: "4",
		ejes: "2",
		usoEtiqueta: "Uso",
		usoPlaceholder: "Seleccionar",
		serie: "Serie",
		iscv: "ISCV",
	},
	editar: {
		idPrefix: "edit-",
		anioMinimo: 1990,
		asientos: "Ej: 5",
		puertas: "Ej: 4",
		ejes: "Ej: 2",
		usoEtiqueta: "Uso del Vehículo",
		usoPlaceholder: "Seleccionar uso",
		serie: "Serie del vehículo",
		iscv: "Código ISCV",
	},
};

/* ── Piezas de presentación ─────────────────────────────────────────────── */

/** Columnas que ocupa un campo en la rejilla de 6 del escritorio. */
const COLUMNAS_LG = {
	1: "lg:col-span-1",
	2: "lg:col-span-2",
	3: "lg:col-span-3",
} as const;

function Campo({
	id,
	etiqueta,
	lg = 2,
	anchoEnMovil = false,
	children,
}: {
	id: string;
	etiqueta: React.ReactNode;
	/** Columnas en escritorio (de 6). */
	lg?: keyof typeof COLUMNAS_LG;
	/** En celular ocupa las dos columnas (campos largos y desplegables). */
	anchoEnMovil?: boolean;
	children: React.ReactNode;
}) {
	return (
		<div
			className={cn(
				"flex min-w-0 flex-col gap-1.5",
				anchoEnMovil && "max-sm:col-span-2",
				COLUMNAS_LG[lg],
			)}
		>
			<Label htmlFor={id}>{etiqueta}</Label>
			{children}
		</div>
	);
}

function Seccion({
	titulo,
	nota,
	notaTono = "neutral",
	accion,
	children,
}: {
	titulo: React.ReactNode;
	/** Texto corto junto al título. */
	nota?: React.ReactNode;
	notaTono?: "neutral" | "advertencia";
	/** Control que va a la derecha del título. */
	accion?: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		// La acción va después de los campos en el DOM (orden de tabulación y foco
		// inicial en el primer campo) y se pinta a la derecha del título; en
		// celular queda debajo de los campos.
		<section className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-2.5">
			<div className="col-span-2 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 self-center sm:col-span-1">
				<h3 className="font-semibold text-fg text-sm leading-5">{titulo}</h3>
				{nota ? (
					<span
						className={cn(
							"type-caption",
							notaTono === "advertencia"
								? "text-warning-text"
								: "text-fg-tertiary",
						)}
					>
						{nota}
					</span>
				) : null}
			</div>
			<div className="col-span-2 row-start-2 grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-6">
				{children}
			</div>
			{accion ? (
				<div className="col-span-2 row-start-3 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:self-center">
					{accion}
				</div>
			) : null}
		</section>
	);
}

/**
 * Armazón común: encabezado (con un control opcional a la derecha), cuerpo con
 * scroll y botones fijos al pie.
 */
function VehiculoDialog({
	open,
	onOpenChange,
	titulo,
	descripcion,
	cabeceraExtra,
	aviso,
	onSubmit,
	acciones,
	children,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	titulo: React.ReactNode;
	descripcion: React.ReactNode;
	/** Control junto al título (en editar, el estado del vehículo). */
	cabeceraExtra?: React.ReactNode;
	/** Aviso arriba de las secciones. */
	aviso?: React.ReactNode;
	onSubmit: React.FormEventHandler<HTMLFormElement>;
	acciones: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="flex max-h-[calc(100dvh-4rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
				{/* El botón de cerrar es el de DialogContent (va al final, así el foco
				    inicial cae en el primer campo); sm:pr-14 le deja libre la esquina. */}
				<div className="flex shrink-0 flex-col gap-4 border-line-subtle border-b px-6 pt-5 pb-4 sm:flex-row sm:items-start sm:justify-between sm:pr-14">
					<DialogHeader className="min-w-0 gap-1">
						<DialogTitle className="flex flex-wrap items-center gap-2 sm:pr-0">
							{titulo}
						</DialogTitle>
						<DialogDescription>{descripcion}</DialogDescription>
					</DialogHeader>
					{cabeceraExtra ? (
						<div className="w-full sm:w-72 sm:shrink-0">{cabeceraExtra}</div>
					) : null}
				</div>

				<form
					onSubmit={onSubmit}
					className="flex min-h-0 flex-1 flex-col overflow-y-auto"
				>
					<div className="flex flex-col gap-5 px-6 pt-4 pb-3">
						{aviso}
						{children}
					</div>

					<DialogFooter className="sticky bottom-0 z-10 mt-auto border-line-subtle border-t bg-surface px-6 py-3">
						{acciones}
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

/* ── Campos compartidos ─────────────────────────────────────────────────── */

function CamposVehiculo<T extends DatosVehiculoForm>({
	modo,
	form,
	onFormChange,
	bloqueado = false,
}: {
	modo: Modo;
	form: T;
	onFormChange: (form: T) => void;
	/** Vehículo vendido: todo queda de solo lectura salvo la placa. */
	bloqueado?: boolean;
}) {
	const v = VARIANTES[modo];
	const id = (campo: string) => `${v.idPrefix}${campo}`;
	const editando = modo === "editar";

	return (
		<>
			<Seccion
				titulo="Información Básica"
				accion={
					<div className="flex items-center gap-2.5">
						<Checkbox
							id={id("isOwned")}
							disabled={bloqueado}
							checked={form.isOwned}
							onCheckedChange={(checked) =>
								onFormChange({
									...form,
									isOwned: checked === true,
								})
							}
						/>
						<Label htmlFor={id("isOwned")} className="cursor-pointer">
							Vehículo propiedad de Cash In
						</Label>
					</div>
				}
			>
				<Campo id={id("make")} etiqueta="Marca *">
					<Input
						id={id("make")}
						disabled={bloqueado}
						value={form.make}
						onChange={(e) => onFormChange({ ...form, make: e.target.value })}
						placeholder="Ej: Toyota"
						required
					/>
				</Campo>
				<Campo id={id("model")} etiqueta="Modelo/Línea *">
					<Input
						id={id("model")}
						disabled={bloqueado}
						value={form.model}
						onChange={(e) => onFormChange({ ...form, model: e.target.value })}
						placeholder="Ej: Corolla"
						required
					/>
				</Campo>
				<Campo id={id("year")} etiqueta="Año *" lg={1}>
					<Input
						id={id("year")}
						disabled={bloqueado}
						type="number"
						value={form.year}
						onChange={(e) =>
							onFormChange({
								...form,
								year:
									Number.parseInt(e.target.value) || new Date().getFullYear(),
							})
						}
						min={v.anioMinimo}
						max={new Date().getFullYear() + 1}
						required
					/>
				</Campo>
				<Campo id={id("color")} etiqueta="Color *" lg={1}>
					<Input
						id={id("color")}
						disabled={bloqueado}
						value={form.color}
						onChange={(e) => onFormChange({ ...form, color: e.target.value })}
						placeholder="Ej: Blanco"
						required
					/>
				</Campo>
				<Campo
					id={id("vehicleType")}
					etiqueta="Tipo de Vehículo *"
					anchoEnMovil
				>
					<Select
						value={form.vehicleType}
						disabled={bloqueado}
						onValueChange={(value) =>
							onFormChange({ ...form, vehicleType: value })
						}
					>
						<SelectTrigger id={id("vehicleType")}>
							<SelectValue placeholder="Seleccionar tipo" />
						</SelectTrigger>
						<SelectContent>
							{VEHICLE_BODY_TYPE_OPTIONS.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</Campo>
				<Campo id={id("vehicleCondition")} etiqueta="Condición *" anchoEnMovil>
					<Select
						value={String(form.isNew)}
						disabled={bloqueado}
						onValueChange={(value) =>
							onFormChange({ ...form, isNew: value === "true" })
						}
					>
						<SelectTrigger id={id("vehicleCondition")}>
							<SelectValue placeholder="Seleccionar condición" />
						</SelectTrigger>
						<SelectContent>
							{VEHICLE_CONDITION_OPTIONS.map((option) => (
								<SelectItem
									key={String(option.value)}
									value={String(option.value)}
								>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</Campo>
				<Campo id={id("origin")} etiqueta="Origen" anchoEnMovil>
					<Select
						value={form.origin}
						disabled={bloqueado}
						onValueChange={(value) => onFormChange({ ...form, origin: value })}
					>
						<SelectTrigger id={id("origin")}>
							<SelectValue placeholder="Seleccionar origen" />
						</SelectTrigger>
						<SelectContent>
							{VEHICLE_PROVENANCE_OPTIONS.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</Campo>
			</Seccion>

			<Seccion
				titulo="Identificación y Mecánica"
				nota={
					editando && form.isNew
						? "(requeridos para completar la oportunidad)"
						: undefined
				}
				notaTono="advertencia"
			>
				<Campo id={id("licensePlate")} etiqueta="Placa" anchoEnMovil>
					{/* La placa sigue editable en un vendido: puede recibir placas después. */}
					<Input
						id={id("licensePlate")}
						value={form.licensePlate}
						onChange={(e) =>
							onFormChange({ ...form, licensePlate: e.target.value })
						}
						placeholder="Ej: P-123ABC"
					/>
				</Campo>
				<Campo id={id("vinNumber")} etiqueta="VIN" anchoEnMovil>
					<Input
						id={id("vinNumber")}
						disabled={bloqueado}
						value={form.vinNumber}
						onChange={(e) =>
							onFormChange({ ...form, vinNumber: e.target.value })
						}
						placeholder="Número de identificación"
					/>
				</Campo>
				<Campo id={id("motorNumber")} etiqueta="No. Motor" anchoEnMovil>
					<Input
						id={id("motorNumber")}
						disabled={bloqueado}
						value={form.motorNumber}
						onChange={(e) =>
							onFormChange({ ...form, motorNumber: e.target.value })
						}
						placeholder="Número de motor"
					/>
				</Campo>
				<Campo id={id("fuelType")} etiqueta="Combustible" anchoEnMovil>
					<Select
						value={form.fuelType}
						disabled={bloqueado}
						onValueChange={(value) =>
							onFormChange({ ...form, fuelType: value })
						}
					>
						<SelectTrigger id={id("fuelType")}>
							<SelectValue placeholder="Seleccionar combustible" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="Gasolina">Gasolina</SelectItem>
							<SelectItem value="Diesel">Diesel</SelectItem>
							<SelectItem value="Eléctrico">Eléctrico</SelectItem>
							<SelectItem value="Híbrido">Híbrido</SelectItem>
						</SelectContent>
					</Select>
				</Campo>
				<Campo id={id("transmission")} etiqueta="Transmisión" anchoEnMovil>
					<Select
						value={form.transmission}
						disabled={bloqueado}
						onValueChange={(value) =>
							onFormChange({ ...form, transmission: value })
						}
					>
						<SelectTrigger id={id("transmission")}>
							<SelectValue placeholder="Seleccionar transmisión" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="Automático">Automático</SelectItem>
							<SelectItem value="Manual">Manual</SelectItem>
						</SelectContent>
					</Select>
				</Campo>
				<Campo id={id("kmMileage")} etiqueta="Kilometraje" anchoEnMovil>
					<Input
						id={id("kmMileage")}
						disabled={bloqueado}
						type="number"
						value={form.kmMileage}
						onChange={(e) =>
							onFormChange({
								...form,
								kmMileage: Number.parseInt(e.target.value) || 0,
							})
						}
						min={0}
						placeholder="0"
					/>
				</Campo>
			</Seccion>

			<Seccion
				titulo="Datos para Contratos"
				nota={
					editando ? "(requeridos para generar contratos legales)" : undefined
				}
			>
				<Campo id={id("seats")} etiqueta="Asientos" lg={1}>
					<Input
						id={id("seats")}
						disabled={bloqueado}
						type="number"
						value={form.seats ?? ""}
						onChange={(e) =>
							onFormChange({
								...form,
								seats: e.target.value ? Number.parseInt(e.target.value) : null,
							})
						}
						min={1}
						max={50}
						placeholder={v.asientos}
					/>
				</Campo>
				<Campo id={id("doors")} etiqueta="Puertas" lg={1}>
					<Input
						id={id("doors")}
						disabled={bloqueado}
						type="number"
						value={form.doors ?? ""}
						onChange={(e) =>
							onFormChange({
								...form,
								doors: e.target.value ? Number.parseInt(e.target.value) : null,
							})
						}
						min={2}
						max={6}
						placeholder={v.puertas}
					/>
				</Campo>
				<Campo id={id("axles")} etiqueta="Ejes" lg={1}>
					<Input
						id={id("axles")}
						disabled={bloqueado}
						type="number"
						value={form.axles ?? ""}
						onChange={(e) =>
							onFormChange({
								...form,
								axles: e.target.value ? Number.parseInt(e.target.value) : null,
							})
						}
						min={2}
						max={10}
						placeholder={v.ejes}
					/>
				</Campo>
				<Campo id={id("vehicleUse")} etiqueta={v.usoEtiqueta} lg={1}>
					<Select
						value={form.vehicleUse}
						disabled={bloqueado}
						onValueChange={(value) =>
							onFormChange({ ...form, vehicleUse: value })
						}
					>
						<SelectTrigger id={id("vehicleUse")}>
							<SelectValue placeholder={v.usoPlaceholder} />
						</SelectTrigger>
						<SelectContent>
							{VEHICLE_USE_OPTIONS.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</Campo>
				<Campo id={id("cylinders")} etiqueta="Cilindros" lg={1}>
					<Input
						id={id("cylinders")}
						disabled={bloqueado}
						value={form.cylinders}
						onChange={(e) =>
							onFormChange({ ...form, cylinders: e.target.value })
						}
						placeholder="Ej. 4"
					/>
				</Campo>
				<Campo id={id("engineCC")} etiqueta="Motor (CC)" lg={1}>
					<Input
						id={id("engineCC")}
						disabled={bloqueado}
						value={form.engineCC}
						onChange={(e) =>
							onFormChange({ ...form, engineCC: e.target.value })
						}
						placeholder="Ej. 2000"
					/>
				</Campo>
				<Campo id={id("series")} etiqueta="Serie" lg={3} anchoEnMovil>
					<Input
						id={id("series")}
						disabled={bloqueado}
						value={form.series}
						onChange={(e) => onFormChange({ ...form, series: e.target.value })}
						placeholder={v.serie}
					/>
				</Campo>
				<Campo id={id("iscvCode")} etiqueta="Código ISCV" lg={3} anchoEnMovil>
					<Input
						id={id("iscvCode")}
						disabled={bloqueado}
						value={form.iscvCode}
						onChange={(e) =>
							onFormChange({ ...form, iscvCode: e.target.value })
						}
						placeholder={v.iscv}
					/>
				</Campo>
			</Seccion>
		</>
	);
}

/* ── Registrar Vehículo ─────────────────────────────────────────────────── */

export type RegistrarVehiculoDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	form: DatosVehiculoForm;
	onFormChange: (form: DatosVehiculoForm) => void;
	/** Valida y envía (vive en la ruta). */
	onSubmit: React.FormEventHandler<HTMLFormElement>;
	guardando: boolean;
};

export function RegistrarVehiculoDialog({
	open,
	onOpenChange,
	form,
	onFormChange,
	onSubmit,
	guardando,
}: RegistrarVehiculoDialogProps) {
	return (
		<VehiculoDialog
			open={open}
			onOpenChange={onOpenChange}
			titulo={
				<>
					<Sparkles className="size-5 text-brand" />
					Registrar Vehículo
				</>
			}
			descripcion="Selecciona si es usado/rodado o nuevo de agencia. Los campos con * son requeridos."
			onSubmit={onSubmit}
			acciones={
				<>
					<Button
						type="button"
						variant="outline"
						onClick={() => onOpenChange(false)}
					>
						Cancelar
					</Button>
					<Button type="submit" disabled={guardando}>
						{guardando ? "Creando..." : "Crear Vehículo"}
					</Button>
				</>
			}
		>
			<CamposVehiculo
				modo="registrar"
				form={form}
				onFormChange={onFormChange}
			/>
		</VehiculoDialog>
	);
}

/* ── Editar Vehículo ────────────────────────────────────────────────────── */

const OPCIONES_ESTADO: {
	value: EstadoVehiculo;
	label: string;
	descripcion: string;
}[] = [
	{
		value: "pending",
		label: "Pendiente",
		descripcion: "En espera o Próximo a la venta",
	},
	{
		value: "available",
		label: "Disponible",
		descripcion: "Listo para venta o financiamiento",
	},
	{
		value: "sold",
		label: "Vendido",
		descripcion: "Vehículo ya fue vendido/financiado",
	},
	{
		value: "maintenance",
		label: "En Mantenimiento",
		descripcion: "En reparación o servicio técnico",
	},
	{
		value: "auction",
		label: "En Remate",
		descripcion: "Disponible para subasta/remate",
	},
];

export type EditarVehiculoDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	form: EditarVehiculoForm;
	onFormChange: (form: EditarVehiculoForm) => void;
	/** Cambio de estado (la ruta decide qué más se ajusta). */
	onEstadoChange: (estado: EstadoVehiculo) => void;
	/** Vendido y el usuario no puede cambiarle el estado: se muestra fijo. */
	estadoSoloLectura: boolean;
	/** Vendido que aún no pasó a Disponible: todo bloqueado salvo la placa. */
	bloqueado: boolean;
	/** Valida y envía (vive en la ruta). */
	onSubmit: React.FormEventHandler<HTMLFormElement>;
	guardando: boolean;
};

export function EditarVehiculoDialog({
	open,
	onOpenChange,
	form,
	onFormChange,
	onEstadoChange,
	estadoSoloLectura,
	bloqueado,
	onSubmit,
	guardando,
}: EditarVehiculoDialogProps) {
	return (
		<VehiculoDialog
			open={open}
			onOpenChange={onOpenChange}
			titulo={
				<>
					<Pencil className="size-5 text-brand" />
					Editar Vehículo
					{form.isNew && (
						<Badge variant="info" className="ml-1">
							<Sparkles />
							Nuevo
						</Badge>
					)}
				</>
			}
			descripcion={
				<>
					Modifica los datos del vehículo.{" "}
					{form.isNew && "Completa los datos faltantes del vehículo nuevo."}
				</>
			}
			cabeceraExtra={
				<div className="flex flex-col gap-1.5">
					<Label htmlFor={estadoSoloLectura ? undefined : "edit-status"}>
						Estado del Vehículo
					</Label>
					{estadoSoloLectura ? (
						<>
							<div className="flex h-10.5 w-full items-center rounded-xl border border-line-subtle bg-muted px-4 text-fg text-sm opacity-60">
								<span className="font-medium">Vendido</span>
							</div>
							<FieldDescription>
								Solo un administrador o supervisor de ventas puede cambiar el
								estado de un vehículo vendido.
							</FieldDescription>
						</>
					) : (
						<Select value={form.status} onValueChange={onEstadoChange}>
							<SelectTrigger id="edit-status">
								<SelectValue placeholder="Seleccionar estado" />
							</SelectTrigger>
							<SelectContent>
								{OPCIONES_ESTADO.map((opcion) => (
									<SelectItem key={opcion.value} value={opcion.value}>
										<div className="flex flex-col">
											<span className="font-medium">{opcion.label}</span>
											<span className="text-fg-tertiary text-xs">
												{opcion.descripcion}
											</span>
										</div>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
				</div>
			}
			aviso={
				bloqueado ? (
					<FieldMessage variant="help">
						La información de un vehículo vendido no se puede editar; el estado
						debe pasar primero a Disponible para habilitar los campos. La placa
						sí puede actualizarse, por si el vehículo recibe placas después de
						la venta.
					</FieldMessage>
				) : undefined
			}
			onSubmit={onSubmit}
			acciones={
				<>
					<Button
						type="button"
						variant="outline"
						onClick={() => onOpenChange(false)}
					>
						Cancelar
					</Button>
					<Button type="submit" disabled={guardando}>
						{guardando ? "Guardando..." : "Guardar Cambios"}
					</Button>
				</>
			}
		>
			<CamposVehiculo
				modo="editar"
				form={form}
				onFormChange={onFormChange}
				bloqueado={bloqueado}
			/>
		</VehiculoDialog>
	);
}
