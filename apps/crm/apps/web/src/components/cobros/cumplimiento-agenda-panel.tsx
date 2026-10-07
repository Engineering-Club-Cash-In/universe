import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	CalendarCheck2,
	ChevronLeft,
	ChevronRight,
	CircleCheck,
	CircleDashed,
	Loader2,
	UserCheck,
} from "lucide-react";
import type * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { CampoFecha } from "@/components/cobros/campo-fecha";
import { GestionesDelDiaPanel } from "@/components/cobros/gestiones-del-dia-panel";
import { aFechaISO_GT } from "@/components/cobros/historial/formato";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
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

export type ResumenFila = {
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

type AsesorConAgenda = {
	asesorId: string;
	asesorNombre: string;
	estado: "abierto" | "cerrado";
};

export type DetalleItem = {
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
	/** CB-114: quién gestionó, si fue un suplente y no el dueño de la agenda. */
	cubiertoPor?: string | null;
};

export type DetalleData = {
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
	return (
		<DetalleAgendaVista
			datos={query.data as DetalleData | undefined}
			cargando={query.isPending}
			error={query.isError}
			page={page}
			onPage={setPage}
		/>
	);
}

/**
 * Detalle paginado de la agenda planificada (créditos, motivo, resultado y
 * evidencia). Presentación pura: la usan `DetalleAgenda` y el showcase.
 */
export function DetalleAgendaVista({
	datos,
	cargando,
	error,
	page,
	onPage,
}: {
	datos: DetalleData | undefined;
	cargando: boolean;
	error: boolean;
	page: number;
	onPage: (page: number) => void;
}) {
	if (cargando) {
		return (
			<div className="flex items-center gap-2 border-t px-4 py-6 text-gray-500 text-sm">
				<Loader2 className="h-4 w-4 animate-spin" />
				Cargando créditos…
			</div>
		);
	}
	if (error) {
		return (
			<div className="border-t px-4 py-6 text-red-600 text-sm">
				No se pudo cargar el detalle.
			</div>
		);
	}

	return (
		<div className="overflow-x-auto border-t contain-inline-size">
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
									{/* CB-114: durante una cobertura el trabajo del suplente se
									    acredita al titular, así que un asesor de vacaciones
									    puede salir 100% atendido sin haber tocado nada. Sin
									    esta marca el supervisor lee "cumplió" de quien no
									    trabajó. */}
									{item.cubiertoPor && (
										<span className="flex items-center gap-1 text-sky-600 text-xs">
											<UserCheck className="h-3 w-3" />
											Cubierto por {item.cubiertoPor}
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
						onClick={() => onPage(Math.max(1, page - 1))}
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
						onClick={() => onPage(page + 1)}
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

	// Catálogo de "quién tiene snapshot ese día", SIN filtrar por estado —
	// a propósito distinto de `datos.items` (arriba), que sí filtra
	// `cerrado`: ese filtro es correcto para el RESUMEN (totalAtendidos/%
	// solo los escribe el cierre nocturno, mostrarlos antes sería un dato
	// engañoso), pero no debe aplicar al CATÁLOGO — un asesor con la agenda de
	// HOY (siempre abierta hasta esa noche) tiene que poder elegirse igual,
	// aunque su tarjeta de arriba todavía no muestre métricas (hallazgo de
	// code review, Codex).
	const asesoresConAgendaQuery = useQuery({
		...orpcAny.getAsesoresConAgenda.queryOptions({
			input: { fecha },
		}),
		enabled: !!session && puedeConsultar && !!fecha,
	});
	const asesoresConAgenda = (asesoresConAgendaQuery.data ??
		[]) as AsesorConAgenda[];

	// Asesores con gestiones registradas ese día — complementa
	// `asesoresConAgenda`. Un asesor sin NINGÚN item planificado (0
	// D-0/SLA/promesa) nunca genera fila en `agenda_cobros_snapshots`
	// (`capturarSnapshots` solo persiste asesores presentes en la lista de
	// items — `agenda-cobros-snapshot.ts`), así que si el selector se armara
	// solo con el snapshot ese asesor sería imposible de elegir aunque haya
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

	// Catálogo del selector: unión de "tiene snapshot ese día" (abierto o
	// cerrado) y "tiene gestiones ese día". No se manda `asesorId` a la query
	// de resumen: eso colapsaría `datos.items` a un solo asesor y el selector
	// se quedaría sin opciones para cambiar.
	const asesores = useMemo(() => {
		const porId = new Map<string, { asesorId: string; asesorNombre: string }>();
		for (const fila of asesoresConAgenda)
			porId.set(fila.asesorId, {
				asesorId: fila.asesorId,
				asesorNombre: fila.asesorNombre,
			});
		for (const u of usuariosConGestiones)
			if (!porId.has(u.id))
				porId.set(u.id, { asesorId: u.id, asesorNombre: u.name });
		// Alfabético: mismo criterio que ya trae el server (`asc(user.name)`),
		// para que "el primero" del default sea estable.
		return [...porId.values()].sort((a, b) =>
			a.asesorNombre.localeCompare(b.asesorNombre, "es"),
		);
	}, [asesoresConAgenda, usuariosConGestiones]);
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
	// La fila del RESUMEN (con métricas): solo existe si el snapshot ya
	// cerró. Puede no existir aunque `asesorId` sí (agenda de hoy, todavía
	// abierta, o asesor sin snapshot en absoluto agregado por
	// `usuariosConGestiones`) — la tarjeta distingue ambos casos con
	// `snapshotAbierto`.
	const filaSeleccionada =
		datos?.items.find((a) => a.asesorId === asesorId) ?? null;
	// true cuando SÍ hay snapshot para este asesor/día, está `abierto`, Y la
	// fecha es HOY — las tres condiciones juntas, no solo `estado`: el job de
	// cierre solo cierra la fecha inmediatamente anterior en cada corrida
	// (`cerrarSnapshotsAgenda(..., ayer, ...)` en
	// `jobs/agenda-cobros-snapshots.ts`), nunca vuelve a intentar un día
	// viejo — así que un snapshot `abierto` de una fecha PASADA es un cierre
	// que falló para siempre, no "en curso, se confirma esta noche" (esa
	// noche ya pasó) (hallazgo de code review, Codex).
	const esHoyGT = fecha === aFechaISO_GT(new Date());
	const snapshotAbierto =
		!filaSeleccionada &&
		esHoyGT &&
		asesoresConAgenda.some(
			(a) => a.asesorId === asesorId && a.estado === "abierto",
		);

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
							Agenda congelada a las 00:05 GT y evaluada al cierre del día.
						</p>
					</div>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Label htmlFor="cumplimiento-fecha" className="sr-only">
						Fecha de la agenda
					</Label>
					<CampoFecha
						id="cumplimiento-fecha"
						className="w-44"
						onChange={setFecha}
						placeholder="Último cierre"
						value={fecha}
					/>
					<Select
						value={asesorId ?? ""}
						onValueChange={setAsesorElegido}
						disabled={asesores.length === 0}
					>
						<SelectTrigger className="w-56">
							<SelectValue placeholder="Seleccionar asesor" />
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
					No se pudo cargar el cumplimiento de agenda. Intente de nuevo en unos
					segundos.
				</Card>
			) : usuariosQuery.isError || asesoresConAgendaQuery.isError ? (
				// Sin esto, un fallo de `getUsuariosConGestiones` o
				// `getAsesoresConAgenda` se disfrazaba de "sin resultados": ambos
				// caen a `[]` con `?? []`, así que `asesores` se armaba con un
				// catálogo incompleto en silencio — un asesor desaparecía del
				// selector como si de verdad no hubiera trabajado, en vez de "no
				// se pudo saber" (hallazgo de code review, Codex).
				<Card className="p-8 text-center text-red-600">
					No se pudo cargar el catálogo completo de asesores. Intente de nuevo
					en unos segundos.
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
							<TarjetaAgendaPlanificada
								asesorNombre={asesorSeleccionado.asesorNombre}
								agenda={
									filaSeleccionada
										? {
												tipo: "metricas",
												fila: filaSeleccionada,
												detalle: fecha ? (
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
												) : null,
											}
										: snapshotAbierto
											? { tipo: "en_curso" }
											: { tipo: "sin_evaluar" }
								}
							/>
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

/** Qué se puede afirmar de la agenda planificada de un asesor en un día. */
export type AgendaPlanificada =
	| { tipo: "metricas"; fila: ResumenFila; detalle?: React.ReactNode }
	| { tipo: "en_curso" }
	| { tipo: "sin_evaluar" };

/**
 * Tarjeta «Agenda planificada» de un asesor en un día: métricas del snapshot
 * cerrado (planificados, atendidos, pendientes, % y estado) con su detalle, o
 * por qué no se pueden mostrar. Presentación pura.
 */
export function TarjetaAgendaPlanificada({
	asesorNombre,
	agenda,
}: {
	asesorNombre: string;
	agenda: AgendaPlanificada;
}) {
	return (
		<Card className="overflow-hidden">
			{agenda.tipo === "metricas" ? (
				<>
					<div className="grid w-full grid-cols-2 items-center gap-4 px-4 py-3 text-left sm:grid-cols-[minmax(180px,1fr)_repeat(4,minmax(80px,auto))]">
						<span className="col-span-2 font-medium sm:col-span-1">
							{agenda.fila.asesorNombre}
						</span>
						<span className="text-center text-sm">
							<b>{agenda.fila.planificados}</b> planificados
						</span>
						<span className="text-center text-emerald-600 text-sm">
							<b>{agenda.fila.atendidos}</b> atendidos
						</span>
						<span className="text-center text-amber-600 text-sm">
							<b>{agenda.fila.pendientes}</b> pendientes
						</span>
						<span className="text-center font-semibold">
							{agenda.fila.porcentaje}%
							<Badge className="ml-2" variant="outline">
								{agenda.fila.estado}
							</Badge>
						</span>
					</div>
					{agenda.detalle}
				</>
			) : agenda.tipo === "en_curso" ? (
				// Agenda de HOY: existe snapshot pero sigue `abierto` (el
				// job de cierre corre a medianoche). `totalAtendidos`/% no
				// están disponibles todavía — mostrarlos en 0 sería un
				// dato engañoso, no incompleto — así que se avisa en vez
				// de afirmar "no tenía agenda" (hallazgo de code review,
				// Codex).
				<div className="px-4 py-6 text-center text-gray-500 text-sm">
					Agenda de {asesorNombre} en curso — los planificados/atendidos se
					confirman al cierre de esta noche.
				</div>
			) : (
				// Sin snapshot CERRADO y sin poder afirmar "en curso": puede ser
				// un asesor sin agenda planificada, o un snapshot `abierto`
				// de una fecha PASADA cuyo cierre falló para siempre (el
				// job solo reintenta AYER, nunca revisita días viejos — ver
				// la nota en `snapshotAbierto`), o directamente sin fila. En
				// los tres casos no hay forma de afirmar "no tenía agenda"
				// sin arriesgarse a mentir sobre un fallo de captura/cierre
				// silencioso — mismo criterio que `enAgenda: null` en el
				// bloque de gestiones (hallazgo de code review, Codex).
				<div className="px-4 py-6 text-center text-gray-500 text-sm">
					No se pudo evaluar la agenda planificada de {asesorNombre} para este
					día.
				</div>
			)}
		</Card>
	);
}

function sumarDiasISO(fecha: string, dias: number) {
	const [y, m, d] = fecha.split("-").map(Number);
	return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

const DIAS_SEMANA = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MESES = [
	"ene",
	"feb",
	"mar",
	"abr",
	"may",
	"jun",
	"jul",
	"ago",
	"sep",
	"oct",
	"nov",
	"dic",
];

/** «2026-10-06» → «mar 6 oct 2026». */
export function fechaLegible(fecha: string) {
	const [y, m, d] = fecha.split("-").map(Number);
	const dia = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
	return `${DIAS_SEMANA[dia]} ${d} ${MESES[m - 1] ?? ""} ${y}`;
}

/**
 * Navegación por día (← fecha →, selector de fecha y «Hoy»): con ella el
 * supervisor «se mueve entre agendas» de un asesor. No deja pasar de hoy.
 */
export function NavegacionDia({
	fecha,
	hoy,
	onFecha,
}: {
	fecha: string;
	/** Hoy en Guatemala (YYYY-MM-DD). */
	hoy: string;
	onFecha: (fecha: string) => void;
}) {
	return (
		<div className="flex flex-wrap items-center gap-2">
			<Button
				variant="outline"
				size="icon-sm"
				aria-label="Día anterior"
				onClick={() => onFecha(sumarDiasISO(fecha, -1))}
			>
				<ChevronLeft />
			</Button>
			<Label htmlFor="agenda-dia-fecha" className="sr-only">
				Fecha de la agenda
			</Label>
			<CampoFecha
				id="agenda-dia-fecha"
				className="h-8 w-44 px-3 text-[13px]"
				max={hoy}
				onChange={onFecha}
				value={fecha}
			/>
			<Button
				variant="outline"
				size="icon-sm"
				aria-label="Día siguiente"
				disabled={fecha >= hoy}
				onClick={() => onFecha(sumarDiasISO(fecha, 1))}
			>
				<ChevronRight />
			</Button>
			<Button
				variant="ghost"
				size="sm"
				disabled={fecha === hoy}
				onClick={() => onFecha(hoy)}
			>
				Hoy
			</Button>
		</div>
	);
}

/**
 * Cumplimiento de agenda de UN asesor en un día (pestaña Agenda del Detalle
 * del asesor). Es lo mismo que «Cumplimiento de agenda» con el asesor ya
 * elegido: navegación por día, tarjeta «Agenda planificada» con su detalle
 * paginado y «Gestiones registradas por {asesor}». Presentación pura.
 */
export function CumplimientoAgendaAsesorVista({
	nombre,
	fecha,
	hoy,
	onFecha,
	cargando,
	error,
	agenda,
	gestiones,
}: {
	nombre: string;
	/** Día elegido (YYYY-MM-DD) o `null` mientras se resuelve el último cierre. */
	fecha: string | null;
	hoy: string;
	onFecha: (fecha: string) => void;
	cargando: boolean;
	error: string | null;
	agenda: AgendaPlanificada | null;
	/** «Gestiones registradas por {asesor}» (GestionesDelDiaPanel o su vista). */
	gestiones: React.ReactNode;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-5">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="flex min-w-0 items-start gap-3">
					<CalendarCheck2 aria-hidden className="mt-0.5 size-6 text-brand" />
					<div className="flex min-w-0 flex-col gap-0.5">
						<h2 className="type-heading-sm text-fg">
							Cumplimiento de agenda
							{fecha ? (
								<span className="font-normal text-fg-secondary">
									{" "}
									· {fechaLegible(fecha)}
								</span>
							) : null}
						</h2>
						<p className="type-body-sm text-fg-secondary">
							Agenda congelada a las 00:05 GT y evaluada al cierre del día.
						</p>
					</div>
				</div>
				{fecha ? (
					<NavegacionDia fecha={fecha} hoy={hoy} onFecha={onFecha} />
				) : null}
			</div>

			{cargando || !fecha ? (
				<div className="flex justify-center py-16 text-fg-secondary">
					<Loader2 className="mr-2 h-5 w-5 animate-spin" /> Cargando…
				</div>
			) : error ? (
				<Card className="p-8 text-center text-danger-text">{error}</Card>
			) : (
				<>
					<div>
						<h3 className="mb-3 font-semibold text-fg-secondary text-sm uppercase tracking-wide">
							Agenda planificada
						</h3>
						{agenda ? (
							<TarjetaAgendaPlanificada asesorNombre={nombre} agenda={agenda} />
						) : null}
					</div>
					{gestiones}
				</>
			)}
		</div>
	);
}

/**
 * Contenedor de la pestaña Agenda: el cumplimiento de agenda del asesor
 * `userId` (`user.id` del CRM, el de `agenda_cobros_snapshots.asesor_id`) en
 * la fecha `fecha`. Sin fecha, abre el último día con agenda cerrada (como
 * «Cumplimiento de agenda»). Nunca consulta otro asesor: si no hay snapshot de
 * él ese día, lo dice.
 */
export function CumplimientoAgendaAsesor({
	userId,
	nombre,
	fecha,
	onFecha,
}: {
	userId: string;
	nombre: string;
	fecha: string | undefined;
	onFecha: (fecha: string) => void;
}) {
	const { data: session } = authClient.useSession();
	const userRole = session?.user?.role;
	const puedeConsultar = !!userRole && PERMISSIONS.canAssignCobros(userRole);
	// biome-ignore lint/suspicious/noExplicitAny: contrato manual por TS7056 del router raíz.
	const orpcAny = orpc as any;
	const hoy = aFechaISO_GT(new Date());

	// Último día con agenda cerrada (la misma consulta que usan el Dashboard y
	// Mi equipo): solo para el default cuando la URL no trae `?fecha=`.
	const ultimoQuery = useQuery({
		...orpcAny.getCumplimientoAgendaResumen.queryOptions({ input: {} }),
		enabled: !!session && puedeConsultar && !fecha,
	});
	const ultimo = ultimoQuery.data as ResumenData | undefined;
	const fechaEfectiva =
		fecha ??
		(ultimo ? (ultimo.fecha ?? hoy) : ultimoQuery.isError ? hoy : null);

	const resumenQuery = useQuery({
		...orpcAny.getCumplimientoAgendaResumen.queryOptions({
			input: { fecha: fechaEfectiva ?? undefined, asesorId: userId },
		}),
		enabled: !!session && puedeConsultar && !!fechaEfectiva,
	});
	const resumen = resumenQuery.data as ResumenData | undefined;
	// Snapshot del día (abierto o cerrado): distingue «en curso» de «no se pudo
	// evaluar», igual que en la vista del equipo.
	const snapshotsQuery = useQuery({
		...orpcAny.getAsesoresConAgenda.queryOptions({
			input: { fecha: fechaEfectiva },
		}),
		enabled: !!session && puedeConsultar && !!fechaEfectiva,
	});
	const snapshots = (snapshotsQuery.data ?? []) as AsesorConAgenda[];

	const fila = resumen?.items.find((a) => a.asesorId === userId) ?? null;
	// Ver la nota de `snapshotAbierto` en CumplimientoAgendaPanel: solo HOY un
	// snapshot abierto significa «en curso».
	const enCurso =
		!fila &&
		fechaEfectiva === hoy &&
		snapshots.some((a) => a.asesorId === userId && a.estado === "abierto");

	const agenda: AgendaPlanificada | null = !fechaEfectiva
		? null
		: fila
			? {
					tipo: "metricas",
					fila,
					detalle: (
						<DetalleAgenda
							key={`${fechaEfectiva}:${userId}`}
							asesorId={userId}
							fecha={fechaEfectiva}
						/>
					),
				}
			: enCurso
				? { tipo: "en_curso" }
				: { tipo: "sin_evaluar" };

	return (
		<CumplimientoAgendaAsesorVista
			nombre={nombre}
			fecha={fechaEfectiva}
			hoy={hoy}
			onFecha={onFecha}
			cargando={
				!fechaEfectiva || resumenQuery.isPending || snapshotsQuery.isPending
			}
			error={
				resumenQuery.isError
					? "No se pudo cargar el cumplimiento de agenda. Intente de nuevo en unos segundos."
					: snapshotsQuery.isError
						? `No se pudo consultar la agenda de ${nombre} para este día. Intente de nuevo en unos segundos.`
						: null
			}
			agenda={agenda}
			gestiones={
				fechaEfectiva ? (
					<GestionesDelDiaPanel
						key={`${fechaEfectiva}:${userId}`}
						fecha={fechaEfectiva}
						asesorId={userId}
						asesorNombre={nombre}
						esSupervisor={puedeConsultar}
					/>
				) : null
			}
		/>
	);
}
