import { ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
	CLASE_SEVERIDAD,
	type CoincidenciaBuroInterno,
	ETIQUETA_SEVERIDAD,
	etiquetaCategoria,
	formatearFecha,
	type Severidad,
} from "./buro-interno-labels";

export function SeveridadBadge({ severidad }: { severidad: Severidad }) {
	return (
		<Badge variant="outline" className={CLASE_SEVERIDAD[severidad]}>
			{ETIQUETA_SEVERIDAD[severidad]}
		</Badge>
	);
}

/** Lista de coincidencias: a quién de la solicitud se parece y por qué reglas */
export function CoincidenciasBuroInterno({
	coincidencias,
	mostrarOrigen = true,
}: {
	coincidencias: CoincidenciaBuroInterno[];
	mostrarOrigen?: boolean;
}) {
	return (
		<ul className="space-y-3">
			{coincidencias.map((coincidencia) => (
				<li
					key={`${coincidencia.etiqueta}-${coincidencia.registroId}`}
					className="rounded-lg border bg-card p-4"
				>
					<div className="flex flex-wrap items-start justify-between gap-2">
						<div className="flex items-start gap-2">
							<ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
							<div>
								<p className="font-medium">
									{coincidencia.registro.nombreCompleto}
								</p>
								<p className="text-muted-foreground text-xs">
									{etiquetaCategoria(coincidencia.registro.categoria)}
									{coincidencia.registro.dpi &&
										` · DPI ${coincidencia.registro.dpi}`}
									{coincidencia.registro.numeroCreditoSifco &&
										` · SIFCO ${coincidencia.registro.numeroCreditoSifco}`}
								</p>
							</div>
						</div>
						<div className="flex items-center gap-2">
							{mostrarOrigen && (
								<Badge variant="secondary">{coincidencia.etiqueta}</Badge>
							)}
							<SeveridadBadge severidad={coincidencia.severidad} />
						</div>
					</div>

					<ul className="mt-3 space-y-1 text-sm">
						{coincidencia.reglas.map((regla) => (
							<li key={regla.clave} className="flex flex-wrap gap-x-2">
								<span className="font-medium">{regla.nombre}:</span>
								<span className="text-muted-foreground">{regla.detalle}</span>
							</li>
						))}
					</ul>

					<p className="mt-3 border-t pt-2 text-sm">
						<span className="font-medium">Motivo: </span>
						{coincidencia.registro.motivo}
					</p>
					<p className="mt-1 text-muted-foreground text-xs">
						Registrado por {coincidencia.registro.creadoPorNombre ?? "—"} el{" "}
						{formatearFecha(coincidencia.registro.createdAt)}
					</p>
				</li>
			))}
		</ul>
	);
}
