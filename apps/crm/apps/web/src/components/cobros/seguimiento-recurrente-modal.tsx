import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/react-datepicker";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { client, orpc } from "@/utils/orpc";

function toLocalDateStr(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

type MetodoSeguimiento =
	| "llamada"
	| "whatsapp"
	| "email"
	| "visita_domicilio"
	| "carta_notarial";

/** Lo que el Workspace muestra en «Gestión registrada» tras programar. */
export interface SeguimientoProgramado {
	metodoContacto: MetodoSeguimiento;
	/** diario, semanal, quincenal o custom. */
	presetOriginal: string;
	intervaloDias: number;
	/** "YYYY-MM-DD" (fecha local). */
	fechaInicio: string;
	/** "YYYY-MM-DD" (fecha local) o null si no tiene fin. */
	fechaFin: string | null;
}

export interface SeguimientoRecurrenteModalProps {
	/** Obligatorio sin `embebido`; con `embebido` se ignora (siempre abierto). */
	isOpen?: boolean;
	/** Obligatorio sin `embebido`; con `embebido` no se llama (ver onCancelar). */
	onClose?: () => void;
	casoCobroId: string;
	/** Se llama tras programar con éxito (después de cerrar, sin `embebido`). */
	onExito?: (r: SeguimientoProgramado) => void;
	/** Workspace: se pinta dentro del panel de gestión, sin Dialog. */
	embebido?: boolean;
	/** Solo con `embebido`: el botón secundario del pie («Cancelar»). */
	onCancelar?: () => void;
}

export function SeguimientoRecurrenteModal({
	isOpen = false,
	onClose,
	casoCobroId,
	onExito,
	embebido = false,
	onCancelar,
}: SeguimientoRecurrenteModalProps) {
	const queryClient = useQueryClient();

	const [preset, setPreset] = useState<string>("diario");
	const [metodo, setMetodo] = useState<MetodoSeguimiento>("llamada");
	const [customInterval, setCustomInterval] = useState<number>(1);
	const [fechaInicio, setFechaInicio] = useState<Date | undefined>(new Date());
	const [fechaFin, setFechaFin] = useState<Date | undefined>(undefined);

	const createMutation = useMutation({
		mutationFn: async (data: any) => client.createSeguimiento(data),
		onSuccess: (_r, data: SeguimientoProgramado) => {
			toast.success("Seguimiento recurrente programado exitosamente");
			queryClient.invalidateQueries(
				orpc.getSeguimientosActivos.queryOptions({
					input: { casoCobroId },
				}),
			);
			// Embebido no hay Dialog que cerrar: el Workspace pasa a «Gestión
			// registrada» con onExito.
			if (!embebido) onClose?.();
			onExito?.({
				metodoContacto: data.metodoContacto,
				presetOriginal: data.presetOriginal,
				intervaloDias: data.intervaloDias,
				fechaInicio: data.fechaInicio,
				fechaFin: data.fechaFin,
			});
		},
		onError: (error: any) => {
			toast.error(error.message || "Error al programar el seguimiento");
		},
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();

		let intervaloDias = 1;
		if (preset === "diario") intervaloDias = 1;
		else if (preset === "semanal") intervaloDias = 7;
		else if (preset === "quincenal") intervaloDias = 15;
		else if (preset === "custom") intervaloDias = customInterval;

		const payload = {
			casoCobroId,
			metodoContacto: metodo,
			intervaloDias,
			ocurrenciasMaximas: null,
			fechaInicio: toLocalDateStr(fechaInicio ?? new Date()),
			fechaFin: fechaFin ? toLocalDateStr(fechaFin) : null,
			presetOriginal: preset,
		};

		createMutation.mutate(payload);
	};

	const campos = (
		<>
			<div className="space-y-2">
				<Label>Frecuencia</Label>
				<Select value={preset} onValueChange={setPreset}>
					<SelectTrigger>
						<SelectValue placeholder="Seleccionar frecuencia" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="diario">Diario</SelectItem>
						<SelectItem value="semanal">Semanal</SelectItem>
						<SelectItem value="quincenal">Quincenal</SelectItem>
						<SelectItem value="custom">Personalizado (N días)</SelectItem>
					</SelectContent>
				</Select>
			</div>

			{preset === "custom" && (
				<div className="space-y-2">
					<Label>Intervalo (Días)</Label>
					<Input
						type="number"
						min={1}
						value={customInterval}
						onChange={(e) => setCustomInterval(Number(e.target.value))}
					/>
				</div>
			)}

			<div className="space-y-2">
				<Label>Método de Contacto</Label>
				<Select value={metodo} onValueChange={(val: any) => setMetodo(val)}>
					<SelectTrigger>
						<SelectValue placeholder="Seleccionar método" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="llamada">Llamada</SelectItem>
						<SelectItem value="whatsapp">WhatsApp</SelectItem>
						<SelectItem value="email">Email</SelectItem>
						<SelectItem value="visita_domicilio">Visita a Domicilio</SelectItem>
						<SelectItem value="carta_notarial">Carta Notarial</SelectItem>
					</SelectContent>
				</Select>
			</div>
			<div className="space-y-2">
				<Label>Fecha de Inicio</Label>
				<DatePicker date={fechaInicio} onDateChange={setFechaInicio} />
			</div>

			<div className="space-y-2">
				<Label>Fecha Final</Label>
				<DatePicker
					date={fechaFin}
					onDateChange={setFechaFin}
					placeholder="Seleccionar fecha de finalización"
				/>
			</div>
		</>
	);

	const botonProgramar = (
		<Button
			type="submit"
			disabled={createMutation.isPending}
			className={cn(embebido && "flex-1")}
		>
			{createMutation.isPending ? "Guardando..." : "Programar"}
		</Button>
	);

	if (embebido) {
		return (
			<div className="@container flex min-h-0 flex-1 flex-col">
				<form
					onSubmit={handleSubmit}
					className="flex min-h-0 flex-1 flex-col gap-3"
				>
					<div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
						<p className="text-muted-foreground text-sm">
							Programe recordatorios y contactos periódicos para este caso.
						</p>
						{campos}
					</div>
					<div className="mt-auto flex gap-2 border-line-subtle border-t pt-3">
						<Button
							type="button"
							variant="outline"
							onClick={() => onCancelar?.()}
							disabled={createMutation.isPending}
						>
							Cancelar
						</Button>
						{botonProgramar}
					</div>
				</form>
			</div>
		);
	}

	return (
		<Dialog open={isOpen} onOpenChange={(open) => !open && onClose?.()}>
			<DialogContent className="sm:max-w-[425px]">
				<DialogHeader>
					<DialogTitle>Programar Seguimiento Recurrente</DialogTitle>
					<DialogDescription>
						Programe recordatorios y contactos periódicos para este caso.
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={handleSubmit} className="space-y-4 pt-4">
					{campos}
					<div className="flex justify-end gap-2 pt-4">
						<Button type="button" variant="outline" onClick={() => onClose?.()}>
							Cancelar
						</Button>
						{botonProgramar}
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
