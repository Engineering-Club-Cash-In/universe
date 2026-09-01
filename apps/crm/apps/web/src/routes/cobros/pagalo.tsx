/**
 * CB-127 · Bandeja de supervisión Págalo: todos los grupos en estado
 * problemático de la cartera (no solo un caso), con las mismas acciones de
 * supervisor que la Ficha 360 y deep link a cada caso.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Loader2, RotateCcw, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { GrupoLinksPorTipo } from "@/components/cobros/pagalo/chip-link-pagalo";
import {
	antiguedadLink,
	etiquetaFuente,
	getEstadoGrupoInfo,
} from "@/components/cobros/pagalo/formato-pagalo";
import { Pagination } from "@/components/cobros/pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { usePersistedState } from "@/hooks/usePersistedState";
import { authClient } from "@/lib/auth-client";
import {
	agruparLinksPorGeneracion,
	getPagaloLinkStatusInfo,
} from "@/lib/cobros/pagalo-link-display";
import { PERMISSIONS } from "@/lib/roles";
import { orpc } from "@/utils/orpc";
import { alternarEstado, normalizarNombreCliente } from "./-pagalo-columnas";

export const Route = createFileRoute("/cobros/pagalo")({
	component: PagaloSupervisionPage,
});

const q = (value: unknown) =>
	new Intl.NumberFormat("es-GT", { style: "currency", currency: "GTQ" }).format(
		Number(value ?? 0),
	);

const ESTADOS_FILTRABLES = [
	"LINKS_PENDING",
	"PENDING_PAYMENT",
	"PARTIALLY_PAID",
	"READY_TO_APPLY",
	"APPLYING",
	"COMPLETED",
	"APPLICATION_FAILED",
	"REVIEW_REQUIRED",
] as const;

const POR_PAGINA = 25;

type LinkResumen = {
	id: string;
	linkType: "CAPITAL" | "MORA_INTERES";
	status: string;
	generation: number;
	pollAttempts: number;
	errorCode: string | null;
	errorMessage: string | null;
	lastPollError: string | null;
	activatedAt: string | Date | null;
	createdAt: string | Date;
	paymentUrl: string | null;
	transactionAmount: string | null;
	motivoCierre: string | null;
};

type GrupoSupervision = {
	id: string;
	status: string;
	origen: "ASESOR" | "BOT";
	casoCobroId: string | null;
	numeroCreditoSifco: string;
	carteraCreditoId: number;
	totalAmount: string;
	capitalTotal: string;
	facturableTotal: string;
	dispatchAttemptCount: number;
	nextDispatchAt: string | Date | null;
	lastDispatchError: string | null;
	carteraImportId: number | null;
	createdAt: string | Date;
	creadoPor: string | null;
	clienteNombre: string | null;
	asesoresNombres: string[];
	links: LinkResumen[];
};

type AsesorPool = {
	asesorId: number;
	nombre: string;
	buckets: number[];
};

function FilaGrupo({
	grupo,
	esSupervisor,
}: {
	grupo: GrupoSupervision;
	esSupervisor: boolean;
}) {
	const estadoInfo = getEstadoGrupoInfo(grupo.status);
	return (
		<TableRow>
			<TableCell>
				<div>
					{grupo.casoCobroId && esSupervisor ? (
						// /cobros/$id acepta el SIFCO directo cuando no es UUID de
						// caso (resolverNumeroSifco, server) — un grupo con
						// casoCobroId ya tiene un caso real detrás, así que
						// navegar ahí es de solo lectura sobre algo que ya existe.
						<Link
							to="/cobros/$id"
							params={{ id: grupo.numeroCreditoSifco }}
							search={{ tipo: "caso" }}
							className="font-medium text-violet-700 hover:underline"
						>
							{grupo.numeroCreditoSifco}
						</Link>
					) : (
						// Un asesor ve grupos de sus buckets, pero el detalle de caso
						// sigue protegido por responsableCobros. No exponer un enlace que
						// terminaría en acceso denegado para créditos cubiertos por pool.
						// Un grupo SIN casoCobroId (típicamente del bot) tampoco tiene
						// caso de cobros detrás — /cobros/$id llama
						// getDetallesCreditoCarteraBack, que si no encuentra un
						// caso activo para el SIFCO CREA uno nuevo y lo asigna al
						// usuario que solo quería mirar (cobros.ts, líneas ~4468-
						// 4508). Navegar ahí desde la bandeja no era de solo
						// lectura: el supervisor terminaba generándose trabajo
						// operativo real con un click (hallazgo de code review).
						// Sin link hasta que exista una vista de detalle
						// realmente read-only para este caso.
						<span
							className="font-medium"
							title={
								grupo.casoCobroId
									? "Este crédito se muestra por bucket; abrir el caso exige asignación directa."
									: "Este grupo no tiene caso de cobros asociado — abrirlo crearía uno nuevo."
							}
						>
							{grupo.numeroCreditoSifco}
						</span>
					)}
				</div>
				<div className="mt-1 text-muted-foreground text-xs">
					{normalizarNombreCliente(grupo.clienteNombre) ?? "—"}
				</div>
			</TableCell>
			<TableCell>
				{grupo.asesoresNombres.length > 0
					? grupo.asesoresNombres.join(", ")
					: "—"}
			</TableCell>
			<TableCell>
				<Badge className={estadoInfo.className}>{estadoInfo.label}</Badge>
			</TableCell>
			<TableCell className="text-right">{q(grupo.totalAmount)}</TableCell>
			<TableCell>{etiquetaFuente(grupo.origen)}</TableCell>
			<TableCell>
				<div className="flex flex-wrap gap-2">
					{agruparLinksPorGeneracion(grupo.links).map(
						({ vigente, historicos }) => {
							const monto =
								vigente.transactionAmount ??
								(vigente.linkType === "CAPITAL"
									? grupo.capitalTotal
									: grupo.facturableTotal);
							return (
								<GrupoLinksPorTipo
									key={vigente.linkType}
									vigente={vigente}
									historicos={historicos}
									estadoLabel={getPagaloLinkStatusInfo(vigente.status).label}
									monto={monto}
									motivoCierre={vigente.motivoCierre}
									paymentUrl={vigente.paymentUrl}
									casoCobroId={grupo.casoCobroId}
									esSupervisor={esSupervisor}
									grupoStatus={grupo.status}
								/>
							);
						},
					)}
				</div>
			</TableCell>
			<TableCell>{antiguedadLink(grupo.createdAt).etiqueta}</TableCell>
		</TableRow>
	);
}

function PagaloSupervisionPage() {
	const { data: session, isPending: sesionCargando } = authClient.useSession();
	const userRole = session?.user?.role;

	const [estados, setEstados] = usePersistedState<string[]>(
		"cobros-pagalo-supervision-v1-estados",
		[],
	);
	const [numeroSifco, setNumeroSifco] = useState("");
	const [asesorSel, setAsesorSel] = useState("todos");
	const [pagina, setPagina] = useState(1);
	const queryClient = useQueryClient();

	const puedeConsultar = !!userRole && PERMISSIONS.canAccessCobros(userRole);
	const esSupervisor = !!userRole && PERMISSIONS.canAssignCobros(userRole);
	const asesorId =
		esSupervisor && asesorSel !== "todos" ? Number(asesorSel) : undefined;

	// Sin chips de estado activos: mostrar TODO, no solo lo problemático — el
	// filtro "problemático" por defecto queda reservado para cuando el
	// usuario no acotó nada más específico (ver getPagaloSupervision).
	const inputConsulta = (offset: number) => ({
		estados: estados.length > 0 ? estados : undefined,
		soloProblematicos: estados.length > 0,
		numeroSifco: numeroSifco.trim() || undefined,
		asesorId,
		limit: POR_PAGINA,
		offset,
	});

	const supervisionQuery = useQuery({
		...orpc.getPagaloSupervision.queryOptions({
			input: inputConsulta((pagina - 1) * POR_PAGINA),
		}),
		enabled: puedeConsultar,
	});
	const asesoresQuery = useQuery({
		...orpc.getPagaloAsesores.queryOptions({ input: {} }),
		enabled: esSupervisor,
	});

	// Una mutación (invalidar/regenerar) puede reducir `total` de forma que
	// la página actual quede fuera de rango — el offset resultante cae vacío
	// y se ve como "no hay grupos" aunque sí los haya en una página anterior
	// (hallazgo de code review). Reajustar al último índice válido en vez de
	// dejar la página huérfana. El hook va antes de cualquier return
	// condicional (regla de hooks) — usa el total en 0 mientras no hay data.
	const total = supervisionQuery.data?.total ?? 0;
	const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
	useEffect(() => {
		if (pagina > totalPaginas) setPagina(totalPaginas);
	}, [pagina, totalPaginas]);

	if (sesionCargando) {
		return (
			<div className="flex min-h-screen items-center justify-center text-gray-500">
				<Loader2 className="mr-2 h-5 w-5 animate-spin" />
				Cargando…
			</div>
		);
	}

	if (!puedeConsultar) {
		return (
			<div className="flex min-h-screen items-center justify-center">
				<div className="text-center">
					<h1 className="mb-4 font-bold text-2xl text-gray-800">
						Acceso Denegado
					</h1>
					<p className="text-gray-600">
						No tenés permiso para ver la bandeja de supervisión Págalo.
					</p>
				</div>
			</div>
		);
	}

	const grupos = (supervisionQuery.data?.grupos as GrupoSupervision[]) ?? [];
	const conteoPorEstado =
		(supervisionQuery.data?.conteoPorEstado as
			| Record<string, number>
			| undefined) ?? {};
	const asesores = (asesoresQuery.data as AsesorPool[] | undefined) ?? [];

	const toggleEstado = (estado: string) => {
		setPagina(1);
		setEstados((prev) => alternarEstado(prev, estado));
	};

	return (
		<div className="mx-auto max-w-[1600px] px-4 py-6">
			<div className="mb-6 flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 className="font-bold text-2xl">Supervisión Págalo</h1>
					<p className="text-muted-foreground text-sm">
						Grupos con links vencidos, fallidos o duplicados. Sin estados
						seleccionados se muestran todos los grupos; al elegir uno o más,
						solo esos.
					</p>
					{!esSupervisor && (
						<p className="mt-1 text-muted-foreground text-sm">
							Mostrando créditos de tus buckets asignados.
						</p>
					)}
				</div>
				<Button
					variant="outline"
					size="sm"
					onClick={() => supervisionQuery.refetch()}
					disabled={supervisionQuery.isFetching}
				>
					<RotateCcw
						className={`mr-2 h-4 w-4 ${supervisionQuery.isFetching ? "animate-spin" : ""}`}
					/>
					Actualizar
				</Button>
			</div>

			<div className="mb-4 flex flex-wrap items-center gap-2">
				{ESTADOS_FILTRABLES.map((estado) => {
					const activo = estados.includes(estado);
					const info = getEstadoGrupoInfo(estado);
					const cantidad = conteoPorEstado[estado] ?? 0;
					return (
						<button
							key={estado}
							type="button"
							onClick={() => toggleEstado(estado)}
							className={`rounded px-2 py-1 text-xs ${
								activo ? info.className : "bg-muted text-muted-foreground"
							} ${activo ? "ring-1 ring-violet-500" : ""}`}
						>
							{info.label} ({cantidad})
						</button>
					);
				})}
				<div className="ml-auto flex flex-wrap items-center gap-2">
					{esSupervisor && (
						<Select
							value={asesorSel}
							onValueChange={(valor) => {
								setAsesorSel(valor);
								setPagina(1);
							}}
						>
							<SelectTrigger className="w-56">
								<UserRound className="mr-1 h-3.5 w-3.5 text-muted-foreground" />
								<SelectValue placeholder="Asesor" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="todos">Todos los asesores</SelectItem>
								{asesoresQuery.isError && (
									<div className="px-2 py-1.5 text-destructive text-xs">
										No se pudo cargar asesores
									</div>
								)}
								{asesores.map((asesor) => (
									<SelectItem
										key={asesor.asesorId}
										value={String(asesor.asesorId)}
									>
										{asesor.nombre}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
					<Input
						placeholder="Buscar por SIFCO…"
						value={numeroSifco}
						onChange={(e) => {
							setNumeroSifco(e.target.value);
							setPagina(1);
						}}
						className="w-56"
					/>
				</div>
			</div>

			{supervisionQuery.isLoading ? (
				<div className="py-12 text-center text-muted-foreground text-sm">
					Cargando…
				</div>
			) : supervisionQuery.isError ? (
				<div className="flex flex-col items-center gap-2 py-12 text-center text-sm">
					<p className="text-destructive">
						No se pudo cargar la bandeja de supervisión.
					</p>
					<Button
						variant="outline"
						size="sm"
						onClick={() => supervisionQuery.refetch()}
					>
						Reintentar
					</Button>
				</div>
			) : grupos.length === 0 ? (
				<p className="py-12 text-center text-muted-foreground text-sm">
					No hay grupos Págalo con problemas.
				</p>
			) : (
				<div className="overflow-x-auto rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Crédito / Cliente</TableHead>
								<TableHead>Asesor</TableHead>
								<TableHead>Estado</TableHead>
								<TableHead className="text-right">Total</TableHead>
								<TableHead>Origen</TableHead>
								<TableHead>Links</TableHead>
								<TableHead>Antigüedad</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{grupos.map((grupo) => (
								<FilaGrupo
									key={grupo.id}
									grupo={grupo}
									esSupervisor={esSupervisor}
								/>
							))}
						</TableBody>
					</Table>
				</div>
			)}

			<div className="mt-4">
				<Pagination
					currentPage={pagina}
					totalItems={total}
					itemsPerPage={POR_PAGINA}
					onPageChange={(next) => {
						setPagina(next);
						queryClient.invalidateQueries(
							orpc.getPagaloSupervision.queryOptions({
								input: inputConsulta((next - 1) * POR_PAGINA),
							}),
						);
					}}
				/>
			</div>
		</div>
	);
}
