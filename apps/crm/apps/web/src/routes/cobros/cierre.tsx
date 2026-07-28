import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	AlertTriangle,
	ArrowDown,
	ArrowUp,
	ChevronDown,
	Loader2,
	Moon,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
import { PERMISSIONS } from "@/lib/roles";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/cobros/cierre")({
	component: CierreDiarioPage,
});

/** Hoy en Guatemala (YYYY-MM-DD) — el backend calcula todo en GT. */
function hoyGT() {
	return new Date().toLocaleDateString("sv-SE", {
		timeZone: "America/Guatemala",
	});
}

/** Lunes de la semana GT actual (YYYY-MM-DD), para el default del rango. */
function lunesDeEstaSemanaGT() {
	const [y, m, d] = hoyGT().split("-").map(Number);
	const hoy = new Date(Date.UTC(y, m - 1, d));
	const diaSemana = hoy.getUTCDay(); // 0=domingo
	const offset = diaSemana === 0 ? 6 : diaSemana - 1;
	const lunes = new Date(hoy);
	lunes.setUTCDate(hoy.getUTCDate() - offset);
	return lunes.toISOString().slice(0, 10);
}

// CB-020 (Codex, PR #1148): toLocaleDateString("es-GT") sin `timeZone`
// explícito usa la zona horaria LOCAL del navegador para decidir qué día
// es, no Guatemala — el string "es-GT" solo cambia el FORMATO (dd/mm/yyyy),
// no la zona horaria del cálculo. Un asesor en una zona horaria distinta ve
// un día distinto al que realmente se guardó. Mismo fix que $id.tsx.
function formatFechaGT(date: Date): string {
	return date.toLocaleDateString("es-GT", { timeZone: "America/Guatemala" });
}

// Etiquetas del funnel operativo (mismas que BUCKETS_FILTRO en
// reasignaciones.tsx). Un movimiento puede ir a cualquier bucket, por eso
// están los seis.
const BUCKET_LABEL: Record<number, string> = {
	0: "B0 · Cartera Sana",
	1: "B1 · Alerta Temprana",
	2: "B2 · Gestión Activa",
	3: "B3 · Rescate",
	4: "B4 · Última Instancia / Pre Jurídico",
	5: "B5 · Jurídico",
};

const estadoLabel: Record<string, string> = {
	contactado: "Contactado",
	no_contesta: "No contesta",
	numero_equivocado: "Número equivocado",
	promesa_pago: "Promesa de pago",
	acuerdo_parcial: "Acuerdo parcial",
	rechaza_pagar: "Rechaza pagar",
};

/**
 * Por qué un contacto no suma como efectivo. El orden importa: un envío del
 * sistema queda registrado como 'contactado' pero no es gestión del asesor, así
 * que ese motivo gana sobre el del estado.
 */
function motivoNoEfectivo(
	origen: string | null,
	estadoContacto: string | null,
): string {
	if (origen === "premora") return "Recordatorio automático";
	if (origen === "wsp_masivo") return "Envío masivo";
	if (estadoContacto === "promesa_pago") return "Cuenta como promesa";
	if (estadoContacto === "no_contesta") return "No contestó";
	if (estadoContacto === "numero_equivocado") return "Número equivocado";
	return "—";
}

interface CierreFila {
	asesorId: string;
	asesorNombre: string;
	contactosEfectivos: number;
	promesasObtenidas: number;
	totalContactos: number;
	/** Créditos que SALIERON del bucket del asesor ese día. */
	subieron: number;
	bajaron: number;
	/** Buckets del pool al que está asignado el asesor (estado actual). */
	bucketsPool: number[];
}

function CierreDiarioPage() {
	const { data: session, isPending: sesionCargando } = authClient.useSession();
	const userRole = session?.user?.role;

	const [fechaInicio, setFechaInicio] = useState(lunesDeEstaSemanaGT);
	const [fechaFin, setFechaFin] = useState(hoyGT);
	const [asesorId, setAsesorId] = useState<string>("todos");
	// Fila del acordeón abierta (una a la vez).
	const [abierto, setAbierto] = useState<string | null>(null);

	const query = useQuery({
		...orpc.getCierreDiarioPorRango.queryOptions({
			input: { fechaInicio, fechaFin },
		}),
		enabled: !!session,
	});

	// Solo asesores con cierre generado en el rango elegido — no el catálogo
	// completo de usuarios de cobros (la mayoría no tendría filas que mostrar).
	const asesoresConCierre = (query.data ?? []) as CierreFila[];
	const filas = asesoresConCierre.filter(
		(f) => asesorId === "todos" || f.asesorId === asesorId,
	);

	if (sesionCargando) {
		return (
			<div className="flex min-h-screen items-center justify-center text-gray-500">
				<Loader2 className="mr-2 h-5 w-5 animate-spin" />
				Cargando…
			</div>
		);
	}

	if (!userRole || !PERMISSIONS.canAssignCobros(userRole)) {
		return (
			<div className="flex min-h-screen items-center justify-center">
				<div className="text-center">
					<h1 className="mb-4 font-bold text-2xl text-gray-800">
						Acceso Denegado
					</h1>
					<p className="text-gray-600">
						Solo supervisores pueden ver el cierre diario.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="mx-auto max-w-6xl px-4 py-6">
			<div className="mb-6 flex flex-wrap items-center justify-between gap-4">
				<div className="flex items-center gap-3">
					<Moon className="h-7 w-7 text-indigo-500" />
					<div>
						<h1 className="font-bold text-2xl text-gray-900 dark:text-gray-100">
							Cierre diario
						</h1>
						<p className="text-gray-500 text-sm">
							Gestión de cada asesor por rango de fechas. Se genera todos los
							días a las 22:00 GT.
						</p>
					</div>
				</div>
				<div className="flex items-center gap-2">
					{query.isFetching && !query.isPending && (
						<Loader2 className="h-4 w-4 animate-spin text-gray-400" />
					)}
					<label className="text-gray-500 text-sm" htmlFor="cierre-desde">
						Desde
					</label>
					<input
						className="rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800"
						id="cierre-desde"
						max={hoyGT()}
						onChange={(e) => {
							const valor = e.target.value;
							setFechaInicio(valor);
							// Un rango invertido (inicio > fin) devuelve vacío en silencio
							// y se lee como "el job no corrió" — se evita en la fuente.
							if (valor > fechaFin) setFechaFin(valor);
						}}
						type="date"
						value={fechaInicio}
					/>
					<label className="text-gray-500 text-sm" htmlFor="cierre-hasta">
						Hasta
					</label>
					<input
						className="rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800"
						id="cierre-hasta"
						max={hoyGT()}
						min={fechaInicio}
						onChange={(e) => setFechaFin(e.target.value)}
						type="date"
						value={fechaFin}
					/>
				</div>
			</div>

			<div className="mb-4">
				<Select value={asesorId} onValueChange={setAsesorId}>
					<SelectTrigger className="w-56">
						<SelectValue placeholder="Todos los asesores" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="todos">Todos los asesores</SelectItem>
						{asesoresConCierre.map((a) => (
							<SelectItem key={a.asesorId} value={a.asesorId}>
								{a.asesorNombre}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{query.isError && (
				<Card className="border-red-300 bg-red-50 dark:bg-red-950/30">
					<CardContent className="flex items-center gap-2 py-4 text-red-700 dark:text-red-300">
						<AlertTriangle className="h-5 w-5" />
						No se pudo cargar el cierre diario. Reintenta en unos segundos.
					</CardContent>
				</Card>
			)}

			{query.isPending && (
				<div className="flex items-center justify-center py-20 text-gray-500">
					<Loader2 className="mr-2 h-5 w-5 animate-spin" />
					Cargando cierre…
				</div>
			)}

			{!query.isError && !query.isPending && filas.length === 0 && (
				<p className="py-20 text-center text-gray-400 text-sm">
					No hay cierre generado en este rango.
				</p>
			)}

			<div className="space-y-2">
				{filas.map((fila) => (
					<FilaAsesor
						abierto={abierto === fila.asesorId}
						fecha={{ inicio: fechaInicio, fin: fechaFin }}
						fila={fila}
						key={fila.asesorId}
						onToggle={() =>
							setAbierto(abierto === fila.asesorId ? null : fila.asesorId)
						}
					/>
				))}
			</div>
		</div>
	);
}

function FilaAsesor({
	fila,
	abierto,
	onToggle,
	fecha,
}: {
	fila: CierreFila;
	abierto: boolean;
	onToggle: () => void;
	fecha: { inicio: string; fin: string };
}) {
	const navigate = useNavigate();
	const detalle = useQuery({
		...orpc.getDetalleCierrePorAsesor.queryOptions({
			input: {
				asesorId: fila.asesorId,
				fechaInicio: fecha.inicio,
				fechaFin: fecha.fin,
			},
		}),
		enabled: abierto,
		// Es snapshot ya generado por el job (no dato vivo) — no hace falta
		// refetch al cerrar/reabrir la misma fila. Mismo criterio que reportes.tsx.
		staleTime: 5 * 60 * 1000,
	});

	const contactos = (detalle.data ?? []).filter((d) => d.tipo === "contacto");
	const movimientos = (detalle.data ?? []).filter(
		(d) => d.tipo === "subida" || d.tipo === "bajada",
	);

	const irACaso = (numeroCreditoSifco: string | null) => {
		if (!numeroCreditoSifco) return;
		navigate({
			to: "/cobros/$id",
			params: { id: numeroCreditoSifco },
			search: { tipo: "caso" },
		});
	};

	return (
		<Card className="overflow-hidden">
			<button
				aria-expanded={abierto}
				className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50"
				onClick={onToggle}
				type="button"
			>
				<span className="flex items-center gap-2">
					<span className="font-medium text-gray-900 dark:text-gray-100">
						{fila.asesorNombre}
					</span>
					{/* Pool de buckets al que está asignado el asesor (estado actual). */}
					{fila.bucketsPool.length > 0 ? (
						fila.bucketsPool.map((b) => (
							<Badge
								className="border-gray-300 bg-gray-50 font-normal text-gray-600 text-xs dark:bg-gray-800 dark:text-gray-300"
								key={b}
								variant="outline"
							>
								B{b}
							</Badge>
						))
					) : (
						<span className="text-gray-400 text-xs">Sin pool asignado</span>
					)}
				</span>
				<div className="flex items-center gap-4">
					{/* Efectivos sobre el total de contactos registrados: de N intentos,
					    en M le contestaron. */}
					<span className="text-gray-600 text-sm dark:text-gray-300">
						<span className="font-medium text-gray-900 dark:text-gray-100">
							{fila.contactosEfectivos}/{fila.totalContactos}
						</span>{" "}
						efectivos
					</span>
					<span className="text-gray-600 text-sm dark:text-gray-300">
						{fila.promesasObtenidas} promesas
					</span>
					<span
						className="flex items-center gap-1 text-red-600 text-sm dark:text-red-400"
						title="Créditos que subieron de bucket saliendo del suyo"
					>
						<ArrowUp className="h-3.5 w-3.5" />
						{fila.subieron}
					</span>
					<span
						className="flex items-center gap-1 text-emerald-600 text-sm dark:text-emerald-400"
						title="Créditos que bajaron de bucket saliendo del suyo"
					>
						<ArrowDown className="h-3.5 w-3.5" />
						{fila.bajaron}
					</span>
					<ChevronDown
						className={`h-4 w-4 text-gray-400 transition-transform ${
							abierto ? "rotate-180" : ""
						}`}
					/>
				</div>
			</button>

			{abierto && (
				<div className="border-t">
					{detalle.isPending ? (
						<div className="flex items-center gap-2 px-4 py-6 text-gray-500 text-sm">
							<Loader2 className="h-4 w-4 animate-spin" />
							Cargando detalle…
						</div>
					) : (
						<div className="space-y-4 px-4 py-3">
							<section>
								<h3 className="mb-2 font-semibold text-gray-700 text-sm dark:text-gray-200">
									Contactos
								</h3>
								{contactos.length > 0 ? (
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Crédito</TableHead>
												<TableHead>Fecha</TableHead>
												<TableHead>Estado</TableHead>
												<TableHead>Efectivo</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{contactos.map((c) => (
												<TableRow
													className={
														c.numeroCreditoSifco ? "cursor-pointer" : undefined
													}
													key={c.id}
													onClick={() => irACaso(c.numeroCreditoSifco)}
												>
													<TableCell>{c.numeroCreditoSifco ?? "—"}</TableCell>
													<TableCell>
														{c.fechaContacto
															? formatFechaGT(new Date(c.fechaContacto))
															: "—"}
													</TableCell>
													<TableCell>
														{c.estadoContacto
															? (estadoLabel[c.estadoContacto] ??
																c.estadoContacto)
															: "—"}
													</TableCell>
													<TableCell>
														{c.esEfectivoManual ? (
															<span className="font-medium text-emerald-600 dark:text-emerald-400">
																Sí
															</span>
														) : (
															<span className="text-gray-400 text-xs">
																{motivoNoEfectivo(c.origen, c.estadoContacto)}
															</span>
														)}
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								) : (
									<p className="text-gray-400 text-sm">
										Sin contactos en este rango.
									</p>
								)}
							</section>

							<section>
								<h3 className="mb-2 font-semibold text-gray-700 text-sm dark:text-gray-200">
									Movimientos de bucket
								</h3>
								{movimientos.length > 0 ? (
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Crédito</TableHead>
												<TableHead>Movimiento</TableHead>
												<TableHead>Salió de</TableHead>
												<TableHead>Llegó a</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{movimientos.map((m) => (
												<TableRow
													className={
														m.numeroCreditoSifco ? "cursor-pointer" : undefined
													}
													key={m.id}
													onClick={() => irACaso(m.numeroCreditoSifco)}
												>
													<TableCell>{m.numeroCreditoSifco ?? "—"}</TableCell>
													<TableCell>
														{m.tipo === "subida" ? (
															<span className="flex items-center gap-1 text-red-600 dark:text-red-400">
																<ArrowUp className="h-3.5 w-3.5" />
																Subió
															</span>
														) : (
															<span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
																<ArrowDown className="h-3.5 w-3.5" />
																Bajó
															</span>
														)}
													</TableCell>
													<TableCell className="text-gray-500 text-sm">
														{m.bucketAnterior != null
															? (BUCKET_LABEL[m.bucketAnterior] ??
																`B${m.bucketAnterior}`)
															: "—"}
													</TableCell>
													<TableCell className="text-sm">
														{m.bucket != null
															? (BUCKET_LABEL[m.bucket] ?? `B${m.bucket}`)
															: "—"}
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								) : (
									<p className="text-gray-400 text-sm">
										Sin movimientos de bucket en este rango.
									</p>
								)}
							</section>
						</div>
					)}
				</div>
			)}
		</Card>
	);
}
