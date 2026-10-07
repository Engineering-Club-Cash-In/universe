import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type * as React from "react";
import { useState } from "react";
import {
	CoberturasVista,
	type FilaCobertura,
} from "@/components/cobros/coberturas-panel";
import {
	AccionesEquipo,
	ModalesEquipo,
} from "@/components/cobros/equipo/acciones-equipo";
import { AsignacionVista } from "@/components/cobros/equipo/asignacion/carga-asignacion";
import {
	type CargaData,
	type CargaDetalle,
	CargaResumenVista,
} from "@/components/cobros/equipo/asignacion/carga-resumen-vista";
import { EditarCapacidadVista } from "@/components/cobros/equipo/asignacion/editar-capacidad-dialog";
import {
	type FilaReasignacion,
	HistorialReasignacionesVista,
} from "@/components/cobros/equipo/asignacion/historial-reasignaciones";
import {
	type FilaTraslado,
	HistorialTrasladosVista,
} from "@/components/cobros/equipo/asignacion/historial-traslados";
import type { AsesorTraslado } from "@/components/cobros/equipo/asignacion/selector-asesor";
import { TrasladarDialogMarco } from "@/components/cobros/equipo/asignacion/trasladar-dialog";
import {
	type AsignacionPreview,
	type ModoTraslado,
	type PreviewTraslado,
	type RazonTraslado,
	TrasladoVista,
	type TrasladoVistaProps,
} from "@/components/cobros/equipo/asignacion/trasladar-vista";
import type { SeccionHistorial } from "@/components/cobros/equipo/search";
import { Button } from "@/components/ui/button";
import { dialogPanelClassName } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { orpc } from "@/utils/orpc";
import { ShowcaseGroup } from "./_layout";

/**
 * Datos y demos de «Mi equipo» › Carga y asignación y de los modales
 * «Trasladar cartera» y «Editar capacidad» para
 * `cobros-mi-equipo.showcase.tsx` (agente D2; el Día vive en
 * `_mi-equipo-dia.tsx`). Todo sale de datos de ejemplo coherentes con las
 * tarjetas de la pestaña Asesores (mismo equipo y mismas carteras).
 */

const nada = () => {};

/* ── Equipo y carga ───────────────────────────────────────────────────────── */

const asesorPool = (
	asesor_id: number,
	nombre: string,
	buckets: number[],
	activo = true,
): AsesorTraslado => ({
	asesor_id,
	nombre,
	buckets,
	activo,
	email_cash_in: null,
	userId: `u${asesor_id}`,
	usuarioHabilitado: true,
});

/** Catálogo `getAsesoresTraslados` de ejemplo (el equipo de la pestaña Asesores). */
export const POOL: AsesorTraslado[] = [
	asesorPool(1, "Carlos Ramírez", [2, 3]),
	asesorPool(2, "Andrea Solís", [2, 3]),
	asesorPool(3, "Marta Gómez", [2, 3]),
	asesorPool(4, "Luis Fernández", [4, 5]),
	asesorPool(5, "María López", [1]),
	asesorPool(6, "José Pérez", [1]),
	asesorPool(7, "Ana Díaz", [0, 1]),
	asesorPool(8, "Diego Morales", [1]),
];

const NOMBRES: Record<number, string> = Object.fromEntries(
	POOL.map((a) => [a.asesor_id, a.nombre]),
);

const fila = (
	bucket: number,
	cuentas: number,
	capacidad: number,
	extra: Partial<CargaDetalle> = {},
): CargaDetalle => {
	const margen = extra.margen_alerta_valor ?? 10;
	const tipo = extra.margen_alerta_tipo ?? "porcentaje";
	const umbral =
		capacidad + (tipo === "porcentaje" ? (capacidad * margen) / 100 : margen);
	return {
		bucket,
		cuentas,
		capacidad_base: capacidad,
		utilizacion_pct: (cuentas / capacidad) * 100,
		elegible: true,
		sobrecarga: cuentas > capacidad,
		alerta_nueva_posicion: cuentas >= umbral,
		margen_alerta_tipo: tipo,
		margen_alerta_valor: margen,
		...extra,
	};
};

const POR_ASESOR: CargaData["porAsesor"] = [
	[1, [fila(2, 20, 30), fila(3, 8, 20)]],
	[2, [fila(2, 22, 30), fila(3, 8, 20)]],
	[3, [fila(2, 24, 20), fila(3, 10, 12)]],
	[4, [fila(4, 19, 25), fila(5, 8, 10)]],
	[5, [fila(1, 32, 40)]],
	[6, [fila(1, 30, 40)]],
	[7, [fila(0, 10, 20, { elegible: false }), fila(1, 18, 30)]],
	[
		8,
		[
			fila(1, 35, 35, {
				margen_alerta_tipo: "fijo",
				margen_alerta_valor: 0,
			}),
		],
	],
].map(([id, porBucket]) => ({
	asesor_id: id as number,
	nombre: NOMBRES[id as number],
	email_asesor: null,
	porBucket: porBucket as CargaDetalle[],
}));

const NOMBRES_BUCKET = [
	"Cartera Sana",
	"Alerta Temprana",
	"Gestión Activa",
	"Rescate",
	"Última Instancia / Pre Jurídico",
	"Jurídico",
];

export const CARGA: CargaData = {
	porAsesor: POR_ASESOR,
	buckets: NOMBRES_BUCKET.map((nombre, numero) => {
		const filas = POR_ASESOR.flatMap((a) => a.porBucket).filter(
			(d) => d.bucket === numero,
		);
		return {
			numero,
			prefijo: `B${numero}`,
			nombre,
			color: null,
			cuentas_totales: filas.reduce((t, d) => t + d.cuentas, 0),
			asesores_en_pool: filas.length,
			asesores_en_alerta: filas.filter((d) => d.alerta_nueva_posicion).length,
			asesores_sobrecargados: filas.filter((d) => d.sobrecarga).length,
		};
	}),
};

/* ── Historial ────────────────────────────────────────────────────────────── */

const REASIGNACIONES: FilaReasignacion[] = [
	{
		historial_id: 1,
		fecha: "2026-10-06T15:20:00Z",
		numero_credito_sifco: "01010214147120",
		cliente: "Roberto Cárcamo",
		asesor_anterior: "Marta Gómez",
		asesor_nuevo: "Carlos Ramírez",
		bucket: 2,
		bucket_prefijo: "B2",
		bucket_nombre: "Gestión Activa",
		origen: "API_MANUAL",
		motivo: "Redistribución por carga",
		usuario: "supervisor@clubcashin.com",
	},
	{
		historial_id: 2,
		fecha: "2026-10-06T06:00:00Z",
		numero_credito_sifco: "01010214151881",
		cliente: "Lucía Herrera",
		asesor_anterior: "María López",
		asesor_nuevo: "Andrea Solís",
		bucket: 2,
		bucket_prefijo: "B2",
		bucket_nombre: "Gestión Activa",
		origen: "PROCESO_AUTO",
		motivo: null,
		usuario: null,
	},
	{
		historial_id: 3,
		fecha: "2026-10-05T21:45:00Z",
		numero_credito_sifco: "01010214139002",
		cliente: "Sofía Marroquín",
		asesor_anterior: null,
		asesor_nuevo: "Luis Fernández",
		bucket: 4,
		bucket_prefijo: "B4",
		bucket_nombre: "Última Instancia / Pre Jurídico",
		origen: "API_MANUAL",
		motivo: "Recuperación del vehículo aprobada",
		usuario: "andrea.supervisora@clubcashin.com",
	},
];

const TRASLADOS: FilaTraslado[] = [
	{
		id: "6f1c2a8e-4b7d-4c1e-9a2f-3d5e7b9c1a04",
		created_at: "2026-10-06T16:05:00Z",
		asesor_origen_id: 8,
		cuentas: 31,
		motivo: "Renuncia: último día el 3 de octubre",
		actor_email: "supervisor@clubcashin.com",
	},
	{
		id: "0b9e4d21-77aa-4f0c-8d3e-5c2b1a9f6e88",
		created_at: "2026-09-29T14:30:00Z",
		asesor_origen_id: 3,
		cuentas: 12,
		motivo: "Redistribución operativa: balancear B2",
		actor_email: "supervisor@clubcashin.com",
	},
];

const COBERTURAS: FilaCobertura[] = [
	{
		id: "c1",
		titularId: "u8",
		suplenteId: "u5",
		desde: "2026-10-05",
		hasta: "2026-10-16",
		motivo: "vacaciones",
		canceladaEn: null,
	},
	{
		id: "c2",
		titularId: "u3",
		suplenteId: "u1",
		desde: "2026-09-28",
		hasta: "2026-09-30",
		motivo: "permiso",
		canceladaEn: null,
	},
	{
		id: "c3",
		titularId: "u6",
		suplenteId: "u7",
		desde: "2026-10-12",
		hasta: "2026-10-13",
		motivo: "permiso",
		canceladaEn: "2026-10-04T15:00:00Z",
	},
];

const nombrePorUsuario = (userId: string) =>
	POOL.find((a) => a.userId === userId)?.nombre ?? userId;

function HistorialDemo({ seccion }: { seccion: SeccionHistorial }) {
	const [pagina, setPagina] = useState(1);
	const [origen, setOrigen] = useState("todos");
	const [bucket, setBucket] = useState("todos");
	const [asesor, setAsesor] = useState("todos");
	const [sifco, setSifco] = useState("");
	const [desde, setDesde] = useState("2026-09-28");
	const [hasta, setHasta] = useState("2026-10-16");
	if (seccion === "traslados") {
		return (
			<HistorialTrasladosVista
				filas={TRASLADOS}
				nombre={(id) => NOMBRES[id] ?? String(id)}
				cargando={false}
				error={false}
				pagina={pagina}
				onPagina={setPagina}
			/>
		);
	}
	if (seccion === "coberturas") {
		return (
			<CoberturasVista
				filtroDesde={desde}
				filtroHasta={hasta}
				onFiltroDesde={setDesde}
				onFiltroHasta={setHasta}
				onConsultar={nada}
				filas={COBERTURAS}
				cargando={false}
				error={false}
				nombre={nombrePorUsuario}
				hoy="2026-10-07"
				cancelando={false}
				errorCancelar={null}
				onCancelar={nada}
			/>
		);
	}
	return (
		<HistorialReasignacionesVista
			origen={origen}
			onOrigen={setOrigen}
			bucket={bucket}
			onBucket={setBucket}
			asesor={asesor}
			onAsesor={setAsesor}
			asesores={POOL.map((a) => ({ asesorId: a.asesor_id, nombre: a.nombre }))}
			errorAsesores={false}
			sifco={sifco}
			onSifco={setSifco}
			onBuscar={nada}
			resumen={{ total: 43, manuales: 12, automaticos: 31 }}
			filas={REASIGNACIONES}
			cargando={false}
			error={false}
			pagina={pagina}
			totalPaginas={3}
			onPagina={setPagina}
		/>
	);
}

/** Pestaña Carga y asignación de la página completa (interactiva). */
export function DemoAsignacion({
	esAdmin = true,
	seccionInicial = "reasignaciones",
}: {
	esAdmin?: boolean;
	seccionInicial?: SeccionHistorial;
}) {
	const [seccion, setSeccion] = useState<SeccionHistorial>(seccionInicial);
	return (
		<AsignacionVista
			resumen={
				<CargaResumenVista
					data={CARGA}
					cargando={false}
					error={false}
					esAdmin={esAdmin}
					onEditarCapacidad={nada}
					onTrasladar={nada}
					onMarcarAusente={nada}
				/>
			}
			seccion={seccion}
			onSeccion={setSeccion}
			historial={<HistorialDemo key={seccion} seccion={seccion} />}
		/>
	);
}

/* ── Traslado: vista previa de ejemplo ────────────────────────────────────── */

const CLIENTES = [
	"Roberto Cárcamo",
	"Lucía Herrera",
	"Sofía Marroquín",
	"Diego Herrera",
	"Ana Lucía Morales",
	"Marvin Castillo",
	"María José Contreras",
	"Luis Fernando Aguilar",
];

/** Marta Gómez (B2 24 · B3 10) repartida entre Carlos y Andrea. */
function asignacionesDeEjemplo(): AsignacionPreview[] {
	const lista: AsignacionPreview[] = [];
	const reparto: [number, number, number][] = [
		[2, 1, 10],
		[2, 2, 14],
		[3, 1, 5],
		[3, 2, 5],
	];
	let n = 0;
	for (const [bucket, asesorNuevoId, cuentas] of reparto) {
		for (let i = 0; i < cuentas; i++) {
			n++;
			lista.push({
				creditoId: 47000 + n,
				numeroCreditoSifco: `010102141${String(47000 + n).padStart(5, "0")}`,
				cliente: CLIENTES[n % CLIENTES.length],
				asesorAnteriorId: 3,
				asesorNuevoId,
				bucket,
				prioridad: n % 6 === 0 ? 0 : 1,
			});
		}
	}
	lista.push(
		{
			creditoId: 46001,
			numeroCreditoSifco: "01010214146001",
			cliente: "Elena Ruiz",
			asesorAnteriorId: 3,
			asesorNuevoId: 1,
			bucket: null,
			prioridad: 1,
			estadoEspecial: "CANCELADO",
		},
		{
			creditoId: 46002,
			numeroCreditoSifco: "01010214146002",
			cliente: "Marco Polanco",
			asesorAnteriorId: 3,
			asesorNuevoId: 1,
			bucket: null,
			prioridad: 1,
			estadoEspecial: "CAIDO",
		},
	);
	return lista;
}

const PREVIEW: PreviewTraslado = {
	previewId: "4d0f5c1e-1b2a-4c3d-8e9f-0a1b2c3d4e5f",
	venceEn: "2099-01-01T16:42:00Z",
	asignaciones: asignacionesDeEjemplo(),
	bloqueos: [],
	excluidos: [],
	carga: [
		{
			asesorId: 1,
			nombre: "Carlos Ramírez",
			bucket: 2,
			antes: 20,
			despues: 30,
			capacidad: 30,
		},
		{
			asesorId: 2,
			nombre: "Andrea Solís",
			bucket: 2,
			antes: 22,
			despues: 36,
			capacidad: 30,
		},
		{
			asesorId: 1,
			nombre: "Carlos Ramírez",
			bucket: 3,
			antes: 8,
			despues: 13,
			capacidad: 20,
		},
		{
			asesorId: 2,
			nombre: "Andrea Solís",
			bucket: 3,
			antes: 8,
			despues: 13,
			capacidad: 20,
		},
		{
			asesorId: 3,
			nombre: "Marta Gómez",
			bucket: 2,
			antes: 24,
			despues: 0,
			capacidad: 20,
		},
		{
			asesorId: 3,
			nombre: "Marta Gómez",
			bucket: 3,
			antes: 10,
			despues: 0,
			capacidad: 12,
		},
	],
};

/** Variante con problemas: venció, bloqueos, créditos sin destino y 8 receptores. */
const PREVIEW_PROBLEMAS: PreviewTraslado = {
	...PREVIEW,
	venceEn: "2026-01-01T00:00:00Z",
	asignaciones: [
		...PREVIEW.asignaciones,
		...[5, 6, 7, 8].flatMap((asesorNuevoId, i) =>
			Array.from({ length: 3 + i }, (_, k) => ({
				creditoId: 48000 + asesorNuevoId * 10 + k,
				numeroCreditoSifco: `0101021414${8000 + asesorNuevoId * 10 + k}`,
				cliente: CLIENTES[k % CLIENTES.length],
				asesorAnteriorId: 3,
				asesorNuevoId,
				bucket: 1,
				prioridad: 1 as const,
			})),
		),
		...[0, 4, 5].map((bucket) => ({
			creditoId: 49000 + bucket,
			numeroCreditoSifco: `0101021414900${bucket}`,
			cliente: CLIENTES[bucket],
			asesorAnteriorId: 3,
			asesorNuevoId: bucket === 0 ? 7 : 4,
			bucket,
			prioridad: 1 as const,
		})),
	],
	bloqueos: [
		{ bucket: 3, creditoId: 47031, razon: "destino_no_elegible" },
		{ bucket: 3, creditoId: 47032, razon: "sin_asesor_elegible" },
	],
	excluidos: [
		{
			creditoId: 45990,
			razon: "sin_bucket",
			numeroCreditoSifco: "01010214145990",
			cliente: "Sergio Díaz",
			estado: "MOROSO",
		},
	],
	carga: [
		...PREVIEW.carga,
		...[5, 6, 7, 8].map((asesorId, i) => ({
			asesorId,
			nombre: NOMBRES[asesorId],
			bucket: 1,
			antes: 30,
			despues: 33 + i,
			capacidad: 40,
		})),
		{
			asesorId: 7,
			nombre: "Ana Díaz",
			bucket: 0,
			antes: 10,
			despues: 11,
			capacidad: 20,
		},
		{
			asesorId: 4,
			nombre: "Luis Fernández",
			bucket: 4,
			antes: 19,
			despues: 20,
			capacidad: 25,
		},
		{
			asesorId: 4,
			nombre: "Luis Fernández",
			bucket: 5,
			antes: 8,
			despues: 9,
			capacidad: 10,
		},
	],
};

const capacidadEnBucket = (asesorId: number, bucket: number) => {
	const d = CARGA.porAsesor
		.find((a) => a.asesor_id === asesorId)
		?.porBucket.find((x) => x.bucket === bucket);
	return d ? { cuentas: d.cuentas, capacidad: d.capacidad_base } : null;
};

const capacidadEn = (asesorId: number, buckets: number[]) => {
	const filas = CARGA.porAsesor
		.find((a) => a.asesor_id === asesorId)
		?.porBucket.filter((d) => buckets.includes(d.bucket));
	return filas?.length
		? {
				cuentas: filas.reduce((t, d) => t + d.cuentas, 0),
				capacidad: filas.reduce((t, d) => t + d.capacidad_base, 0),
			}
		: null;
};

const MARTA = POOL[2];

/** Props de la vista con Marta Gómez como origen (B2 24 · B3 10). */
function propsTraslado(
	cambios: Partial<TrasladoVistaProps> = {},
): TrasladoVistaProps {
	const modo = cambios.modo ?? "redistribucion";
	return {
		paso: "formulario",
		cargando: false,
		errorCarga: false,
		onReintentar: nada,
		ocupado: false,
		asesores: POOL,
		origen: "3",
		onOrigen: nada,
		origenInfo: {
			nombre: MARTA.nombre,
			activo: true,
			buckets: MARTA.buckets,
			porBucket: [
				{ bucket: 2, cuentas: 24 },
				{ bucket: 3, cuentas: 10 },
			],
		},
		modo,
		onModo: nada,
		destino: "",
		onDestino: nada,
		destinos: POOL.filter(
			(a) => a.asesor_id !== 3 && [2, 3].every((b) => a.buckets.includes(b)),
		).map((asesor) => ({
			asesor,
			capacidad: capacidadEn(asesor.asesor_id, [2, 3]),
		})),
		cargandoBucketsOrigen: false,
		bucketsOrigen: [2, 3],
		destinosPorBucket: {},
		onDestinoBucket: nada,
		candidatosPorBucket: {
			2: POOL.filter((a) => a.asesor_id !== 3 && a.buckets.includes(2)),
			3: POOL.filter((a) => a.asesor_id !== 3 && a.buckets.includes(3)),
		},
		capacidadEnBucket,
		destinoEspecial: "",
		onDestinoEspecial: nada,
		candidatosEspecial: POOL.filter((a) => a.asesor_id !== 3),
		requiereDestinoEspecial: false,
		razon: "redistribucion",
		onRazon: nada,
		detalle: "",
		onDetalle: nada,
		errorFormulario: null,
		errorPrevisualizar: null,
		previsualizando: false,
		onCancelar: nada,
		onRevisar: nada,
		preview: null,
		vencido: false,
		nombres: NOMBRES,
		puedeConfirmar: false,
		pagina: 1,
		onPagina: nada,
		errorConfirmar: null,
		confirmando: false,
		onAtras: nada,
		onConfirmar: nada,
		resultado: null,
		onListo: nada,
		...cambios,
	};
}

/** Los tres pasos, interactivos, con datos de ejemplo. */
function useTrasladoDemo(): TrasladoVistaProps {
	const [paso, setPaso] = useState<TrasladoVistaProps["paso"]>("formulario");
	const [modo, setModo] = useState<ModoTraslado>("redistribucion");
	const [razon, setRazon] = useState<RazonTraslado>("redistribucion");
	const [destino, setDestino] = useState("");
	const [porBucket, setPorBucket] = useState<Record<number, string>>({});
	const [especial, setEspecial] = useState("");
	const [detalle, setDetalle] = useState("");
	const [pagina, setPagina] = useState(1);
	const requiere = razon === "despido" || razon === "renuncia";
	const error =
		razon === "otro" && !detalle.trim()
			? "Seleccione un motivo y complete la explicación."
			: modo === "traslado_completo" && !destino
				? "Seleccione un asesor de destino."
				: requiere && !especial
					? "Seleccione un responsable para las cuentas sin bucket operativo."
					: modo === "destino_por_bucket" && (!porBucket[2] || !porBucket[3])
						? `Seleccione un asesor de destino para B${porBucket[2] ? 3 : 2}.`
						: null;
	return propsTraslado({
		paso,
		modo,
		onModo: (m) => {
			setModo(m);
			setDestino("");
			setPorBucket({});
		},
		destino,
		onDestino: setDestino,
		destinosPorBucket: porBucket,
		onDestinoBucket: (b, v) => setPorBucket((x) => ({ ...x, [b]: v })),
		destinoEspecial: especial,
		onDestinoEspecial: setEspecial,
		requiereDestinoEspecial: requiere,
		razon,
		onRazon: setRazon,
		detalle,
		onDetalle: setDetalle,
		errorFormulario: error,
		onRevisar: () => setPaso("revision"),
		preview: PREVIEW,
		puedeConfirmar: true,
		pagina,
		onPagina: setPagina,
		onAtras: () => setPaso("formulario"),
		onConfirmar: () => setPaso("resultado"),
		resultado: { cuentas: 36, operacionId: PREVIEW.previewId },
		onListo: () => setPaso("formulario"),
	});
}

function PanelTraslado({ children }: { children: React.ReactNode }) {
	return (
		<div className={cn(dialogPanelClassName, "max-w-140")}>{children}</div>
	);
}

function DemoTrasladoPasos() {
	return (
		<PanelTraslado>
			<TrasladoVista {...useTrasladoDemo()} />
		</PanelTraslado>
	);
}

/* ── Modales reales ───────────────────────────────────────────────────────── */

/**
 * Caché de ejemplo (sin servidor) para el `TrasladosPanel` y el formulario de
 * ausencia reales: catálogo de asesores, cartera de Marta Gómez y la carga del
 * equipo (capacidad de los destinos).
 */
const clienteDemo = new QueryClient({
	defaultOptions: {
		queries: { staleTime: Number.POSITIVE_INFINITY, retry: false },
		mutations: { retry: false },
	},
});
clienteDemo.setQueryData(
	orpc.getAsesoresTraslados.queryOptions().queryKey,
	POOL as never,
);
clienteDemo.setQueryData(
	orpc.getCargaPorAsesorBucket.queryOptions({ input: { asesorId: 3 } })
		.queryKey,
	{
		...CARGA,
		porAsesor: CARGA.porAsesor.filter((a) => a.asesor_id === 3),
		fecha: "2026-10-07",
	} as never,
);
clienteDemo.setQueryData(
	orpc.getCargaPorAsesorBucket.queryOptions({ input: {} }).queryKey,
	{ ...CARGA, fecha: "2026-10-07" } as never,
);

/**
 * Los modales reales (Dialog de Radix con su portal de popovers) sobre la
 * caché de ejemplo, para revisar que los combobox se abran dentro del modal.
 * La revisión y el resultado del traslado se abren con datos de ejemplo en la
 * misma caja del modal (la vista previa real necesita cartera-back).
 */
function DemoModalesReales() {
	const [accion, setAccion] = useState<"trasladar" | "ausente" | undefined>();
	const [ejemplo, setEjemplo] = useState<
		"revision" | "problemas" | "resultado" | null
	>(null);
	const vista = useTrasladoDemo();
	return (
		<QueryClientProvider client={clienteDemo}>
			<div className="flex flex-wrap items-center gap-3 py-4">
				<AccionesEquipo
					onTrasladar={() => setAccion("trasladar")}
					onMarcarAusente={() => setAccion("ausente")}
				/>
				<Button
					size="sm"
					variant="outline"
					onClick={() => setEjemplo("revision")}
				>
					Revisión de ejemplo
				</Button>
				<Button
					size="sm"
					variant="outline"
					onClick={() => setEjemplo("problemas")}
				>
					Revisión con bloqueos
				</Button>
				<Button
					size="sm"
					variant="outline"
					onClick={() => setEjemplo("resultado")}
				>
					Resultado
				</Button>
				<span className="text-fg-tertiary text-sm">
					Abre los modales reales con Marta Gómez ya elegida.
				</span>
			</div>
			<ModalesEquipo
				accion={accion}
				asesor={3}
				onCerrar={() => setAccion(undefined)}
				onCoberturaRegistrada={nada}
			/>
			<TrasladarDialogMarco
				abierto={ejemplo !== null}
				onCerrar={() => setEjemplo(null)}
			>
				{ejemplo === "problemas" ? (
					<TrasladoVista
						{...propsTraslado({
							paso: "revision",
							preview: PREVIEW_PROBLEMAS,
							vencido: true,
							onAtras: () => setEjemplo(null),
						})}
					/>
				) : ejemplo ? (
					<TrasladoVista
						{...vista}
						paso={ejemplo}
						onAtras={() => setEjemplo(null)}
						onListo={() => setEjemplo(null)}
					/>
				) : null}
			</TrasladarDialogMarco>
		</QueryClientProvider>
	);
}

/* ── Grupos ───────────────────────────────────────────────────────────────── */

/** Grupos del showcase de Carga y asignación y de sus modales. */
export function GruposAsignacion() {
	return (
		<>
			<ShowcaseGroup title="Modales reales: abrir «Trasladar cartera» y «Marcar ausente»">
				<DemoModalesReales />
			</ShowcaseGroup>

			<ShowcaseGroup title="Modal «Trasladar cartera» · los tres pasos (interactivo)">
				<div className="py-4">
					<DemoTrasladoPasos />
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Trasladar · paso 1 con «A un solo asesor» y con «Destino por bucket»">
				<div className="flex flex-wrap items-start gap-6 py-4">
					<PanelTraslado>
						<TrasladoVista
							{...propsTraslado({ modo: "traslado_completo", destino: "1" })}
						/>
					</PanelTraslado>
					<PanelTraslado>
						<TrasladoVista
							{...propsTraslado({
								modo: "destino_por_bucket",
								destinosPorBucket: { 2: "2" },
								razon: "despido",
								requiereDestinoEspecial: true,
								errorFormulario:
									"Seleccione un responsable para las cuentas sin bucket operativo.",
							})}
						/>
					</PanelTraslado>
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Trasladar · paso 2 con problemas y paso 3">
				<div className="flex flex-wrap items-start gap-6 py-4">
					<PanelTraslado>
						<TrasladoVista
							{...propsTraslado({
								paso: "revision",
								preview: PREVIEW_PROBLEMAS,
								vencido: true,
							})}
						/>
					</PanelTraslado>
					<PanelTraslado>
						<TrasladoVista
							{...propsTraslado({
								paso: "resultado",
								resultado: { cuentas: 36, operacionId: PREVIEW.previewId },
							})}
						/>
					</PanelTraslado>
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Carga y asignación · historial de traslados y coberturas, sin rol admin">
				<div className="flex flex-col gap-8 py-4">
					<DemoAsignacion esAdmin={false} seccionInicial="traslados" />
					<HistorialDemo seccion="coberturas" />
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Modal «Editar capacidad» (solo admin)">
				<div className="flex flex-wrap items-start gap-6 py-4">
					<DemoEditarCapacidad />
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Carga y asignación · cargando y error">
				<div className="grid gap-6 py-4">
					<CargaResumenVista
						data={undefined}
						cargando
						error={false}
						esAdmin
						onEditarCapacidad={nada}
						onTrasladar={nada}
						onMarcarAusente={nada}
					/>
					<CargaResumenVista
						data={undefined}
						cargando={false}
						error
						onReintentar={nada}
						esAdmin
						onEditarCapacidad={nada}
						onTrasladar={nada}
						onMarcarAusente={nada}
					/>
				</div>
			</ShowcaseGroup>
		</>
	);
}

function DemoEditarCapacidad() {
	const [capacidad, setCapacidad] = useState("20");
	const [tipo, setTipo] = useState<"porcentaje" | "fijo">("porcentaje");
	const [valor, setValor] = useState("10");
	const n = Number(capacidad);
	const error =
		!Number.isInteger(n) || n <= 0
			? "Capacidad máxima debe ser un entero mayor a 0"
			: null;
	return (
		<div className={cn(dialogPanelClassName, "max-w-110")}>
			<EditarCapacidadVista
				nombre="Marta Gómez"
				bucket={2}
				cuentas={24}
				capacidad={capacidad}
				onCapacidad={setCapacidad}
				margenTipo={tipo}
				onMargenTipo={setTipo}
				margenValor={valor}
				onMargenValor={setValor}
				error={error}
				guardando={false}
				onCancelar={nada}
				onGuardar={nada}
			/>
		</div>
	);
}
