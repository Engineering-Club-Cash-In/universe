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
import { client, orpc } from "@/utils/orpc";

function toLocalDateStr(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export interface SeguimientoRecurrenteModalProps {
	isOpen: boolean;
	onClose: () => void;
	casoCobroId: string;
}

export function SeguimientoRecurrenteModal({
	isOpen,
	onClose,
	casoCobroId,
}: SeguimientoRecurrenteModalProps) {
	const queryClient = useQueryClient();

	const [preset, setPreset] = useState<string>("diario");
	const [metodo, setMetodo] = useState<
		"llamada" | "whatsapp" | "email" | "visita_domicilio" | "carta_notarial"
	>("llamada");
	const [customInterval, setCustomInterval] = useState<number>(1);
	const [fechaInicio, setFechaInicio] = useState<Date | undefined>(new Date());
	const [fechaFin, setFechaFin] = useState<Date | undefined>(undefined);

	const createMutation = useMutation({
		mutationFn: async (data: any) => client.createSeguimiento(data),
		onSuccess: () => {
			toast.success("Seguimiento recurrente programado exitosamente");
			queryClient.invalidateQueries(
				orpc.getSeguimientosActivos.queryOptions({
					input: { casoCobroId },
				}),
			);
			onClose();
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

	return (
		<Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="sm:max-w-[425px]">
				<DialogHeader>
					<DialogTitle>Programar Seguimiento Recurrente</DialogTitle>
					<DialogDescription>
						Automatiza los recordatorios y contactos periódicos para este caso.
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={handleSubmit} className="space-y-4 pt-4">
					<div className="space-y-2">
						<Label>Frecuencia</Label>
						<Select value={preset} onValueChange={setPreset}>
							<SelectTrigger>
								<SelectValue placeholder="Seleccione una frecuencia" />
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
								<SelectValue placeholder="Método" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="llamada">Llamada</SelectItem>
								<SelectItem value="whatsapp">WhatsApp</SelectItem>
								<SelectItem value="email">Email</SelectItem>
								<SelectItem value="visita_domicilio">
									Visita a Domicilio
								</SelectItem>
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
							placeholder="Seleccione fecha de finalización"
						/>
					</div>

					<div className="flex justify-end gap-2 pt-4">
						<Button type="button" variant="outline" onClick={onClose}>
							Cancelar
						</Button>
						<Button type="submit" disabled={createMutation.isPending}>
							{createMutation.isPending ? "Guardando..." : "Programar"}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
