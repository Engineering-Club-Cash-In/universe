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
		etiquetas?: string[];
	};
	etiquetaLabels?: Record<string, string>;
	totalDestinatarios?: number;
	children: React.ReactNode;
}

const ESTADO_MORA_LABELS: Record<string, string> = {
	al_dia: "Al Día",
	mora_30: "Mora 30",
	mora_60: "Mora 60",
	mora_90: "Mora 90",
	mora_120: "Mora 120+",
	incobrable: "Incobrable",
	completado: "Completado",
};

const TIME_LABELS: Record<string, string> = {
	TODAY: "Hoy",
	WEEK: "Esta Semana",
	DUEMONTH: "Esta Quincena",
	MONTH: "Este Mes",
};

export function MassWhatsappModal({
	filtros,
	etiquetaLabels,
	totalDestinatarios,
	children,
}: MassWhatsappModalProps) {
	const [open, setOpen] = useState(false);
	const [plantillaId, setPlantillaId] = useState<string>("");

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
				etiquetas:
					filtros.etiquetas && filtros.etiquetas.length > 0
						? filtros.etiquetas
						: undefined,
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
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
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

					{plantillaSeleccionada ? (
						<>
							<div className="space-y-2">
								<Label>Vista previa</Label>
								<Textarea
									readOnly
									className="min-h-55 text-sm"
									value={plantillaSeleccionada.cuerpo}
								/>
								<p className="text-muted-foreground text-xs">
									Las variables entre llaves se reemplazan por los datos
									reales de cada crédito. Si un dato no existe (p. ej. placa),
									queda vacío en el mensaje.
								</p>
							</div>

							<div className="grid gap-3 md:grid-cols-2">
								<div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
									<p className="font-medium">Filtros aplicados</p>
									<ul className="mt-1 list-inside list-disc text-muted-foreground text-xs">
										<li>
											Estado de mora:{" "}
											{filtros.estadoMora
												? (ESTADO_MORA_LABELS[filtros.estadoMora] ??
													filtros.estadoMora)
												: "Todos"}
										</li>
										<li>
											Rango temporal:{" "}
											{filtros.time
												? (TIME_LABELS[filtros.time] ?? filtros.time)
												: "Todos"}
										</li>
										<li>Búsqueda: {filtros.searchTerm ?? "—"}</li>
										<li>
											Etiquetas:{" "}
											{filtros.etiquetas && filtros.etiquetas.length > 0
												? filtros.etiquetas
														.map((e) => etiquetaLabels?.[e] ?? e)
														.join(", ")
												: "Todas"}
										</li>
									</ul>
								</div>

								{typeof totalDestinatarios === "number" && (
									<div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
										<p className="font-medium">
											Se enviará a{" "}
											{totalDestinatarios.toLocaleString("es-GT")}{" "}
											{totalDestinatarios === 1 ? "crédito" : "créditos"}
										</p>
										<p className="mt-1 text-muted-foreground text-xs">
											Los créditos sin teléfono, sin cuota o sin asesor se
											descartan automáticamente, por lo que el número final
											puede ser menor.
										</p>
									</div>
								)}
							</div>
						</>
					) : (
						<div className="flex flex-col items-center justify-center gap-2 rounded-md border border-border border-dashed bg-muted/20 p-8 text-center">
							<MessageCircle className="h-8 w-8 text-muted-foreground" />
							<p className="font-medium text-sm">
								Selecciona una plantilla para continuar
							</p>
							<p className="text-muted-foreground text-xs">
								Una vez elegida verás la vista previa, los filtros aplicados y
								la cantidad de destinatarios.
							</p>
						</div>
					)}
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
