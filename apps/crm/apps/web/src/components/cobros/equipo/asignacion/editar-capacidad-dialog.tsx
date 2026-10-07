import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { type Bucket, BucketBadge } from "@/components/ds/badges";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
	dialogTitleClassName,
} from "@/components/ui/dialog";
import { FieldMessage } from "@/components/ui/field-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { orpc, queryClient } from "@/utils/orpc";
import { AvatarMini } from "./carga-resumen-vista";

/**
 * Modal «Editar capacidad» (CB-019) de un asesor en un bucket, compacto como
 * «Marcar ausente»: asesor y bucket arriba, capacidad máxima, margen de alerta
 * (porcentaje o cuentas fijas, en dos botones) y Cancelar / Guardar. Solo lo
 * abre el rol `admin` (el endpoint `actualizarCapacidadAsesorBucket` es
 * adminProcedure). Antes solo editable a mano por SQL (ver
 * cargaAsesorBucket.ts): este modal es el único camino de escritura, vía
 * PATCH /buckets/asesor-bucket/:id/:bucket.
 */

// CB-019 (review) · Mismos topes que el server (cobros.ts actualizarCapacidadAsesorBucket
// + actualizarAsesorBucket.ts en cartera-back) — validar acá es solo UX, el
// server sigue siendo la fuente de verdad. Devuelve el motivo por el que no
// se puede guardar, o null si todo es válido.
function motivoInvalido(
	capacidad: string,
	margenTipo: "porcentaje" | "fijo",
	margenValor: string,
): string | null {
	const capacidadNum = Number(capacidad);
	if (capacidad.trim() === "" || !Number.isFinite(capacidadNum)) {
		return "Capacidad máxima debe ser un número";
	}
	if (!Number.isInteger(capacidadNum) || capacidadNum <= 0) {
		return "Capacidad máxima debe ser un entero mayor a 0";
	}
	if (capacidadNum > 2000) {
		return "Capacidad máxima no puede ser mayor a 2000";
	}
	const margenNum = Number(margenValor);
	if (margenValor.trim() === "" || !Number.isFinite(margenNum)) {
		return "Valor de margen debe ser un número";
	}
	if (margenNum < 0) {
		return "Valor de margen no puede ser negativo";
	}
	if (margenTipo === "porcentaje" && margenNum > 100) {
		return "Valor de margen no puede ser mayor a 100 cuando es porcentaje";
	}
	if (margenTipo === "fijo" && margenNum > 500) {
		return "Valor de margen no puede ser mayor a 500 cuando es fijo";
	}
	return null;
}

const TIPOS_MARGEN: { valor: "porcentaje" | "fijo"; etiqueta: string }[] = [
	{ valor: "porcentaje", etiqueta: "Porcentaje" },
	{ valor: "fijo", etiqueta: "Cuentas fijas" },
];

export type EditarCapacidadVistaProps = {
	nombre: string;
	bucket: number;
	/** Cuentas actuales en el bucket (contexto); opcional. */
	cuentas?: number;
	capacidad: string;
	onCapacidad: (valor: string) => void;
	margenTipo: "porcentaje" | "fijo";
	onMargenTipo: (tipo: "porcentaje" | "fijo") => void;
	margenValor: string;
	onMargenValor: (valor: string) => void;
	error: string | null;
	guardando: boolean;
	onCancelar: () => void;
	onGuardar: () => void;
};

/** Contenido del modal (sin el Dialog: así el showcase lo pinta en línea). */
export function EditarCapacidadVista(p: EditarCapacidadVistaProps) {
	const b = p.bucket >= 0 && p.bucket <= 5 ? (`B${p.bucket}` as Bucket) : null;
	const capacidadNum = Number(p.capacidad);
	const libre =
		p.cuentas !== undefined && Number.isFinite(capacidadNum)
			? capacidadNum - p.cuentas
			: null;
	return (
		<div className="flex min-w-0 flex-col gap-5">
			<h2 className={cn(dialogTitleClassName, "pr-10")}>Editar capacidad</h2>

			<div className="flex items-center gap-3">
				<AvatarMini nombre={p.nombre} className="size-11 text-[13px]" />
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<p className="truncate font-semibold text-fg text-sm leading-[1.26]">
						{p.nombre}
					</p>
					<p className="text-fg-secondary text-xs leading-[1.26]">
						{p.cuentas !== undefined
							? `${p.cuentas.toLocaleString("es-GT")} cuentas en B${p.bucket}`
							: `Bucket B${p.bucket}`}
					</p>
				</div>
				{b ? <BucketBadge bucket={b} formato="Completa" /> : null}
			</div>

			<fieldset className="flex flex-col gap-1.5" disabled={p.guardando}>
				<Label htmlFor="capacidad-base">Capacidad máxima (cuentas)</Label>
				<Input
					id="capacidad-base"
					type="number"
					min="1"
					inputMode="numeric"
					value={p.capacidad}
					onChange={(e) => p.onCapacidad(e.target.value)}
				/>
				{libre !== null && !p.error ? (
					<p
						className={cn(
							"text-[11px] leading-[1.26]",
							libre > 0 ? "text-fg-tertiary" : "text-warning-text",
						)}
					>
						{libre > 0
							? `Quedaría con capacidad para +${libre.toLocaleString("es-GT")}.`
							: libre < 0
								? `Quedaría ${(-libre).toLocaleString("es-GT")} ${libre === -1 ? "cuenta" : "cuentas"} sobre su capacidad.`
								: "Quedaría sin capacidad disponible."}
					</p>
				) : null}
			</fieldset>

			<fieldset className="flex flex-col gap-2" disabled={p.guardando}>
				<legend className="mb-2 font-medium text-fg text-sm">
					Margen de alerta
				</legend>
				<div className="grid grid-cols-2 gap-2.5">
					{TIPOS_MARGEN.map((t) => (
						<Button
							key={t.valor}
							type="button"
							size="sm"
							variant={p.margenTipo === t.valor ? "default" : "outline"}
							aria-pressed={p.margenTipo === t.valor}
							onClick={() => p.onMargenTipo(t.valor)}
						>
							{t.etiqueta}
						</Button>
					))}
				</div>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="margen-valor">
						Valor {p.margenTipo === "porcentaje" ? "(%)" : "(cuentas)"}
					</Label>
					<Input
						id="margen-valor"
						type="number"
						min="0"
						inputMode="numeric"
						value={p.margenValor}
						onChange={(e) => p.onMargenValor(e.target.value)}
					/>
				</div>
				<p className="text-[11px] text-fg-tertiary leading-[1.35]">
					Al llegar a la capacidad más este margen, se activa la alerta de nueva
					posición.
				</p>
			</fieldset>

			{p.error ? <FieldMessage>{p.error}</FieldMessage> : null}

			<div className="grid grid-cols-2 gap-3">
				<Button
					variant="secondary"
					disabled={p.guardando}
					onClick={p.onCancelar}
				>
					Cancelar
				</Button>
				<Button
					disabled={!!p.error}
					loading={p.guardando}
					onClick={p.onGuardar}
				>
					{p.guardando ? "Guardando…" : "Guardar"}
				</Button>
			</div>
		</div>
	);
}

// CB-019 · Modal de edición de capacidad_base/margen_alerta por asesor+bucket.
export function EditarCapacidadDialog({
	asesorId,
	nombre,
	bucket,
	cuentas,
	capacidadBase,
	margenAlertaTipo,
	margenAlertaValor,
	open,
	onOpenChange,
}: {
	asesorId: number;
	nombre: string;
	bucket: number;
	cuentas?: number;
	capacidadBase: number;
	margenAlertaTipo: "porcentaje" | "fijo";
	margenAlertaValor: number;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [capacidad, setCapacidad] = useState(String(capacidadBase));
	const [margenTipo, setMargenTipo] = useState<"porcentaje" | "fijo">(
		margenAlertaTipo,
	);
	const [margenValor, setMargenValor] = useState(String(margenAlertaValor));
	const error = motivoInvalido(capacidad, margenTipo, margenValor);

	const mutation = useMutation({
		...orpc.actualizarCapacidadAsesorBucket.mutationOptions(),
		onSuccess: () => {
			toast.success("Capacidad actualizada");
			// .key() = prefijo del path → invalida TODAS las variantes de la query
			// (cualquier bucket filtrado), no solo input:{} (review code-review:
			// mismo patrón documentado en reasignaciones.tsx:145-149 — con
			// queryOptions({input:{}}).queryKey la tabla con filtro activo quedaba
			// stale tras guardar).
			queryClient.invalidateQueries({
				queryKey: orpc.getCargaPorAsesorBucket.key(),
			});
			onOpenChange(false);
		},
		onError: (error: Error) => {
			toast.error(error.message);
		},
	});

	const cambiarAbierto = (next: boolean) => {
		if (!next) {
			setCapacidad(String(capacidadBase));
			setMargenTipo(margenAlertaTipo);
			setMargenValor(String(margenAlertaValor));
		}
		onOpenChange(next);
	};

	return (
		<Dialog open={open} onOpenChange={cambiarAbierto}>
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-110">
				<DialogTitle className="sr-only">
					Capacidad de {nombre} en B{bucket}
				</DialogTitle>
				<DialogDescription className="sr-only">
					Capacidad máxima de cuentas y margen de alerta del asesor en este
					bucket.
				</DialogDescription>
				<EditarCapacidadVista
					nombre={nombre}
					bucket={bucket}
					cuentas={cuentas}
					capacidad={capacidad}
					onCapacidad={setCapacidad}
					margenTipo={margenTipo}
					onMargenTipo={setMargenTipo}
					margenValor={margenValor}
					onMargenValor={setMargenValor}
					error={error}
					guardando={mutation.isPending}
					onCancelar={() => cambiarAbierto(false)}
					onGuardar={() =>
						mutation.mutate({
							asesorId,
							bucket,
							capacidadBase: Number(capacidad),
							margenAlertaTipo: margenTipo,
							margenAlertaValor: Number(margenValor),
						})
					}
				/>
			</DialogContent>
		</Dialog>
	);
}
