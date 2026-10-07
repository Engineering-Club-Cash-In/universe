import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { type Bucket, BucketBadge } from "@/components/ds/badges";
import { CrmPill } from "@/components/ds/cards-credito";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { client, orpc } from "@/utils/orpc";
import { BUCKETS_FILTRO } from "./carga-resumen-vista";
import {
	CeldaFecha,
	EstadoTabla,
	MarcoHistorial,
	PieHistorial,
} from "./marco-historial";

/**
 * «Reasignaciones» del historial de «Mi equipo» › Carga y asignación (antes en
 * `/cobros/reasignaciones`), completo: filtros Origen (Manual/Automático),
 * Bucket, Asesor nuevo y No. SIFCO con «Buscar»; totales Total/Manuales/
 * Automáticos; tabla paginada de 20 en 20 (Fecha, Crédito/cliente con enlace,
 * Cambio de asesor, Bucket, Origen, Motivo, Usuario) y el vacío.
 */

export type FilaReasignacion = {
	historial_id: number;
	fecha: string;
	numero_credito_sifco: string;
	cliente: string;
	asesor_anterior: string | null;
	asesor_nuevo: string | null;
	bucket: number | null;
	bucket_prefijo: string | null;
	bucket_nombre: string | null;
	origen: string;
	motivo: string | null;
	usuario: string | null;
};

function aBucket(numero: number | null): Bucket | null {
	return numero !== null && numero >= 0 && numero <= 5
		? (`B${numero}` as Bucket)
		: null;
}

/** Tabla de reasignaciones (presentación pura). */
export function TablaReasignaciones({
	filas,
	cargando,
	error,
	onReintentar,
}: {
	filas: FilaReasignacion[];
	cargando: boolean;
	error: boolean;
	onReintentar?: () => void;
}) {
	if (cargando) return <EstadoTabla estado="cargando" />;
	if (error) {
		return (
			<EstadoTabla estado="error" onReintentar={onReintentar}>
				Error al cargar el historial de reasignaciones
			</EstadoTabla>
		);
	}
	if (filas.length === 0) {
		return (
			<EstadoTabla estado="vacio">
				No hay reasignaciones para los filtros seleccionados
			</EstadoTabla>
		);
	}
	return (
		<Table>
			<TableHeader>
				<TableRow className="hover:bg-transparent">
					<TableHead>Fecha</TableHead>
					<TableHead>Crédito / cliente</TableHead>
					<TableHead>Cambio de asesor</TableHead>
					<TableHead>Bucket</TableHead>
					<TableHead>Origen</TableHead>
					<TableHead>Motivo</TableHead>
					<TableHead>Usuario</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{filas.map((r) => {
					const b = aBucket(r.bucket);
					const manual = r.origen === "API_MANUAL";
					return (
						<TableRow key={r.historial_id}>
							<TableCell>
								<CeldaFecha valor={r.fecha} />
							</TableCell>
							<TableCell className="max-w-48">
								<Link
									to="/cobros/$id"
									params={{ id: r.numero_credito_sifco }}
									search={{ tipo: "caso" }}
									className="flex flex-col gap-0.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
								>
									<span className="font-semibold text-[13px] text-brand leading-[1.26] hover:underline">
										{r.numero_credito_sifco}
									</span>
									<span className="truncate text-[11px] text-fg-tertiary leading-[1.26]">
										{r.cliente}
									</span>
								</Link>
							</TableCell>
							<TableCell>
								<span className="inline-flex items-center gap-1.5 text-[13px] leading-[1.26]">
									<span className="text-fg-secondary">
										{r.asesor_anterior ?? "Sin asesor"}
									</span>
									<ArrowRight
										aria-label="pasa a"
										className="size-3 shrink-0 text-fg-tertiary"
									/>
									<span className="font-semibold text-fg">
										{r.asesor_nuevo ?? "—"}
									</span>
								</span>
							</TableCell>
							<TableCell>
								{b ? (
									<BucketBadge
										bucket={b}
										title={
											r.bucket_nombre
												? `${r.bucket_prefijo ?? b} · ${r.bucket_nombre}`
												: undefined
										}
									/>
								) : (
									<span className="text-fg-tertiary">—</span>
								)}
							</TableCell>
							<TableCell>
								<CrmPill
									tone={manual ? "warning" : "neutral"}
									kind="chip"
									className="px-2.5 py-0.5"
								>
									{manual ? "Manual" : "Automático"}
								</CrmPill>
							</TableCell>
							<TableCell
								className="max-w-44 truncate text-fg-secondary"
								title={r.motivo ?? undefined}
							>
								{r.motivo || "—"}
							</TableCell>
							<TableCell
								className="max-w-32 truncate text-[11px] text-fg-tertiary"
								title={r.usuario || "sistema"}
							>
								{r.usuario || "sistema"}
							</TableCell>
						</TableRow>
					);
				})}
			</TableBody>
		</Table>
	);
}

export type HistorialReasignacionesVistaProps = {
	origen: string;
	onOrigen: (origen: string) => void;
	bucket: string;
	onBucket: (bucket: string) => void;
	asesor: string;
	onAsesor: (asesor: string) => void;
	asesores: { asesorId: number; nombre: string }[];
	errorAsesores: boolean;
	sifco: string;
	onSifco: (sifco: string) => void;
	onBuscar: () => void;
	resumen: { total: number; manuales: number; automaticos: number } | null;
	filas: FilaReasignacion[];
	cargando: boolean;
	error: boolean;
	onReintentar?: () => void;
	pagina: number;
	totalPaginas: number;
	onPagina: (pagina: number) => void;
};

/** Sección «Reasignaciones»: filtros, totales, tabla y paginación. */
export function HistorialReasignacionesVista(
	p: HistorialReasignacionesVistaProps,
) {
	return (
		<MarcoHistorial
			filtros={
				<>
					<Select value={p.origen} onValueChange={p.onOrigen}>
						<SelectTrigger
							size="sm"
							aria-label="Origen"
							className="w-full sm:w-44"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="todos">Todos los orígenes</SelectItem>
							<SelectItem value="API_MANUAL">Manual</SelectItem>
							<SelectItem value="PROCESO_AUTO">Automático</SelectItem>
						</SelectContent>
					</Select>
					<Select value={p.bucket} onValueChange={p.onBucket}>
						<SelectTrigger
							size="sm"
							aria-label="Bucket"
							className="w-full sm:w-48"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="todos">Todos los buckets</SelectItem>
							{BUCKETS_FILTRO.map((b) => (
								<SelectItem key={b.numero} value={String(b.numero)}>
									{b.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Select value={p.asesor} onValueChange={p.onAsesor}>
						<SelectTrigger
							size="sm"
							aria-label="Asesor nuevo"
							className="w-full sm:w-48"
						>
							<SelectValue placeholder="Todos los asesores" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="todos">Todos los asesores</SelectItem>
							{p.asesores.map((a) => (
								<SelectItem key={a.asesorId} value={String(a.asesorId)}>
									{a.nombre}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<form
						className="flex w-full min-w-0 items-center gap-2 sm:w-auto"
						onSubmit={(e) => {
							e.preventDefault();
							p.onBuscar();
						}}
					>
						<SearchInput
							aria-label="No. SIFCO"
							placeholder="No. SIFCO"
							value={p.sifco}
							onChange={(e) => p.onSifco(e.target.value)}
							containerClassName="h-8 min-w-0 flex-1 px-3 sm:w-44 sm:flex-none"
							className="text-[13px] md:text-[13px]"
						/>
						<Button type="submit" variant="outline" size="sm">
							Buscar
						</Button>
					</form>
					{p.errorAsesores ? (
						<p className="w-full text-danger-text text-xs">
							No se pudo cargar la lista de asesores; el filtro no está
							disponible.
						</p>
					) : null}
				</>
			}
			resumen={
				p.resumen ? (
					<>
						<CrmPill tone="brand" kind="chip" dot={false} className="px-2.5">
							Total {p.resumen.total.toLocaleString("es-GT")}
						</CrmPill>
						<CrmPill tone="warning" kind="chip" className="px-2.5">
							Manuales {p.resumen.manuales.toLocaleString("es-GT")}
						</CrmPill>
						<CrmPill tone="neutral" kind="chip" className="px-2.5">
							Automáticos {p.resumen.automaticos.toLocaleString("es-GT")}
						</CrmPill>
					</>
				) : null
			}
			pie={
				<PieHistorial
					page={p.pagina}
					pageCount={p.totalPaginas}
					onPageChange={p.onPagina}
					summary={`Página ${p.pagina} de ${Math.max(p.totalPaginas, 1)}`}
				/>
			}
		>
			<TablaReasignaciones
				filas={p.filas}
				cargando={p.cargando}
				error={p.error}
				onReintentar={p.onReintentar}
			/>
		</MarcoHistorial>
	);
}

export function HistorialReasignaciones() {
	const [origen, setOrigen] = useState<string>("todos");
	const [bucket, setBucket] = useState<string>("todos");
	const [asesor, setAsesor] = useState<string>("todos");
	const [sifcoInput, setSifcoInput] = useState("");
	const [sifco, setSifco] = useState("");
	const [page, setPage] = useState(1);
	const pageSize = 20;

	// El endpoint /advisor de cartera-back ignora page/perPage y siempre
	// retorna todos los asesores; la metadata de paginación de getAsesores
	// es inferida (no real), así que no hay que paginar acá — una sola
	// llamada ya trae la lista completa.
	const asesoresQuery = useQuery({
		queryKey: ["cobros", "asesores-todos"],
		queryFn: async () => {
			const respuesta = await client.getAsesores({});
			return respuesta.asesores;
		},
	});
	const asesores = asesoresQuery.data ?? [];

	const query = useQuery(
		orpc.getHistorialReasignaciones.queryOptions({
			input: {
				origen:
					origen === "todos"
						? undefined
						: (origen as "PROCESO_AUTO" | "API_MANUAL"),
				bucket: bucket === "todos" ? undefined : Number(bucket),
				asesorId: asesor === "todos" ? undefined : Number(asesor),
				numeroCredito: sifco || undefined,
				page,
				pageSize,
			},
		}),
	);

	// El backend ya excluye la siembra inicial de COBROS-02 (review Codex:
	// filtrar client-side después de paginar desalineaba "Página X de Y" y el
	// resumen, que contaban filas ya excluidas visualmente, con lo mostrado).
	const rows = (query.data?.data ?? []) as FilaReasignacion[];
	const totalPages = query.data?.pagination?.totalPages ?? 1;

	return (
		<HistorialReasignacionesVista
			origen={origen}
			onOrigen={(v) => {
				setOrigen(v);
				setPage(1);
			}}
			bucket={bucket}
			onBucket={(v) => {
				setBucket(v);
				setPage(1);
			}}
			asesor={asesor}
			onAsesor={(v) => {
				setAsesor(v);
				setPage(1);
			}}
			asesores={asesores.map((a) => ({
				asesorId: a.asesorId,
				nombre: a.nombre,
			}))}
			errorAsesores={asesoresQuery.isError}
			sifco={sifcoInput}
			onSifco={setSifcoInput}
			onBuscar={() => {
				setSifco(sifcoInput.trim());
				setPage(1);
			}}
			resumen={query.data?.resumen ?? null}
			filas={rows}
			cargando={query.isLoading}
			error={query.isError}
			onReintentar={() => void query.refetch()}
			pagina={page}
			totalPaginas={totalPages}
			onPagina={setPage}
		/>
	);
}
