import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	CalendarCheck2,
	ChevronDown,
	CircleCheck,
	CircleDashed,
	Loader2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
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
	items: DetalleItem[];
};

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
	const query = useQuery({
		...orpcAny.getCumplimientoAgendaDetalle.queryOptions({
			input: { fecha, asesorId },
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
		</div>
	);
}

export function CumplimientoAgendaPanel() {
	const { data: session, isPending: sesionCargando } = authClient.useSession();
	const userRole = session?.user?.role;
	const puedeConsultar = !!userRole && PERMISSIONS.canAssignCobros(userRole);
	const [fecha, setFecha] = useState("");
	const [asesorId, setAsesorId] = useState("todos");
	const [abierto, setAbierto] = useState<string | null>(null);
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

	const filas = useMemo(
		() =>
			(datos?.items ?? []).filter(
				(fila) => asesorId === "todos" || fila.asesorId === asesorId,
			),
		[asesorId, datos?.items],
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
		<div className="mx-auto max-w-6xl px-4 py-6">
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
						onChange={(event) => {
							setFecha(event.target.value);
							setAbierto(null);
							setAsesorId("todos");
						}}
						type="date"
						value={fecha}
					/>
					<Select value={asesorId} onValueChange={setAsesorId}>
						<SelectTrigger className="w-56">
							<SelectValue placeholder="Todos los asesores" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="todos">Todos los asesores</SelectItem>
							{(datos?.items ?? []).map((fila) => (
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
			) : filas.length === 0 ? (
				<Card className="p-8 text-center text-gray-500">
					Sin snapshots para fecha seleccionada.
				</Card>
			) : (
				<div className="space-y-3">
					{filas.map((fila) => {
						const expandido = abierto === fila.snapshotId;
						return (
							<Card className="overflow-hidden" key={fila.snapshotId}>
								<button
									aria-expanded={expandido}
									className="grid w-full grid-cols-[minmax(180px,1fr)_repeat(4,minmax(80px,auto))_24px] items-center gap-4 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50"
									onClick={() => setAbierto(expandido ? null : fila.snapshotId)}
									type="button"
								>
									<span className="font-medium">{fila.asesorNombre}</span>
									<span className="text-center text-sm">
										<b>{fila.planificados}</b> planificados
									</span>
									<span className="text-center text-emerald-600 text-sm">
										<b>{fila.atendidos}</b> atendidos
									</span>
									<span className="text-center text-amber-600 text-sm">
										<b>{fila.pendientes}</b> pendientes
									</span>
									<span className="text-center font-semibold">
										{fila.porcentaje}%
										<Badge className="ml-2" variant="outline">
											{fila.estado}
										</Badge>
									</span>
									<ChevronDown
										className={`h-4 w-4 transition-transform ${expandido ? "rotate-180" : ""}`}
									/>
								</button>
								{expandido && fecha && (
									<DetalleAgenda asesorId={fila.asesorId} fecha={fecha} />
								)}
							</Card>
						);
					})}
				</div>
			)}
		</div>
	);
}
