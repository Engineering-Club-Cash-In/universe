import { AlertTriangle, Car, Pencil } from "lucide-react";
import type { ReactNode } from "react";
import { CrmCard, CrmField, crmText } from "@/components/ds/cards-credito";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type DatoVehiculo = { label: string; valor: ReactNode };

/**
 * Cabecera compacta del vehículo en la Ficha 360 › Ubicaciones (Figma
 * Card/Vehículo, 88:902): ícono, marca-modelo-año, placa y tipo en una línea,
 * y el resto de los datos (motor, chasis, seguro…) en una fila que hace wrap.
 * Antes era una tarjeta de media pantalla con una grilla casi vacía. Solo
 * presentación; la edición la maneja el padre.
 */
export function VehiculoResumen({
	titulo,
	placa,
	tipo,
	datos,
	gps,
	migrado = false,
	onEditar,
	edicion,
	className,
}: {
	/** «Toyota Hilux 2021». */
	titulo: string;
	placa: string | null;
	tipo?: string | null;
	/** Motor, chasis, pasajeros, uso, póliza… Solo los que tienen valor. */
	datos: DatoVehiculo[];
	/** Estado del GPS de la unidad (pill). */
	gps?: ReactNode;
	/** Crédito migrado sin datos del vehículo. */
	migrado?: boolean;
	/** Lápiz de editar (solo si hay vehículo). */
	onEditar?: () => void;
	/** Formulario de edición: reemplaza los datos mientras se edita. */
	edicion?: ReactNode;
	className?: string;
}) {
	const subtitulo = [placa ? `Placa ${placa}` : "Sin placa", tipo]
		.filter(Boolean)
		.join(" · ");
	return (
		<CrmCard
			className={cn("gap-3 p-4", className)}
			data-slot="vehiculo-resumen"
			superficie="outline"
		>
			<div className="flex items-center gap-3">
				<span
					aria-hidden
					className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-subtle text-brand"
				>
					<Car className="size-5" />
				</span>
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<h3 className={cn(crmText.name, "wrap-break-word")}>{titulo}</h3>
					<p className={crmText.sub}>{subtitulo}</p>
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					{gps}
					{onEditar && !edicion ? (
						<Button
							aria-label="Editar vehículo"
							onClick={onEditar}
							size="icon-sm"
							title="Editar vehículo"
							variant="ghost"
						>
							<Pencil aria-hidden />
						</Button>
					) : null}
				</div>
			</div>

			{migrado && !edicion ? (
				<div className="flex items-start gap-2 rounded-lg bg-warning-subtle px-3 py-2">
					<AlertTriangle
						aria-hidden
						className="mt-0.5 size-3.5 shrink-0 text-warning-text"
					/>
					<p className="text-xs">
						<span className="font-semibold text-warning-text">
							Vehículo sin información.{" "}
						</span>
						<span className="text-fg-secondary">
							Este crédito fue migrado y no tiene datos del vehículo. Edite la
							información manualmente.
						</span>
					</p>
				</div>
			) : null}

			{edicion ??
				(datos.length > 0 ? (
					<div className="flex flex-wrap gap-x-7 gap-y-2.5 border-line-subtle border-t pt-3">
						{datos.map((d) => (
							<CrmField
								className="max-w-full"
								key={d.label}
								label={d.label}
								valueClassName="wrap-break-word"
							>
								{d.valor}
							</CrmField>
						))}
					</div>
				) : null)}
		</CrmCard>
	);
}

export type FormVehiculo = {
	make: string;
	model: string;
	year: number;
	licensePlate: string;
};

/** Edición en línea de marca, modelo, año y placa (lo que acepta updateVehicle). */
export function VehiculoEdicionForm({
	form,
	onChange,
	onGuardar,
	onCancelar,
	guardando,
}: {
	form: FormVehiculo;
	onChange: (form: FormVehiculo) => void;
	onGuardar: () => void;
	onCancelar: () => void;
	guardando: boolean;
}) {
	return (
		<form
			className="flex flex-col gap-3 border-line-subtle border-t pt-3"
			onSubmit={(e) => {
				e.preventDefault();
				if (!guardando && form.make && form.model) onGuardar();
			}}
		>
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="vehicle-make">Marca</Label>
					<Input
						id="vehicle-make"
						onChange={(e) => onChange({ ...form, make: e.target.value })}
						placeholder="Ej.: Toyota"
						value={form.make}
					/>
				</div>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="vehicle-model">Modelo</Label>
					<Input
						id="vehicle-model"
						onChange={(e) => onChange({ ...form, model: e.target.value })}
						placeholder="Ej.: Corolla"
						value={form.model}
					/>
				</div>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="vehicle-year">Año</Label>
					<Input
						id="vehicle-year"
						inputMode="numeric"
						onChange={(e) =>
							onChange({ ...form, year: Number(e.target.value) })
						}
						placeholder="Ej.: 2020"
						type="number"
						value={form.year}
					/>
				</div>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="vehicle-plate">Placa</Label>
					<Input
						id="vehicle-plate"
						onChange={(e) =>
							onChange({ ...form, licensePlate: e.target.value })
						}
						placeholder="Ej.: P-123ABC"
						value={form.licensePlate}
					/>
				</div>
			</div>
			<div className="flex gap-2">
				<Button
					disabled={guardando || !form.make || !form.model}
					size="sm"
					type="submit"
				>
					{guardando ? "Guardando…" : "Guardar"}
				</Button>
				<Button
					disabled={guardando}
					onClick={onCancelar}
					size="sm"
					type="button"
					variant="outline"
				>
					Cancelar
				</Button>
			</div>
		</form>
	);
}
