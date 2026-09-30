import { useMutation } from "@tanstack/react-query";
import { FileCheck2, Loader2, Paperclip, X } from "lucide-react";
import { useRef, useState } from "react";
import {
	erroresEvidenciaEjecucion,
	MIME_EVIDENCIA_INMOVILIZACION,
} from "server/src/lib/inmovilizacion-unidad";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { uploadFileToR2WithRetry } from "@/lib/upload-to-r2";
import { orpc } from "@/utils/orpc";
import {
	UbicacionGpsBloque,
	useUbicacionInmovilizacion,
} from "./inmovilizacion-ubicacion";

const MAX_ARCHIVO_BYTES = 10 * 1024 * 1024;
const LIMITE_SUBIDA_MS = 60_000;

type Archivo = {
	nombre: string;
	estado: "subiendo" | "lista" | "error";
	key?: string;
	error?: string;
};

/**
 * CB-041 — El asesor declara que LEGION ya apagó la unidad aprobada. Adjunta su
 * confirmación (archivo y/o nota) y se vuelve a consultar dónde está el
 * vehículo. Todo queda auditado en el server con quién lo registró.
 *
 * Al terminar, `onEjecutada` abre el registro de la llamada al cliente: es lo
 * que sigue siempre después de un apagado.
 */
export function EjecutarApagadoModal({
	inmovilizacionId,
	casoCobroId,
	open,
	onOpenChange,
	onEjecutada,
}: {
	inmovilizacionId: string;
	casoCobroId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onEjecutada: (inmovilizacionId: string) => void;
}) {
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
				<Formulario
					casoCobroId={casoCobroId}
					inmovilizacionId={inmovilizacionId}
					onCerrar={() => onOpenChange(false)}
					onEjecutada={onEjecutada}
				/>
			</DialogContent>
		</Dialog>
	);
}

function Formulario({
	inmovilizacionId,
	casoCobroId,
	onCerrar,
	onEjecutada,
}: {
	inmovilizacionId: string;
	casoCobroId: string;
	onCerrar: () => void;
	onEjecutada: (inmovilizacionId: string) => void;
}) {
	const [nota, setNota] = useState("");
	const [archivo, setArchivo] = useState<Archivo | null>(null);
	// Una subida vieja que contesta tarde no pisa al archivo que se eligió después.
	const intentoRef = useRef(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const gps = useUbicacionInmovilizacion(casoCobroId, "ejecucion");

	const ejecutar = useMutation({
		...orpc.ejecutarApagado.mutationOptions(),
		onSuccess: (data) => {
			toast.success(
				"Apagado registrado. Ahora registrá la llamada al cliente.",
			);
			// Registrado igual, pero con algo que saber (p. ej. el crédito ya bajó
			// de bucket porque el cliente pagó: hay que solicitar la reactivación).
			if (data.advertencia) {
				toast.warning(data.advertencia, { duration: 15000 });
			}
			onCerrar();
			onEjecutada(inmovilizacionId);
		},
		onError: (error) => {
			toast.error(error.message || "No se pudo registrar el apagado.", {
				duration: 8000,
			});
		},
	});

	const elegirArchivo = async (file: File | undefined) => {
		if (!file) return;
		if (
			!(MIME_EVIDENCIA_INMOVILIZACION as readonly string[]).includes(file.type)
		) {
			toast.error("El archivo tiene que ser JPG, PNG, WebP o PDF.");
			return;
		}
		if (file.size > MAX_ARCHIVO_BYTES) {
			toast.error("El archivo pesa más de 10 MB.");
			return;
		}
		const intento = ++intentoRef.current;
		setArchivo({ nombre: file.name, estado: "subiendo" });
		try {
			const { key } = await uploadFileToR2WithRetry(
				file,
				{
					resourceType: "cobros_inmovilizacion_evidencia",
					resourceId: casoCobroId,
				},
				{ timeoutMs: LIMITE_SUBIDA_MS },
			);
			if (intento !== intentoRef.current) return;
			setArchivo({ nombre: file.name, estado: "lista", key });
		} catch (e) {
			if (intento !== intentoRef.current) return;
			setArchivo({
				nombre: file.name,
				estado: "error",
				error: e instanceof Error ? e.message : "No se pudo subir el archivo",
			});
		}
	};

	const quitarArchivo = () => {
		intentoRef.current++;
		setArchivo(null);
		if (inputRef.current) inputRef.current.value = "";
	};

	const evidencia =
		archivo?.estado === "lista" && archivo.key
			? { key: archivo.key, nombreArchivo: archivo.nombre }
			: undefined;
	// Mismas reglas que el server: el botón se habilita con lo que va a aceptar.
	const error =
		archivo?.estado === "subiendo"
			? "Esperá a que termine de subir el archivo."
			: erroresEvidenciaEjecucion({ evidencia, nota });

	return (
		<>
			<DialogHeader>
				<DialogTitle>Registrar apagado ejecutado</DialogTitle>
				<DialogDescription>
					Confirmá que LEGION ya apagó la unidad. Adjuntá su confirmación: queda
					registrado que la subiste vos, con la fecha y la ubicación.
				</DialogDescription>
			</DialogHeader>

			<div className="space-y-5">
				<section className="space-y-2">
					<Label>
						Confirmación de LEGION <span className="text-red-600">*</span>
					</Label>
					<input
						accept={MIME_EVIDENCIA_INMOVILIZACION.join(",")}
						className="hidden"
						onChange={(e) => elegirArchivo(e.target.files?.[0])}
						ref={inputRef}
						type="file"
					/>
					{archivo ? (
						<div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
							<span className="flex min-w-0 items-center gap-2">
								{archivo.estado === "subiendo" && (
									<Loader2 className="h-4 w-4 shrink-0 animate-spin" />
								)}
								{archivo.estado === "lista" && (
									<FileCheck2 className="h-4 w-4 shrink-0 text-emerald-600" />
								)}
								{archivo.estado === "error" && (
									<X className="h-4 w-4 shrink-0 text-destructive" />
								)}
								<span className="truncate">{archivo.nombre}</span>
							</span>
							<span className="flex shrink-0 items-center gap-2">
								{archivo.estado === "error" && (
									<span className="text-destructive text-xs">
										{archivo.error}
									</span>
								)}
								<button
									className="text-primary text-xs hover:underline"
									onClick={quitarArchivo}
									type="button"
								>
									Quitar
								</button>
							</span>
						</div>
					) : (
						<Button
							onClick={() => inputRef.current?.click()}
							size="sm"
							type="button"
							variant="outline"
						>
							<Paperclip className="mr-1.5 h-3.5 w-3.5" />
							Adjuntar archivo (captura, foto o PDF)
						</Button>
					)}
					<Label className="pt-1 font-normal text-sm" htmlFor="nota-apagado">
						Nota{" "}
						<span className="text-muted-foreground">
							(opcional si adjuntás un archivo)
						</span>
					</Label>
					<Textarea
						id="nota-apagado"
						maxLength={1000}
						onChange={(e) => setNota(e.target.value)}
						placeholder="Ej: LEGION confirmó por WhatsApp a las 10:32 que la unidad quedó apagada"
						rows={3}
						value={nota}
					/>
				</section>

				<UbicacionGpsBloque
					cargando={gps.cargando}
					errorRed={gps.errorRed}
					onActualizar={gps.actualizar}
					resultado={gps.resultado}
					titulo="Dónde está el vehículo ahora"
				/>
			</div>

			<DialogFooter className="items-center sm:justify-between">
				<p className="text-muted-foreground text-xs">
					{error ?? "Listo para registrar."}
				</p>
				<div className="flex gap-2">
					<Button onClick={onCerrar} variant="outline">
						Cancelar
					</Button>
					<Button
						disabled={!!error || gps.cargando || ejecutar.isPending}
						onClick={() =>
							ejecutar.mutate({
								id: inmovilizacionId,
								evidencia,
								nota: nota.trim() || undefined,
								consultaLogId: gps.resultado?.consultaLogId ?? undefined,
							})
						}
					>
						{ejecutar.isPending && (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						)}
						Registrar apagado
					</Button>
				</div>
			</DialogFooter>
		</>
	);
}
