import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	CalendarCheck2,
	CircleCheck,
	CircleDashed,
	Loader2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { GestionesDelDiaPanel } from "@/components/cobros/gestiones-del-dia-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { etiquetaMotivoAgenda } from "@/lib/cobros/cumplimiento-agenda";
import { PERMISSIONS } from "@/lib/roles";
import { orpc } from "@/utils/orpc";

type ResumenFila = {
	snapshotId: string;
	asesorId: string;
	asesorNombre: string;
	planificados: number;
	atendidos: number;
	pendientes: number;
	porcentaje: number;
	estado: "abierto" | "cerrado";
	capturadoEn: string | Date;
	cerradoEn: string | Date | null;
};

type ResumenData = { fecha: string | null; items: ResumenFila[] };

type UsuarioConGestiones = { id: string; name: string; role: string };

type DetalleItem = {
	id: string;
	numeroCreditoSifco: string;
	casoCobroId: string | null;
	clienteNombre: string | null;
	bucketSnapshot: number | null;
	motivoAgenda: string | null;
	atendido: boolean;
	pendiente: boolean;
	contactoCobroId: string | null;
	atendidoEn: string | Date | null;
	resultadoContacto: string | null;
	metodoContacto: string | null;
	comentarios: string | null;
	promesaCumplida: boolean;
	promesaContactoCobroId: string | null;
	promesaCumplidaEn: string | Date | null;
};

type DetalleData = {
	fecha: string;
	asesorId: string;
	page: number;
	perPage: number;
	total: number;
	totalPages: number;
	items: DetalleItem[];
};

const PER_PAGE_DETALLE = 50;

const RESULTADO_LABEL: Record<string, string> = {
	contactado: "Contactado",
	acuerdo_parcial: "Acuerdo parcial",
	rechaza_pagar: "Rechaza pagar",
	promesa_pago: "Promesa de pago",
};

function formatoFechaHora(valor: string | Date | null): string {
	if (!valor) return "—";
	return new Date(valor).toLocaleString("es-GT", {
		timeZone: "America/Guatemala",
		dateStyle: "short",
		timeStyle: "short",
	});
}

function DetalleAgenda({
	fecha,
	asesorId,
}: {
	fecha: string;
	asesorId: string;
}) {
	// biome-ignore lint/suspicious/noExplicitAny: contrato manual por TS7056 del router raíz.
	const orpcAny = orpc as any;
	// Paginado server-side: un asesor puede tener 16k+ créditos planificados
	// en el snapshot — traer todo de una vez congelaba el navegador al
	// expandir la fila (Codex PR #1332).
	const [page, setPage] = useState(1);
	const query = useQuery({
		...orpcAny.getCumplimientoAgendaDetalle.queryOptions({
			input: { fecha, asesorId, page, perPage: PER_PAGE_DETALLE },
		}),
	});
	const datos = query.data as DetalleData | undefined;

	if (query.isPending) {
		return (
			<div className="flex items-center gap-2 border-t px-4 py-6 text-gray-500 text-sm">
				<Loader2 className="h-4 w-4 animate-spin" />
				Cargando créditos…
			</div>
		);
	}
	if (query.isError) {
		return (
			<div className="border-t px-4 py-6 text-red-600 text-sm">
				No se pudo cargar detalle.
			</div>
		);
	}

	return (
		<div className="overflow-x-auto border-t">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Crédito / cliente</TableHead>
						<TableHead>Agenda</TableHead>
						<TableHead>Resultado</TableHead>
						<TableHead>Evidencia</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{(datos?.items ?? []).map((item) => (
						<TableRow key={item.id}>
							<TableCell>
								<Link
									className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
									params={{
										id: item.casoCobroId ?? item.numeroCreditoSifco,
									}}
									search={{
										tipo: item.casoCobroId ? "caso" : "contrato",
									}}
									to="/cobros/$id"
								>
									{item.numeroCreditoSifco}
								</Link>
								<div className="text-gray-500 text-xs">
									{item.clienteNombre ?? "Caso sin cliente CRM vinculado"}
								</div>
							</TableCell>
							<TableCell>
								<div className="flex gap-2">
									<Badge variant="outline">
										{etiquetaMotivoAgenda(item.motivoAgenda)}
									</Badge>
									<Badge variant="secondary">
										{item.bucketSnapshot == null
											? "Sin bucket"
											: `B${item.bucketSnapshot}`}
									</Badge>
								</div>
							</TableCell>
							<TableCell>
								<div className="space-y-1">
									{item.atendido ? (
										<span className="flex items-center gap-1 font-medium text-emerald-600">
											<CircleCheck className="h-4 w-4" /> Atendido
										</span>
									) : !item.promesaCumplida ? (
										<span className="flex items-center gap-1 font-medium text-amber-600">
											<CircleDashed className="h-4 w-4" /> Pendiente de gestión
										</span>
									) : null}
									{item.promesaCumplida && (
										<span className="flex items-center gap-1 font-medium text-sky-600">
											<CircleCheck className="h-4 w-4" /> Pago confirmado
										</span>
									)}
								</div>
							</TableCell>
							<TableCell className="max-w-sm text-sm">
								{item.atendido ? (
									<>
										<div>
											{RESULTADO_LABEL[item.resultadoContacto ?? ""] ??
												item.resultadoContacto}
											{" · "}
											{formatoFechaHora(item.atendidoEn)}
										</div>
										<div className="truncate text-gray-500 text-xs">
											{item.metodoContacto ?? "—"}: {item.comentarios ?? "—"}
										</div>
									</>
								) : !item.promesaCumplida ? (
									<span className="text-gray-400">
										Sin contacto efectivo propio
									</span>
								) : null}
								{item.promesaCumplida && (
									<div className="mt-1 text-sky-600 text-xs">
										Pago confirmado {formatoFechaHora(item.promesaCumplidaEn)}
									</div>
								)}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
			{datos && datos.totalPages > 1 && (
				<div className="flex items-center justify-end gap-3 border-t px-4 py-2 text-sm">
					<Button
						variant="outline"
						size="sm"
						disabled={page <= 1}
						onClick={() => setPage((p) => Math.max(1, p - 1))}
					>
						Anterior
					</Button>
					<span className="text-gray-500">
						Página {datos.page} de {datos.totalPages} ({datos.total} créditos)
					</span>
					<Button
						variant="outline"
						size="sm"
						disabled={page >= datos.totalPages}
						onClick={() => setPage((p) => p + 1)}
					>
						Siguiente
					</Button>
				</div>
			)}
		</div>
	);
}

export function CumplimientoAgendaPanel() {
	const { data: session, isPending: sesionCargando } = authClient.useSession();
	const userRole = session?.user?.role;
	const puedeConsultar = !!userRole && PERMISSIONS.canAssignCobros(userRole);
	const [fecha, setFecha] = useState("");
	// Elección EXPLÍCITA del usuario, no el valor efectivo — se deriva abajo.
	// Guardar el valor efectivo directo y sembrarlo con un efecto producía
	// thrash (ver `asesorId` derivado); acá no hace falta ningún efecto.
	const [asesorElegido, setAsesorElegido] = useState<string | null>(null);
	// biome-ignore lint/suspicious/noExplicitAny: contrato manual por TS7056 del router raíz.
	const orpcAny = orpc as any;
	const query = useQuery({
		...orpcAny.getCumplimientoAgendaResumen.queryOptions({
			input: { fecha: fecha || undefined },
		}),
		enabled: !!session && puedeConsultar,
	});
	const datos = query.data as ResumenData | undefined;

	useEffect(() => {
		if (!fecha && datos?.fecha) setFecha(datos.fecha);
	}, [datos?.fecha, fecha]);

	// Asesores con gestiones registradas ese día — complementa `datos.items`
	// (asesores con snapshot). Un asesor sin NINGÚN item planificado (0
	// D-0/SLA/promesa) nunca genera fila en `agenda_cobros_snapshots`
	// (`capturarSnapshots` solo persiste asesores presentes en la lista de
	// items — `agenda-cobros-snapshot.ts`), así que si el selector se armara
	// solo con `datos.items` ese asesor sería imposible de elegir aunque haya
	// trabajado gestiones fuera de agenda todo el día (hallazgo de code
	// review, Codex).
	const usuariosQuery = useQuery({
		...orpcAny.getUsuariosConGestiones.queryOptions({
			input: { desde: fecha || undefined, hasta: fecha || undefined },
		}),
		enabled: !!session && puedeConsultar && !!fecha,
	});
	const usuariosConGestiones = (usuariosQuery.data ??
		[]) as UsuarioConGestiones[];

	// Catálogo del selector: unión de "tiene snapshot" y "tiene gestiones ese
	// día", no solo `datos.items`. No se manda `asesorId` a la query de
	// arriba: eso colapsaría `datos.items` a un solo asesor y el selector se
	// quedaría sin opciones para cambiar.
	const asesores = useMemo(() => {
		const porId = new Map<string, { asesorId: string; asesorNombre: string }>();
		for (const fila of datos?.items ?? [])
			porId.set(fila.asesorId, {
				asesorId: fila.asesorId,
				asesorNombre: fila.asesorNombre,
			});
		for (const u of usuariosConGestiones)
			if (!porId.has(u.id))
				porId.set(u.id, { asesorId: u.id, asesorNombre: u.name });
		// Alfabético: mismo criterio que ya trae `datos.items` del server
		// (`asc(user.name)`), para que "el primero" del default sea estable.
		return [...porId.values()].sort((a, b) =>
			a.asesorNombre.localeCompare(b.asesorNombre, "es"),
		);
	}, [datos?.items, usuariosConGestiones]);
	// Valor EFECTIVO: la elección del usuario si sigue existiendo en la lista
	// del día actual, si no el primero. Cubre sin efectos: primera carga,
	// cambio de fecha con el mismo asesor (se respeta), cambio de fecha donde
	// desapareció (cae al primero), y lista vacía (null).
	const asesorId =
		asesorElegido && asesores.some((a) => a.asesorId === asesorElegido)
			? asesorElegido
			: (asesores[0]?.asesorId ?? null);
	const asesorSeleccionado =
		asesores.find((a) => a.asesorId === asesorId) ?? null;
	// La fila del snapshot: puede no existir aunque `asesorId` sí (asesor sin
	// agenda planificada ese día, agregado por `usuariosConGestiones`) — la
	// tarjeta de agenda planificada lo distingue de "sin snapshots en
	// absoluto" (que usa `asesores.length === 0` más abajo).
	const filaSeleccionada =
		datos?.items.find((a) => a.asesorId === asesorId) ?? null;

	if (sesionCargando) {
		return (
			<div className="flex min-h-screen items-center justify-center text-gray-500">
				<Loader2 className="mr-2 h-5 w-5 animate-spin" /> Cargando…
			</div>
		);
	}
	if (!puedeConsultar) {
		return (
			<div className="flex min-h-screen items-center justify-center text-center">
				<div>
					<h1 className="mb-4 font-bold text-2xl">Acceso denegado</h1>
					<p className="text-gray-600">
						Solo supervisores y administradores pueden ver cumplimiento de
						agenda.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="mx-auto max-w-[1600px] px-4 py-6">
			<div className="mb-6 flex flex-wrap items-center justify-between gap-4">
				<div className="flex items-center gap-3">
					<CalendarCheck2 className="h-7 w-7 text-indigo-500" />
					<div>
						<h1 className="font-bold text-2xl">Cumplimiento de agenda</h1>
						<p className="text-gray-500 text-sm">
							Agenda congelada a las 00:05 GT y evaluada al cerrar día completo.
						</p>
					</div>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<input
						className="rounded-md border px-2 py-1 text-sm dark:bg-gray-800"
						onChange={(event) => setFecha(event.target.value)}
						type="date"
						value={fecha}
					/>
					<Select
						value={asesorId ?? ""}
						onValueChange={setAsesorElegido}
						disabled={asesores.length === 0}
					>
						<SelectTrigger className="w-56">
							<SelectValue placeholder="Seleccioná un asesor" />
						</SelectTrigger>
						<SelectContent>
							{asesores.map((fila) => (
								<SelectItem key={fila.asesorId} value={fila.asesorId}>
									{fila.asesorNombre}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>

			{query.isPending ? (
				<div className="flex justify-center py-16 text-gray-500">
					<Loader2 className="mr-2 h-5 w-5 animate-spin" /> Cargando…
				</div>
			) : query.isError ? (
				<Card className="p-8 text-center text-red-600">
					No se pudo cargar el cumplimiento de agenda. Reintentá en unos
					segundos.
				</Card>
			) : usuariosQuery.isError ? (
				// Sin esto, un fallo de `getUsuariosConGestiones` se disfrazaba de
				// "sin resultados": `usuariosConGestiones` caía a `[]` con
				// `?? []`, así que `asesores` se armaba SOLO con `datos.items` (los
				// que tienen snapshot) y el catálogo quedaba incompleto en
				// silencio — un asesor sin agenda planificada pero con gestiones
				// ese día desaparecía del selector como si de verdad no hubiera
				// trabajado, en vez de "no se pudo saber" (hallazgo de code
				// review, Codex).
				<Card className="p-8 text-center text-red-600">
					No se pudo cargar el catálogo completo de asesores. Reintentá en unos
					segundos.
				</Card>
			) : asesores.length === 0 ? (
				<Card className="p-8 text-center text-gray-500">
					No hay agenda cerrada ni gestiones registradas para esta fecha. La
					agenda se congela a las 00:05 GT y se cierra al terminar el día — el
					día de hoy aparece hasta el cierre nocturno.
				</Card>
			) : (
				<div className="space-y-6">
					<div>
						<h2 className="mb-3 font-semibold text-gray-500 text-sm uppercase tracking-wide">
							Agenda planificada
						</h2>
						{asesorSeleccionado && (
							<Card className="overflow-hidden">
								{filaSeleccionada ? (
									<>
										<div className="grid w-full grid-cols-[minmax(180px,1fr)_repeat(4,minmax(80px,auto))] items-center gap-4 px-4 py-3 text-left">
											<span className="font-medium">
												{filaSeleccionada.asesorNombre}
											</span>
											<span className="text-center text-sm">
												<b>{filaSeleccionada.planificados}</b> planificados
											</span>
											<span className="text-center text-emerald-600 text-sm">
												<b>{filaSeleccionada.atendidos}</b> atendidos
											</span>
											<span className="text-center text-amber-600 text-sm">
												<b>{filaSeleccionada.pendientes}</b> pendientes
											</span>
											<span className="text-center font-semibold">
												{filaSeleccionada.porcentaje}%
												<Badge className="ml-2" variant="outline">
													{filaSeleccionada.estado}
												</Badge>
											</span>
										</div>
										{fecha && (
											<DetalleAgenda
												// Resetea la paginación interna al cambiar de fecha o
												// asesor: sin esto, la tarjeta queda siempre montada
												// (ya no hay toggle de expandir/colapsar) y el `page`
												// de un asesor anterior se arrastraba al nuevo, pidiendo
												// una página que puede no existir (hallazgo de code
												// review, Codex).
												key={`${fecha}:${filaSeleccionada.asesorId}`}
												asesorId={filaSeleccionada.asesorId}
												fecha={fecha}
											/>
										)}
									</>
								) : (
									// Asesor sin snapshot ese día (0 items planificados —
									// `capturarSnapshots` no persiste una fila para él, ver la
									// nota en `usuariosConGestiones` más arriba), pero SÍ con
									// gestiones registradas: el bloque de abajo las muestra
									// todas como "Fuera de agenda".
									<div className="px-4 py-6 text-center text-gray-500 text-sm">
										{asesorSeleccionado.asesorNombre} no tenía agenda
										planificada ese día.
									</div>
								)}
							</Card>
						)}
					</div>

					{asesorSeleccionado && fecha && (
						<GestionesDelDiaPanel
							key={`${fecha}:${asesorSeleccionado.asesorId}`}
							fecha={fecha}
							asesorId={asesorSeleccionado.asesorId}
							asesorNombre={asesorSeleccionado.asesorNombre}
							esSupervisor={puedeConsultar}
						/>
					)}
				</div>
			)}
		</div>
	);
}
