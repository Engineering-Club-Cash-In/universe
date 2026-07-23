import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	ChevronLeft,
	ChevronRight,
	ClipboardList,
	Loader2,
	Phone,
	UserRound,
} from "lucide-react";
import { useState } from "react";
import { BucketMultiSelect } from "@/components/cobros/bucket-multi-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
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
import { authClient } from "@/lib/auth-client";
import {
	type BucketsCatalogoQueryData,
	bucketDeEstado,
	estiloBucket,
	useBucketsCatalogo,
} from "@/lib/cobros/buckets-catalogo";
import { PERMISSIONS } from "@/lib/roles";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/cobros/cola")({
	component: ColaDiaPage,
});

interface ColaItem {
	creditoId: number;
	numeroCreditoSifco: string;
	cliente: string;
	asesorId: number;
	asesor: string;
	bucket: number;
	bucketPrefijo: string;
	bucketNombre: string;
	fechaLimiteSla: string | null;
	fechaPromesa: string | Date | null;
	telefono: string | null;
	casoId: string | null;
	slaHoy: boolean;
	promesaHoy: boolean;
	incumplida: boolean;
	sinContacto: boolean;
	diasSinContacto: number | null;
}

interface ColaResponse {
	success: boolean;
	sinAsesor: boolean;
	asesorForzado: { asesorId: number; nombre: string } | null;
	items: ColaItem[];
	total: number;
	page: number;
	perPage: number;
	totalPages: number;
}

interface AsesorOption {
	asesorId: number;
	nombre: string;
	activo: boolean;
	email: string;
	isActive: boolean;
}

type Filtro =
	| "todos"
	| "sla_hoy"
	| "promesa_hoy"
	| "incumplida"
	| "sin_contacto";

const PER_PAGE_COLA = 25;

const FILTROS: Array<{ value: Filtro; label: string }> = [
	{ value: "todos", label: "Todos (priorizado)" },
	{ value: "sla_hoy", label: "SLA vence hoy" },
	{ value: "promesa_hoy", label: "Promesa vence hoy" },
	{ value: "incumplida", label: "Promesa incumplida" },
	{ value: "sin_contacto", label: "+5 días sin contacto" },
];

/** Bucket numérico del motor (0-5) → key de estadoMora del catálogo de UI. */
const KEY_POR_NUMERO = [
	"al_dia",
	"mora_30",
	"mora_60",
	"mora_90",
	"mora_120",
	"mora_120_plus",
] as const;

/** Buckets 1-5 (B0/Cartera Sana nunca aplica SLA, no entra a la cola). */
function opcionesBuckets(catalogo: BucketsCatalogoQueryData | undefined) {
	return [1, 2, 3, 4, 5].map((numero) => {
		const ui = bucketDeEstado(KEY_POR_NUMERO[numero], catalogo);
		return { numero, prefijo: `B${numero}`, nombre: ui.label };
	});
}

function BucketBadge({
	numero,
	catalogo,
}: {
	numero: number;
	catalogo: BucketsCatalogoQueryData | undefined;
}) {
	const ui = bucketDeEstado(KEY_POR_NUMERO[numero], catalogo);
	return (
		<Badge
			variant="outline"
			className="whitespace-nowrap text-[10px]"
			style={estiloBucket(ui.colorHex)}
			title={ui.label}
		>
			B{numero}
		</Badge>
	);
}

function fechaLegible(v: string | Date | null) {
	if (!v) return "—";
	if (typeof v === "string") {
		// "YYYY-MM-DD" → dd/mm/aaaa sin pasar por Date (evita corrimiento por TZ).
		const [y, m, d] = v.split("-");
		return y && m && d ? `${d}/${m}/${y}` : v;
	}
	return new Date(v).toLocaleDateString("es-GT", {
		timeZone: "America/Guatemala",
	});
}

function CategoriaBadges({ item }: { item: ColaItem }) {
	return (
		<span className="inline-flex flex-wrap items-center gap-1">
			{item.slaHoy && (
				<Badge
					variant="outline"
					className="border-transparent bg-red-100 text-[10px] text-red-800 dark:bg-red-900/40 dark:text-red-300"
				>
					SLA hoy
				</Badge>
			)}
			{item.promesaHoy && (
				<Badge
					variant="outline"
					className="border-transparent bg-amber-100 text-[10px] text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
				>
					Promesa hoy
				</Badge>
			)}
			{item.incumplida && (
				<Badge
					variant="outline"
					className="border-transparent bg-slate-200 text-[10px] text-slate-800 dark:bg-slate-800 dark:text-slate-300"
				>
					Incumplida
				</Badge>
			)}
			{item.sinContacto && (
				<Badge
					variant="outline"
					className="border-transparent bg-purple-100 text-[10px] text-purple-800 dark:bg-purple-900/40 dark:text-purple-300"
				>
					{item.diasSinContacto} días sin contacto
				</Badge>
			)}
		</span>
	);
}

function ColaDiaPage() {
	const navigate = useNavigate();
	const { data: session } = authClient.useSession();
	const userRole = session?.user?.role;
	const esSupervisor = !!userRole && PERMISSIONS.canAssignCobros(userRole);
	const bucketsCatalogo = useBucketsCatalogo();

	const [asesorSel, setAsesorSel] = useState("todos");
	const [filtro, setFiltro] = useState<Filtro>("todos");
	const [bucketsSel, setBucketsSel] = useState<number[] | null>(null);
	const [page, setPage] = useState(1);

	const asesorIdInput =
		esSupervisor && asesorSel !== "todos" ? Number(asesorSel) : undefined;
	const buckets = opcionesBuckets(bucketsCatalogo.data);

	const colaQuery = useQuery({
		...orpc.getColaDia.queryOptions({
			input: {
				filtro: filtro === "todos" ? undefined : filtro,
				asesorId: asesorIdInput,
				buckets: bucketsSel ?? undefined,
				page,
				perPage: PER_PAGE_COLA,
			},
		}),
		enabled: !!session,
		placeholderData: keepPreviousData,
	});

	const asesoresQuery = useQuery({
		...orpc.getAsesores.queryOptions({
			input: { page: 1, perPage: 100 },
		}),
		enabled: !!session && esSupervisor,
	});

	if (!userRole || !PERMISSIONS.canAccessCobros(userRole)) {
		return (
			<div className="flex min-h-screen items-center justify-center">
				<div className="text-center">
					<h1 className="mb-4 font-bold text-2xl text-gray-800">
						Acceso Denegado
					</h1>
					<p className="text-gray-600">
						Solo el equipo de cobros puede ver la cola del día.
					</p>
				</div>
			</div>
		);
	}

	const data = colaQuery.data as ColaResponse | undefined;
	const items = data?.items ?? [];
	const total = data?.total ?? 0;
	const totalPages = data?.totalPages ?? 1;
	const sinAsesor = !!data?.sinAsesor;
	const asesorForzado = data?.asesorForzado ?? null;

	const asesores = (
		(asesoresQuery.data as { asesores?: AsesorOption[] } | undefined)
			?.asesores ?? []
	).filter((a) => a.activo);

	const cambiarAsesor = (v: string) => {
		setAsesorSel(v);
		setPage(1);
	};

	const cambiarFiltro = (v: string) => {
		setFiltro(v as Filtro);
		setPage(1);
	};

	const cambiarBuckets = (numeros: number[] | null) => {
		setBucketsSel(numeros);
		setPage(1);
	};

	const irAlDetalle = (sifco: string) => {
		navigate({
			to: "/cobros/$id",
			params: { id: sifco },
			search: { tipo: "caso" },
		});
	};

	return (
		<div className="container mx-auto space-y-4 p-4 lg:p-6">
			<Card>
				<CardHeader className="pb-4">
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div className="flex items-center gap-3">
							<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
								<ClipboardList className="h-5 w-5" />
							</div>
							<div>
								<CardTitle className="text-xl">Cola del día</CardTitle>
								<CardDescription>
									Cuentas priorizadas para gestionar hoy: SLA vencido, promesas
									de pago que vencen hoy, promesas incumplidas y cuentas sin
									contacto reciente
									{asesorForzado ? ` · Cola de ${asesorForzado.nombre}` : ""}
								</CardDescription>
							</div>
						</div>
						<div className="flex items-center gap-2">
							<Badge variant="secondary">{total} cuentas</Badge>
							{colaQuery.isFetching && (
								<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
							)}
							<BucketMultiSelect
								buckets={buckets}
								value={bucketsSel}
								onChange={cambiarBuckets}
							/>
							{esSupervisor && (
								<Select value={asesorSel} onValueChange={cambiarAsesor}>
									<SelectTrigger className="h-8 w-52">
										<UserRound className="mr-1 h-3.5 w-3.5 text-muted-foreground" />
										<SelectValue placeholder="Asesor" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="todos">Todos los asesores</SelectItem>
										{asesoresQuery.isError && (
											<div className="px-2 py-1.5 text-destructive text-xs">
												Error al cargar asesores
											</div>
										)}
										{asesores.map((a) => (
											<SelectItem key={a.asesorId} value={String(a.asesorId)}>
												{a.nombre}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							)}
						</div>
					</div>
					<div className="flex flex-wrap items-center gap-1.5 pt-3">
						{FILTROS.map((f) => (
							<Button
								key={f.value}
								type="button"
								size="sm"
								variant={filtro === f.value ? "default" : "outline"}
								className="h-7 rounded-full px-3 text-xs"
								onClick={() => cambiarFiltro(f.value)}
							>
								{f.label}
							</Button>
						))}
					</div>
				</CardHeader>
			</Card>

			{colaQuery.isPending && (
				<div className="flex items-center justify-center py-16">
					<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
				</div>
			)}

			{!colaQuery.isPending && colaQuery.isError && (
				<Card>
					<CardContent className="py-10 text-center text-destructive">
						Error al cargar la cola del día. Intentá recargar la página.
					</CardContent>
				</Card>
			)}

			{!colaQuery.isPending && !colaQuery.isError && sinAsesor && (
				<Card>
					<CardContent className="py-10 text-center text-muted-foreground">
						Tu usuario no está vinculado a un asesor de cartera (por correo).
						Pedile al supervisor que revise tu correo de asesor.
					</CardContent>
				</Card>
			)}

			{!colaQuery.isPending &&
				!colaQuery.isError &&
				!sinAsesor &&
				total === 0 && (
					<Card>
						<CardContent className="py-10 text-center text-muted-foreground">
							Sin cuentas pendientes en la cola de hoy. 🎉
						</CardContent>
					</Card>
				)}

			{!colaQuery.isPending &&
				!colaQuery.isError &&
				!sinAsesor &&
				total > 0 && (
					<Card>
						<CardContent className="pt-6">
							<div className="overflow-x-auto">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Cliente</TableHead>
											<TableHead>Bucket</TableHead>
											<TableHead>Crédito</TableHead>
											<TableHead>Categoría</TableHead>
											<TableHead>Límite SLA</TableHead>
											<TableHead>Promesa</TableHead>
											<TableHead>Teléfono</TableHead>
											{esSupervisor && asesorSel === "todos" && (
												<TableHead>Asesor</TableHead>
											)}
										</TableRow>
									</TableHeader>
									<TableBody>
										{items.map((item) => (
											<TableRow
												key={item.creditoId}
												className="cursor-pointer"
												onClick={() => irAlDetalle(item.numeroCreditoSifco)}
											>
												<TableCell className="font-medium">
													{item.cliente}
												</TableCell>
												<TableCell>
													<BucketBadge
														numero={item.bucket}
														catalogo={bucketsCatalogo.data}
													/>
												</TableCell>
												<TableCell className="max-w-45 truncate font-mono text-muted-foreground text-xs">
													{item.numeroCreditoSifco}
												</TableCell>
												<TableCell>
													<CategoriaBadges item={item} />
												</TableCell>
												<TableCell className="text-sm">
													{fechaLegible(item.fechaLimiteSla)}
												</TableCell>
												<TableCell className="text-sm">
													{fechaLegible(item.fechaPromesa)}
												</TableCell>
												<TableCell>
													{item.telefono ? (
														<span className="inline-flex items-center gap-1 text-sm">
															<Phone className="h-3 w-3 text-muted-foreground" />
															{item.telefono}
														</span>
													) : (
														<span className="text-muted-foreground text-xs">
															Sin teléfono
														</span>
													)}
												</TableCell>
												{esSupervisor && asesorSel === "todos" && (
													<TableCell className="text-sm">
														{item.asesor}
													</TableCell>
												)}
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>

							{totalPages > 1 && (
								<div className="flex items-center justify-between pt-3">
									<span className="text-muted-foreground text-xs">
										Mostrando {items.length} de {total} · página {page} de{" "}
										{totalPages}
									</span>
									<div className="flex items-center gap-1">
										<Button
											variant="outline"
											size="sm"
											className="h-8"
											disabled={page <= 1 || colaQuery.isFetching}
											onClick={() => setPage((p) => p - 1)}
										>
											<ChevronLeft className="h-4 w-4" />
											Anterior
										</Button>
										<Button
											variant="outline"
											size="sm"
											className="h-8"
											disabled={page >= totalPages || colaQuery.isFetching}
											onClick={() => setPage((p) => p + 1)}
										>
											Siguiente
											<ChevronRight className="h-4 w-4" />
										</Button>
									</div>
								</div>
							)}
						</CardContent>
					</Card>
				)}
		</div>
	);
}
