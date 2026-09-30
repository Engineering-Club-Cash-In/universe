import { FileText } from "lucide-react";
import { useCallback, useState } from "react";
import { FacturaSeguro } from "@/components/factura-seguro";
import { Ventana } from "@/components/ventana";
import {
	documentosDelCaso,
	resumenDocumentos,
	type TonoResumen,
} from "@/lib/documentos";
import type { Caso } from "@/lib/pasos";
import { cn } from "@/lib/utils";

const ESTILO_RESUMEN: Record<TonoResumen, { clase: string; punto: string }> = {
	ok: {
		clase: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
		punto: "bg-emerald-500",
	},
	pendiente: {
		clase: "bg-amber-50 text-amber-700 ring-amber-600/20",
		punto: "bg-amber-500",
	},
	atencion: {
		clase: "bg-amber-50 text-amber-700 ring-amber-600/20",
		punto: "bg-amber-500",
	},
};

function EstadoResumen({ tono, texto }: { tono: TonoResumen; texto: string }) {
	const estilo = ESTILO_RESUMEN[tono];
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium text-xs ring-1 ring-inset",
				estilo.clase,
			)}
		>
			<span className={cn("h-1.5 w-1.5 rounded-full", estilo.punto)} />
			{texto}
		</span>
	);
}

export function DocumentosCaso({ caso }: { caso: Caso }) {
	const [abierta, setAbierta] = useState(false);
	const cerrar = useCallback(() => setAbierta(false), []);
	const documentos = documentosDelCaso(caso);
	const resumen = resumenDocumentos(documentos);
	if (!resumen) return null;

	return (
		<section className="rounded-xl border border-slate-200 bg-white p-5">
			<div className="flex items-center justify-between gap-3">
				<div className="flex min-w-0 flex-wrap items-center gap-2">
					<FileText className="h-5 w-5 shrink-0 text-slate-400" />
					<h2 className="font-semibold text-slate-900">Documentos</h2>
					<EstadoResumen {...resumen} />
				</div>
				<button
					type="button"
					onClick={() => setAbierta(true)}
					className="shrink-0 rounded-lg border border-slate-300 px-4 py-1.5 font-medium text-slate-700 text-sm transition hover:bg-slate-50"
				>
					Ver
				</button>
			</div>

			<Ventana
				abierta={abierta}
				onCerrar={cerrar}
				titulo="Documentos"
				subtitulo={`${caso.vehiculo ?? caso.cliente} · ${caso.referencia}`}
			>
				<div className="mb-4">
					<EstadoResumen {...resumen} />
				</div>
				<ul className="space-y-3">
					{documentos.map((documento) => (
						<li
							key={documento.clave}
							className="rounded-xl border border-slate-200 px-4 py-3"
						>
							{documento.clave === "factura_seguro" && (
								<FacturaSeguro caso={caso} />
							)}
						</li>
					))}
				</ul>
			</Ventana>
		</section>
	);
}
