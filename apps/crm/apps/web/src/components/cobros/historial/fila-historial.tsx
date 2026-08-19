import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Loader2, Pencil } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import type { BucketsCatalogoQueryData } from "@/lib/cobros/buckets-catalogo";
import {
	bucketDeNumero,
	estiloBucket,
	labelBucketConCodigo,
} from "@/lib/cobros/buckets-catalogo";
import { etiquetaEnAgenda } from "@/lib/cobros/cumplimiento-agenda";
import { orpc } from "@/utils/orpc";
import {
	etiquetaEstado,
	etiquetaMetodo,
	etiquetaRol,
	fechaHora,
	METODOS_CONTACTO,
	ORIGEN_LABEL,
	soloFecha,
} from "./formato";
import type { EntradaAuditoria, FilaHistorialData } from "./tipos";

function IconoMetodo({ metodo }: { metodo: string | null }) {
	const def = METODOS_CONTACTO.find((m) => m.value === metodo);
	if (!def) return null;
	const Icono = def.icono;
	return <Icono className="h-3.5 w-3.5 shrink-0 text-gray-400" />;
}

/**
 * Encabezado de la tabla de historial. Único lugar donde se define el set de
 * columnas: tanto el tab "Historial de gestiones" como el bloque de gestiones
 * del asesor en "Cumplimiento de agenda" lo usan, así que no pueden
 * desincronizarse con `FilaHistorial`.
 *
 * `mostrarEnAgenda` no tiene caller todavía en este PR (solo mueve
 * `FilaHistorial`/`AuditoriaPopover` fuera de la ruta, sin cambiar
 * comportamiento) — lo activa un PR aparte que agrega el bloque "Gestiones
 * registradas por [asesor]" en Cumplimiento de agenda. Se deja resuelto acá
 * en vez de dividir `FilaHistorial` en dos versiones: es la misma tabla en
 * ambos casos, y la columna solo se decide a renderizar o no.
 */
export function EncabezadoHistorial({
	mostrarEnAgenda,
}: {
	mostrarEnAgenda?: boolean;
}) {
	return (
		<tr className="text-left text-gray-600 text-xs uppercase dark:text-gray-300">
			<th className="px-3 py-2 font-medium">Fecha</th>
			<th className="px-3 py-2 font-medium">Usuario</th>
			<th className="px-3 py-2 font-medium">Bucket</th>
			<th className="px-3 py-2 font-medium">Cuenta</th>
			{mostrarEnAgenda && <th className="px-3 py-2 font-medium">Agenda</th>}
			<th className="px-3 py-2 font-medium">Tipo</th>
			<th className="px-3 py-2 font-medium">Resultado</th>
			<th className="px-3 py-2 font-medium">Próxima acción</th>
			<th className="px-3 py-2 font-medium">Promesa</th>
			<th className="px-3 py-2 font-medium" />
		</tr>
	);
}

export function FilaHistorial({
	fila,
	catalogo,
	esSupervisor,
	mostrarEnAgenda,
}: {
	fila: FilaHistorialData;
	catalogo: BucketsCatalogoQueryData | undefined;
	esSupervisor: boolean;
	/**
	 * Renderiza la columna "Agenda" (En agenda / Fuera de agenda / —). Ver la
	 * nota en `EncabezadoHistorial`: sin caller en este PR a propósito.
	 */
	mostrarEnAgenda?: boolean;
}) {
	const bucket =
		fila.bucketSnapshot != null
			? bucketDeNumero(fila.bucketSnapshot, catalogo)
			: null;

	return (
		<tr className="border-t hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800/50">
			<td className="whitespace-nowrap px-3 py-2 text-gray-600 dark:text-gray-300">
				{fechaHora(fila.fechaContacto)}
				{/* AC-2: fecha de actualización. Se muestra solo si la fila cambió
				    alguna vez. Dice "Act." y no "Editado" a propósito — la tocan
				    también los recálculos de estado del sistema, y la marca de
				    edición humana es el ícono de la última columna. */}
				{fila.updatedAt && (
					<div
						className="text-gray-400 text-xs"
						title="Última actualización del registro (incluye recálculos automáticos de estado)"
					>
						Act. {fechaHora(fila.updatedAt)}
					</div>
				)}
			</td>
			<td className="px-3 py-2">
				<div className="font-medium">{fila.usuarioNombre ?? "—"}</div>
				<div className="text-gray-400 text-xs">
					{etiquetaRol(fila.usuarioRol)}
				</div>
			</td>
			<td className="px-3 py-2">
				{bucket ? (
					<Badge variant="outline" style={estiloBucket(bucket.colorHex)}>
						{labelBucketConCodigo(bucket)}
					</Badge>
				) : (
					<span
						className="text-gray-400"
						/* Mismo texto que el chip "Sin bucket" del panel de filtros: el
					   anterior nombraba una sola de las tres causas, y con el código
					   del ticket adentro, que al usuario no le dice nada. */
						title="Sin bucket registrado: gestión anterior a esta función, o crédito fuera del funnel (convenio, cancelado)"
					>
						—
					</span>
				)}
			</td>
			<td className="px-3 py-2">
				<Link
					to="/cobros/$id"
					params={{ id: fila.casoCobroId }}
					// contactos_cobros guarda el id del CASO, no el del crédito de
					// cartera-back — por eso tipo="caso".
					search={{ tipo: "caso" as const }}
					className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
				>
					{fila.numeroCreditoSifco ?? "Sin SIFCO"}
				</Link>
				<div className="max-w-[180px] truncate text-gray-400 text-xs">
					{fila.clienteNombre ?? "—"}
				</div>
			</td>
			{mostrarEnAgenda && (
				<td className="px-3 py-2">
					{fila.enAgenda == null ? (
						<span className="text-gray-400">—</span>
					) : (
						<Badge
							variant="outline"
							className={
								fila.enAgenda
									? "border-emerald-300 text-emerald-700 dark:text-emerald-400"
									: "border-gray-300 text-gray-500"
							}
						>
							{etiquetaEnAgenda(fila.enAgenda)}
						</Badge>
					)}
				</td>
			)}
			<td className="px-3 py-2">
				<div className="flex items-center gap-1.5">
					<IconoMetodo metodo={fila.metodoContacto} />
					<span>{etiquetaMetodo(fila.metodoContacto)}</span>
				</div>
				{fila.origen !== "manual" && (
					<span className="text-amber-600 text-xs dark:text-amber-400">
						{ORIGEN_LABEL[fila.origen] ?? fila.origen}
					</span>
				)}
			</td>
			<td className="px-3 py-2">{etiquetaEstado(fila.estadoContacto)}</td>
			<td className="px-3 py-2">
				<div>{soloFecha(fila.fechaProximoContacto)}</div>
				{fila.proximoPaso && (
					<div className="max-w-[200px] truncate text-gray-400 text-xs">
						{fila.proximoPaso}
					</div>
				)}
			</td>
			<td className="px-3 py-2">
				{fila.estadoPromesa ? (
					<div>
						<span className="capitalize">{fila.estadoPromesa}</span>
						{fila.cuotaInicio != null && fila.cuotaFin != null && (
							<div className="text-gray-400 text-xs">
								Cuotas {fila.cuotaInicio}–{fila.cuotaFin}
							</div>
						)}
					</div>
				) : (
					<span className="text-gray-400">—</span>
				)}
			</td>
			<td className="px-3 py-2">
				{/* AC-6: la marca sale del audit con origen='manual', NO de updated_at
				    — si no, toda promesa se vería "editada" cada vez que pasa el job. */}
				{fila.fueEditadoManual && (
					<AuditoriaPopover
						contactoId={fila.id}
						veces={fila.vecesEditado}
						habilitado={esSupervisor}
					/>
				)}
			</td>
		</tr>
	);
}

/**
 * AC-6 — qué se cambió, cuándo y quién. El detalle solo lo abre el supervisor
 * (el procedure está gateado); al asesor le queda el indicador visual.
 */
export function AuditoriaPopover({
	contactoId,
	veces,
	habilitado,
}: {
	contactoId: string;
	veces: number;
	habilitado: boolean;
}) {
	const [abierto, setAbierto] = useState(false);
	// TS7056 — el tipo del cliente oRPC está truncado en el router raíz.
	// biome-ignore lint/suspicious/noExplicitAny: contrato manual por TS7056.
	const orpcAny = orpc as any;
	const auditoriaQuery = useQuery({
		...orpcAny.getAuditoriaContacto.queryOptions({ input: { contactoId } }),
		// Solo se pide al abrir: son N popovers por página.
		enabled: abierto && habilitado,
	});
	const entradas = auditoriaQuery.data as EntradaAuditoria[] | undefined;

	const insignia = (
		<span
			className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-amber-700 text-xs dark:bg-amber-950/40 dark:text-amber-300"
			title={`Editado ${veces} ${veces === 1 ? "vez" : "veces"}`}
		>
			<Pencil className="h-3 w-3" />
			{veces}
		</span>
	);

	if (!habilitado) return insignia;

	return (
		<Popover open={abierto} onOpenChange={setAbierto}>
			<PopoverTrigger asChild>
				<button type="button">{insignia}</button>
			</PopoverTrigger>
			<PopoverContent className="w-96" align="end">
				<h4 className="mb-2 font-medium text-sm">Historial de cambios</h4>
				{auditoriaQuery.isPending && (
					<div className="flex items-center gap-2 py-3 text-gray-500 text-sm">
						<Loader2 className="h-4 w-4 animate-spin" />
						Cargando…
					</div>
				)}
				{entradas?.length === 0 && (
					<p className="py-2 text-gray-400 text-sm">Sin cambios registrados.</p>
				)}
				<div className="max-h-72 space-y-2 overflow-y-auto">
					{entradas?.map((entrada) => (
						<div
							key={entrada.id}
							className="rounded border p-2 text-xs dark:border-gray-700"
						>
							<div className="flex items-center justify-between gap-2">
								<span className="font-medium">
									{entrada.origen === "manual"
										? (entrada.editadoPorNombre ?? "Usuario")
										: "Sistema"}
								</span>
								<span className="text-gray-400">
									{fechaHora(entrada.editadoEn)}
								</span>
							</div>
							<pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-gray-500 dark:text-gray-400">
								{JSON.stringify(entrada.valoresAnteriores, null, 1)}
							</pre>
						</div>
					))}
				</div>
			</PopoverContent>
		</Popover>
	);
}
