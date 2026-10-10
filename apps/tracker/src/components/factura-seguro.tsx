import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangle,
	CheckCircle2,
	Eye,
	FileUp,
	Info,
	Loader2,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
	errorDeArchivoFactura,
	EXTENSIONES_FACTURA,
	MIME_FACTURA,
	type TonoFactura,
	vistaFacturaSeguro,
} from "@/lib/factura-seguro";
import type { Caso } from "@/lib/pasos";
import { cn } from "@/lib/utils";
import { client, orpc } from "@/utils/orpc";

const ESTILO: Record<TonoFactura, { caja: string; icono: typeof Info }> = {
	accion: { caja: "border-blue-200 bg-blue-50 text-blue-900", icono: FileUp },
	ok: {
		caja: "border-emerald-200 bg-emerald-50 text-emerald-900",
		icono: CheckCircle2,
	},
	info: { caja: "border-slate-200 bg-slate-50 text-slate-800", icono: Info },
};

type Envio = Awaited<ReturnType<typeof client.subirFacturaSeguro>>["envio"];

function avisarResultado(envio: Envio) {
	if (envio === "enviado") {
		toast.success("Factura enviada");
	} else {
		toast.info("Factura recibida");
	}
}

export function FacturaSeguro({ caso }: { caso: Caso }) {
	const queryClient = useQueryClient();
	const entrada = useRef<HTMLInputElement>(null);
	const [archivo, setArchivo] = useState<File | null>(null);
	const [abriendo, setAbriendo] = useState(false);

	const refrescar = () => {
		queryClient.invalidateQueries({ queryKey: orpc.getCasoById.key() });
		queryClient.invalidateQueries({ queryKey: orpc.getCasos.key() });
	};

	const subir = useMutation({
		// El archivo va al server del CRM (no directo a R2): el CORS del bucket
		// no admite subidas desde el tracker.
		mutationFn: (file: File) =>
			client.subirFacturaSeguro({ opportunityId: caso.id, archivo: file }),
		onSuccess: ({ envio }) => {
			setArchivo(null);
			avisarResultado(envio);
			refrescar();
		},
		onError: (error) => {
			toast.error(error.message || "No se pudo subir la factura");
			refrescar();
		},
	});

	const vista = vistaFacturaSeguro(caso);
	if (!vista) return null;

	const { caja, icono: Icono } = ESTILO[vista.tono];
	const ocupado = subir.isPending;

	const verFactura = async () => {
		// La pestaña se abre antes de pedir el link: abierta después de esperar
		// la respuesta, el navegador la bloquea como ventana emergente.
		const pestana = window.open("", "_blank");
		if (pestana) pestana.opener = null;
		setAbriendo(true);
		try {
			const { url } = await client.verFacturaSeguro({ opportunityId: caso.id });
			if (pestana) pestana.location.href = url;
			else window.location.href = url;
		} catch (error) {
			pestana?.close();
			toast.error(
				(error instanceof Error && error.message) ||
					"No se pudo abrir la factura",
			);
		} finally {
			setAbriendo(false);
		}
	};

	const elegirArchivo = (file: File | undefined) => {
		if (entrada.current) entrada.current.value = "";
		if (!file) return;
		const error = errorDeArchivoFactura(file);
		if (error) {
			// Sin esto quedaría lista para subir la factura elegida antes.
			setArchivo(null);
			toast.error(error);
			return;
		}
		setArchivo(file);
	};

	return (
		<div>
			<div className="flex items-center gap-4">
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
						<h3 className="font-medium text-slate-900 text-sm">
							Factura del seguro
						</h3>
						<div
							className={cn(
								"inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-0.5",
								caja,
							)}
						>
							<Icono
								className={cn(
									"h-3.5 w-3.5 shrink-0",
								)}
							/>
							<p className="font-medium text-xs">{vista.titulo}</p>
						</div>
					</div>
					<p className="mt-1 text-slate-600 text-sm">{vista.texto}</p>
				</div>
				{caso.facturaSeguro.envio !== null && (
					<button
						type="button"
						disabled={abriendo}
						onClick={verFactura}
						className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 text-sm transition hover:bg-slate-50 disabled:opacity-60"
					>
						{abriendo ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<Eye className="h-4 w-4" />
						)}
						Ver
					</button>
				)}
			</div>

			{vista.accion === "subir" && (
				<div className="mt-4">
					<input
						ref={entrada}
						id={`factura-${caso.id}`}
						type="file"
						accept={[...MIME_FACTURA, ...EXTENSIONES_FACTURA].join(",")}
						className="sr-only"
						disabled={ocupado}
						onChange={(e) => elegirArchivo(e.target.files?.[0])}
					/>
					{!archivo ? (
						<label
							htmlFor={`factura-${caso.id}`}
							className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 font-medium text-sm text-white transition hover:bg-slate-800"
						>
							<FileUp className="h-4 w-4" />
							Elegir factura (PDF o imagen)
						</label>
					) : (
						<div className="space-y-3 rounded-lg border border-slate-200 p-3">
							<p className="truncate text-slate-700 text-sm">
								<span className="text-slate-500">Archivo: </span>
								{archivo.name}
							</p>
							<p className="flex items-start gap-2 text-amber-800 text-xs">
								<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
								Una vez subida no se puede reemplazar. Revisa
								que sea la factura correcta.
							</p>
							<div className="flex flex-wrap gap-2">
								<button
									type="button"
									disabled={ocupado}
									onClick={() => subir.mutate(archivo)}
									className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 font-medium text-sm text-white transition hover:bg-slate-800 disabled:opacity-60"
								>
									{subir.isPending ? (
										<Loader2 className="h-4 w-4 animate-spin" />
									) : (
										<FileUp className="h-4 w-4" />
									)}
									{subir.isPending ? "Subiendo..." : "Subir factura"}
								</button>
								<button
									type="button"
									disabled={ocupado}
									onClick={() => setArchivo(null)}
									className="rounded-lg px-4 py-2 font-medium text-slate-600 text-sm transition hover:bg-slate-100 disabled:opacity-60"
								>
									Cancelar
								</button>
							</div>
						</div>
					)}
				</div>
			)}

		</div>
	);
}
