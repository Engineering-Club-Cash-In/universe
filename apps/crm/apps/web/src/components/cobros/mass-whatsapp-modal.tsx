import { useMutation } from "@tanstack/react-query";
import { MessageCircle, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PLANTILLAS_MENSAJES } from "@/lib/cobros/plantillas-mensajes";
import { client } from "@/utils/orpc";

interface MassWhatsappModalProps {
	filtros: {
		estadoMora?: string;
		searchTerm?: string;
		time?: "WEEK" | "MONTH" | "DUEMONTH" | "TODAY";
	};
	children: React.ReactNode;
}

export function MassWhatsappModal({ filtros, children }: MassWhatsappModalProps) {
	const [open, setOpen] = useState(false);
	const [plantillaId, setPlantillaId] = useState<string>(
		PLANTILLAS_MENSAJES[0]?.id ?? "",
	);

	const plantillaSeleccionada = PLANTILLAS_MENSAJES.find(
		(p) => p.id === plantillaId,
	);

	const sendMutation = useMutation({
		mutationFn: () =>
			client.enviarWhatsappMasivoCobros({
				plantillaId,
				estadoMora: filtros.estadoMora,
				searchTerm: filtros.searchTerm,
				time: filtros.time,
			}),
		onSuccess: (res) => {
			toast.success(
				`WhatsApp masivo: ${res.enviados} enviados, ${res.fallidos} fallidos, ${res.descartados.length} descartados`,
			);
			setOpen(false);
		},
		onError: (error: any) => {
			toast.error(error?.message || "Error enviando WhatsApp masivo");
		},
	});

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>{children}</DialogTrigger>
			<DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<MessageCircle className="h-5 w-5" />
						Enviar WhatsApp masivo
					</DialogTitle>
					<DialogDescription>
						Se enviará la plantilla seleccionada a todos los créditos que
						coincidan con los filtros actuales. Los créditos sin teléfono,
						sin cuota o sin asesor se descartan automáticamente.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					<div className="space-y-2">
						<Label>Plantilla</Label>
						<Select value={plantillaId} onValueChange={setPlantillaId}>
							<SelectTrigger>
								<SelectValue placeholder="Seleccionar plantilla" />
							</SelectTrigger>
							<SelectContent>
								{PLANTILLAS_MENSAJES.map((p) => (
									<SelectItem key={p.id} value={p.id}>
										{p.nombre}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					{plantillaSeleccionada && (
						<div className="space-y-2">
							<Label>Vista previa</Label>
							<Textarea
								readOnly
								className="min-h-[220px] text-sm"
								value={plantillaSeleccionada.cuerpo}
							/>
							<p className="text-muted-foreground text-xs">
								Las variables entre llaves se reemplazan por los datos reales
								de cada crédito. Si un dato no existe (p. ej. placa), queda
								vacío en el mensaje.
							</p>
						</div>
					)}

					<div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
						<p className="font-medium">Filtros aplicados</p>
						<ul className="mt-1 list-inside list-disc text-muted-foreground text-xs">
							<li>Estado de mora: {filtros.estadoMora ?? "todos"}</li>
							<li>Rango temporal: {filtros.time ?? "todos"}</li>
							<li>Búsqueda: {filtros.searchTerm ?? "—"}</li>
						</ul>
					</div>
				</div>

				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => setOpen(false)}
						disabled={sendMutation.isPending}
					>
						Cancelar
					</Button>
					<Button
						onClick={() => sendMutation.mutate()}
						disabled={sendMutation.isPending || !plantillaId}
						className="flex items-center gap-2"
					>
						<Send className="h-4 w-4" />
						{sendMutation.isPending ? "Enviando..." : "Enviar a todos"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
