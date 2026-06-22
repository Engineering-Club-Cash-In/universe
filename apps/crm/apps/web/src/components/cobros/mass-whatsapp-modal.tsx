import { useMutation } from "@tanstack/react-query";
import { MessageCircle, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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

const VARIABLES_DISPONIBLES = [
	"clienteNombre",
	"fechaPago",
	"cuotaMensual",
	"placa",
	"marcaLineaModelo",
	"montoAdeudado",
	"cuotasAtraso",
	"telefonoAsesor",
	"nombreAsesor",
] as const;

interface DescartadoItem {
	numeroSifco: string | null;
	clienteNombre: string | null;
	motivo: string;
}

function formatRangoTemporal(filtros: {
	fechaDesde?: string;
	fechaHasta?: string;
	time?: "WEEK" | "MONTH" | "DUEMONTH" | "TODAY";
}): string {
	if (filtros.fechaDesde || filtros.fechaHasta) {
		return `${filtros.fechaDesde ?? "—"} a ${filtros.fechaHasta ?? "—"}`;
	}
	if (filtros.time) return TIME_LABELS[filtros.time] ?? filtros.time;
	return "Todos";
}

function descartadosToCsv(items: DescartadoItem[]): string {
	const escape = (val: string) => {
		// Convención CSV: envolver en comillas si tiene coma, comilla o salto;
		// duplicar comillas internas para escapar.
		if (/["\n,]/.test(val)) return `"${val.replaceAll('"', '""')}"`;
		return val;
	};
	const header = "numeroSifco,clienteNombre,motivo";
	const filas = items.map((d) =>
		[
			escape(d.numeroSifco ?? ""),
			escape(d.clienteNombre ?? ""),
			escape(d.motivo),
		].join(","),
	);
	return [header, ...filas].join("\n");
}

function descargarCsv(items: DescartadoItem[]) {
	const csv = descartadosToCsv(items);
	const blob = new Blob([`﻿${csv}`], {
		type: "text/csv;charset=utf-8;",
	});
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = `descartados-masivo-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.csv`;
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}

interface MassWhatsappModalProps {
	filtros: {
		estadoMora?: string;
		searchTerm?: string;
		numeroSifco?: string;
		time?: "WEEK" | "MONTH" | "DUEMONTH" | "TODAY";
		etiquetas?: string[];
		fechaDesde?: string;
		fechaHasta?: string;
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
	const [cuerpoEditado, setCuerpoEditado] = useState<string>("");
	const [descartadosResult, setDescartadosResult] = useState<
		DescartadoItem[] | null
	>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const insertarVariable = (variable: string) => {
		const token = `{${variable}}`;
		const textarea = textareaRef.current;
		// Sin foco/ref no podemos saber dónde está el cursor: caemos al append.
		if (!textarea) {
			setCuerpoEditado((prev) => `${prev}${token}`);
			return;
		}
		const start = textarea.selectionStart ?? cuerpoEditado.length;
		const end = textarea.selectionEnd ?? cuerpoEditado.length;
		const nuevoTexto =
			cuerpoEditado.slice(0, start) + token + cuerpoEditado.slice(end);
		setCuerpoEditado(nuevoTexto);
		// React aplica el value en el siguiente tick — esperamos para reposicionar
		// el caret justo después del token insertado y devolver foco al textarea.
		requestAnimationFrame(() => {
			textarea.focus();
			const cursorPos = start + token.length;
			textarea.setSelectionRange(cursorPos, cursorPos);
		});
	};

	const plantillaSeleccionada = PLANTILLAS_MENSAJES.find(
		(p) => p.id === plantillaId,
	);

	// Pre-poblar el textarea con el cuerpoWhastapp (versión corta aprobada en
	// Meta) cuando cambia la plantilla. Si no existe, caemos al cuerpo largo.
	useEffect(() => {
		if (!plantillaSeleccionada) {
			setCuerpoEditado("");
			return;
		}
		setCuerpoEditado(
			plantillaSeleccionada.cuerpoWhastapp || plantillaSeleccionada.cuerpo,
		);
	}, [plantillaSeleccionada]);

	const sendMutation = useMutation({
		mutationFn: () =>
			client.enviarWhatsappMasivoCobros({
				plantillaId,
				cuerpoEditado: cuerpoEditado || undefined,
				estadoMora: filtros.estadoMora,
				searchTerm: filtros.searchTerm,
				numeroSifco: filtros.numeroSifco,
				time: filtros.time,
				etiquetas:
					filtros.etiquetas && filtros.etiquetas.length > 0
						? filtros.etiquetas
						: undefined,
				fechaDesde: filtros.fechaDesde,
				fechaHasta: filtros.fechaHasta,
			}),
		onSuccess: (res) => {
			// `descartados` ya incluye los que fallaron en el proveedor, así que
			// no se listan los `fallidos` aparte para no contarlos dos veces.
			const partes = [
				`${res.enviados} enviados`,
				`${res.descartados.length} descartados`,
			];
			if (typeof res.contactosRegistrados === "number") {
				partes.push(`${res.contactosRegistrados} en historial`);
			}
			toast.success(`WhatsApp masivo: ${partes.join(", ")}`);
			setOpen(false);
			if (res.descartados.length > 0) {
				setDescartadosResult(res.descartados);
			}
		},
		onError: (error: any) => {
			toast.error(error?.message || "Error enviando WhatsApp masivo");
		},
	});

	return (
		<>
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
							coincidan con los filtros actuales. Los créditos sin teléfono, sin
							cuota o sin asesor se descartan automáticamente.
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
									<div className="flex items-center justify-between">
										<Label htmlFor="cuerpo-editado">Mensaje a enviar</Label>
										<button
											type="button"
											onClick={() =>
												setCuerpoEditado(
													plantillaSeleccionada.cuerpoWhastapp ||
														plantillaSeleccionada.cuerpo,
												)
											}
											className="text-muted-foreground text-xs underline-offset-2 hover:text-foreground hover:underline"
										>
											Restaurar plantilla original
										</button>
									</div>
									<Textarea
										ref={textareaRef}
										id="cuerpo-editado"
										className="min-h-55 text-sm"
										value={cuerpoEditado}
										onChange={(e) => setCuerpoEditado(e.target.value)}
									/>
									<p className="text-muted-foreground text-xs">
										Separá con <strong>una línea en blanco</strong> para crear
										un nuevo párrafo (= un parámetro del template). Mínimo 1,
										máximo 4. Las variables entre <code>{"{llaves}"}</code> se
										reemplazan por los datos reales de cada crédito; si una
										variable no existe o queda mal escrita, se manda literal.
									</p>
									<div className="flex flex-wrap gap-1">
										{VARIABLES_DISPONIBLES.map((v) => (
											<button
												key={v}
												type="button"
												onClick={() => insertarVariable(v)}
												className="cursor-pointer rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
												title={`Insertar {${v}} en la posición del cursor`}
											>
												{`{${v}}`}
											</button>
										))}
									</div>
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
											<li>Rango temporal: {formatRangoTemporal(filtros)}</li>
											<li>Búsqueda: {filtros.searchTerm ?? "—"}</li>
											<li>No. SIFCO: {filtros.numeroSifco ?? "—"}</li>
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

			<Dialog
				open={!!descartadosResult}
				onOpenChange={(o) => {
					if (!o) setDescartadosResult(null);
				}}
			>
				<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
					<DialogHeader>
						<DialogTitle>
							Descartados del envío masivo ({descartadosResult?.length ?? 0})
						</DialogTitle>
						<DialogDescription>
							Estos créditos no recibieron el mensaje: o les faltaba algún dato
							(teléfono, cuota o asesor asignado) o el envío falló en el
							proveedor. El motivo de cada uno se indica en la última columna.
							Podés exportarlos a CSV para hacer seguimiento manual.
						</DialogDescription>
					</DialogHeader>

					{descartadosResult && descartadosResult.length > 0 && (
						<div className="max-h-96 overflow-y-auto rounded-md border border-border">
							<table className="w-full text-sm">
								<thead className="sticky top-0 bg-muted/60 backdrop-blur">
									<tr className="border-b">
										<th className="px-3 py-2 text-left font-medium text-muted-foreground text-xs">
											No. SIFCO
										</th>
										<th className="px-3 py-2 text-left font-medium text-muted-foreground text-xs">
											Cliente
										</th>
										<th className="px-3 py-2 text-left font-medium text-muted-foreground text-xs">
											Motivo
										</th>
									</tr>
								</thead>
								<tbody>
									{descartadosResult.map((d, idx) => (
										<tr
											key={`${d.numeroSifco ?? "sin-sifco"}-${idx}`}
											className="border-b last:border-b-0"
										>
											<td className="px-3 py-2 font-mono text-muted-foreground text-xs">
												{d.numeroSifco ?? "—"}
											</td>
											<td className="px-3 py-2">{d.clienteNombre ?? "—"}</td>
											<td className="px-3 py-2">
												<span className="rounded bg-amber-100 px-2 py-0.5 text-amber-900 text-xs">
													{d.motivo}
												</span>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}

					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setDescartadosResult(null)}
						>
							Cerrar
						</Button>
						<Button
							onClick={() =>
								descartadosResult && descargarCsv(descartadosResult)
							}
							disabled={!descartadosResult || descartadosResult.length === 0}
						>
							Descargar CSV
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
