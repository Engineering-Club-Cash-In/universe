import type * as React from "react";
import { useState } from "react";
import {
	type AperturaResponse,
	AperturaVista,
} from "@/components/cobros/equipo/dia/apertura-vista";
import {
	type CierreFila,
	CierreVista,
	type DetalleCierreItem,
	DetalleCierreVista,
} from "@/components/cobros/equipo/dia/cierre-vista";
import {
	DESCRIPCION_GESTIONES,
	DiaVista,
} from "@/components/cobros/equipo/dia/dia";
import type { VistaDia } from "@/components/cobros/equipo/search";
import {
	type FiltrosHistorialUI,
	HistorialGestionesVista,
} from "@/components/cobros/historial/historial-gestiones-vista";
import type {
	FilaHistorialData,
	RespuestaHistorial,
	ResumenHistorial,
} from "@/components/cobros/historial/tipos";
import { ShowcaseGroup } from "./_layout";

/**
 * Datos y demos de «Mi equipo» › Día para `cobros-mi-equipo.showcase.tsx`
 * (Apertura, Cierre y Gestiones con datos de ejemplo). Va aparte para que la
 * pestaña Día y Carga y asignación se puedan editar sin pisarse.
 */

const nada = () => {};

/* ── Apertura ─────────────────────────────────────────────────────────────── */

const critico = (
	credito_id: number,
	cliente: string,
	bucket: number,
	vencidas: number,
	cuota: number,
	mora: number,
	dias: number,
	asesor: string,
) => ({
	credito_id,
	numero_credito_sifco: `0101021414${String(7000 + credito_id * 37).padStart(4, "0")}`,
	cliente,
	bucket,
	status_credito: "MOROSO",
	cuotas_vencidas: vencidas,
	monto_cuota: cuota,
	monto_mora: mora,
	monto_adeudado: vencidas * cuota + mora,
	dias_mora: dias,
	asesor_id: credito_id,
	asesor,
});

const movimiento = (
	credito_id: number,
	cliente: string,
	desde: number,
	hacia: number,
	cuota: number,
	vencidas: number,
	asesor: string | null,
): AperturaResponse["movimientos"][number] => ({
	credito_id,
	numero_credito_sifco: `0101021415${String(1000 + credito_id * 53).padStart(4, "0")}`,
	cliente,
	bucket_anterior: desde,
	bucket_nuevo: hacia,
	tipo_evento: hacia > desde ? "SUBIDA" : "BAJADA",
	saltos: Math.abs(hacia - desde),
	status_credito: "MOROSO",
	cuotas_vencidas: vencidas,
	monto_cuota: cuota,
	monto_mora: 0,
	monto_adeudado: cuota * vencidas,
	dias_mora: vencidas * 30,
	asesor_id: asesor ? 1 : null,
	asesor,
	fecha: "2026-10-07",
});

export const APERTURA: AperturaResponse = {
	fecha: "2026-10-07",
	cuentas_nuevas: [
		{
			bucket: 1,
			entradas: 5,
			subidas: 5,
			bajadas: 0,
			origenes: [{ desde: 0, tipo: "SUBIDA", cantidad: 5 }],
		},
		{
			bucket: 2,
			entradas: 3,
			subidas: 2,
			bajadas: 1,
			origenes: [
				{ desde: 1, tipo: "SUBIDA", cantidad: 2 },
				{ desde: 3, tipo: "BAJADA", cantidad: 1 },
			],
		},
		{
			bucket: 3,
			entradas: 2,
			subidas: 1,
			bajadas: 1,
			origenes: [
				{ desde: 1, tipo: "SUBIDA", cantidad: 1 },
				{ desde: 4, tipo: "BAJADA", cantidad: 1 },
			],
		},
		{
			bucket: 0,
			entradas: 4,
			subidas: 0,
			bajadas: 4,
			origenes: [{ desde: 1, tipo: "BAJADA", cantidad: 4 }],
		},
	],
	cumplimiento: {
		fecha: "2026-10-06",
		cuentas_esperadas: 42,
		cuentas_pagadas: 31,
		pct: 74,
		monto_esperado: 98_500,
		monto_pagado: 71_200,
	},
	top3: [
		{
			bucket: 4,
			total_criticos: 6,
			peor_monto: 31_200,
			top: [
				critico(11, "Diego Herrera", 4, 5, 5_800, 2_200, 128, "Luis Fernández"),
				critico(
					12,
					"Sofía Marroquín",
					4,
					4,
					4_950,
					1_100,
					117,
					"Luis Fernández",
				),
				critico(13, "Marvin Castillo", 4, 4, 3_400, 900, 112, "Luis Fernández"),
			],
		},
		{
			bucket: 3,
			total_criticos: 9,
			peor_monto: 18_400,
			top: [
				critico(1, "Roberto Cárcamo", 3, 3, 5_920, 640, 74, "Carlos Ramírez"),
				critico(2, "Ana Lucía Morales", 3, 3, 4_100, 480, 81, "Andrea Solís"),
				critico(3, "María José Contreras", 3, 2, 4_300, 350, 66, "Marta Gómez"),
			],
		},
		{
			bucket: 2,
			total_criticos: 14,
			peor_monto: 9_870,
			top: [
				critico(
					4,
					"Luis Fernando Aguilar",
					2,
					2,
					4_700,
					470,
					45,
					"Marta Gómez",
				),
				critico(5, "Pedro Ruiz", 2, 2, 3_250, 220, 41, "Carlos Ramírez"),
				critico(6, "Elena Cifuentes", 2, 2, 2_980, 160, 38, "Andrea Solís"),
			],
		},
		{
			bucket: 1,
			total_criticos: 2,
			peor_monto: 2_150,
			top: [
				critico(7, "Lucía Herrera", 1, 1, 1_850, 300, 12, "María López"),
				critico(8, "José Pérez", 1, 1, 1_600, 90, 6, "María López"),
			],
		},
	],
	asignacion: [
		{
			asesor_id: 5,
			asesor: "María López",
			ingresos: 5,
			buckets_pool: [1],
			porBucket: [{ desde: 0, bucket: 1, cantidad: 5 }],
		},
		{
			asesor_id: 2,
			asesor: "Andrea Solís",
			ingresos: 3,
			buckets_pool: [2, 3],
			porBucket: [
				{ desde: 1, bucket: 2, cantidad: 2 },
				{ desde: 4, bucket: 3, cantidad: 1 },
			],
		},
		{
			asesor_id: 1,
			asesor: "Carlos Ramírez",
			ingresos: 1,
			buckets_pool: [2, 3],
			porBucket: [{ desde: 3, bucket: 2, cantidad: 1 }],
		},
		{
			asesor_id: null,
			asesor: null,
			ingresos: 1,
			buckets_pool: [],
			porBucket: [{ desde: 1, bucket: 3, cantidad: 1 }],
		},
	],
	movimientos: [
		movimiento(9, "Lucía Herrera", 0, 1, 1_850, 1, "María López"),
		movimiento(10, "José Pérez", 0, 1, 1_600, 1, "María López"),
		movimiento(14, "Gabriela Ordóñez", 1, 2, 2_400, 2, "Andrea Solís"),
		movimiento(15, "Kevin Barrios", 1, 3, 3_100, 3, null),
		movimiento(16, "Roberto Cárcamo", 3, 2, 5_920, 2, "Carlos Ramírez"),
		movimiento(17, "Sergio Juárez", 4, 3, 2_750, 3, "Andrea Solís"),
		movimiento(18, "Hilda Morán", 1, 0, 1_300, 0, "María López"),
	],
};

/* ── Cierre ───────────────────────────────────────────────────────────────── */

export const CIERRE: CierreFila[] = [
	{
		asesorId: "u1",
		asesorNombre: "Carlos Ramírez",
		contactosEfectivos: 12,
		promesasObtenidas: 4,
		totalContactos: 20,
		subieron: 1,
		bajaron: 3,
		bucketsPool: [2, 3],
	},
	{
		asesorId: "u2",
		asesorNombre: "María López",
		contactosEfectivos: 9,
		promesasObtenidas: 2,
		totalContactos: 24,
		subieron: 2,
		bajaron: 1,
		bucketsPool: [1],
	},
	{
		asesorId: "u3",
		asesorNombre: "Andrea Solís",
		contactosEfectivos: 15,
		promesasObtenidas: 6,
		totalContactos: 19,
		subieron: 0,
		bajaron: 2,
		bucketsPool: [2, 3],
	},
	{
		asesorId: "u4",
		asesorNombre: "Pedro Ruiz",
		contactosEfectivos: 0,
		promesasObtenidas: 0,
		totalContactos: 6,
		subieron: 1,
		bajaron: 0,
		bucketsPool: [],
	},
];

export const DETALLE_CIERRE: DetalleCierreItem[] = [
	{
		id: 1,
		tipo: "contacto",
		numeroCreditoSifco: "01010214147120",
		estadoContacto: "contactado",
		esEfectivoManual: true,
		fechaContacto: "2026-10-06T16:00:00Z",
		bucketAnterior: null,
		bucket: 3,
		origen: null,
	},
	{
		id: 2,
		tipo: "contacto",
		numeroCreditoSifco: "01010214151881",
		estadoContacto: "promesa_pago",
		esEfectivoManual: false,
		fechaContacto: "2026-10-06T17:10:00Z",
		bucketAnterior: null,
		bucket: 2,
		origen: null,
	},
	{
		id: 4,
		tipo: "contacto",
		numeroCreditoSifco: "01010214148215",
		estadoContacto: "no_contesta",
		esEfectivoManual: false,
		fechaContacto: "2026-10-05T15:20:00Z",
		bucketAnterior: null,
		bucket: 2,
		origen: null,
	},
	{
		id: 5,
		tipo: "contacto",
		numeroCreditoSifco: "01010214146980",
		estadoContacto: "contactado",
		esEfectivoManual: false,
		fechaContacto: "2026-10-05T13:05:00Z",
		bucketAnterior: null,
		bucket: 3,
		origen: "premora",
	},
	{
		id: 3,
		tipo: "bajada",
		numeroCreditoSifco: "01010214139002",
		estadoContacto: null,
		esEfectivoManual: null,
		fechaContacto: null,
		bucketAnterior: 3,
		bucket: 2,
		origen: null,
	},
	{
		id: 6,
		tipo: "subida",
		numeroCreditoSifco: "01010214152210",
		estadoContacto: null,
		esEfectivoManual: null,
		fechaContacto: null,
		bucketAnterior: 2,
		bucket: 3,
		origen: null,
	},
];

/* ── Gestiones (historial del equipo) ─────────────────────────────────────── */

const AHORA = new Date();
const haceHoras = (h: number) =>
	new Date(AHORA.getTime() - h * 60 * 60 * 1000).toISOString();

const USUARIOS = [
	{ id: "u1", name: "Carlos Ramírez", role: "cobros" },
	{ id: "u2", name: "María López", role: "cobros" },
	{ id: "u3", name: "Andrea Solís", role: "cobros" },
];

function gestion(
	i: number,
	horas: number,
	usuario: (typeof USUARIOS)[number],
	cliente: string,
	metodo: string,
	estado: string,
	comentarios: string,
	bucket: number | null,
): FilaHistorialData {
	return {
		id: `g-${i}`,
		fechaContacto: haceHoras(horas),
		usuarioId: usuario.id,
		usuarioNombre: usuario.name,
		usuarioRol: usuario.role,
		bucketSnapshot: bucket,
		casoCobroId: `caso-${i}`,
		numeroCreditoSifco: `0101021414${8972 - i * 120}`,
		clienteNombre: cliente,
		metodoContacto: metodo,
		estadoContacto: estado,
		comentarios,
		fechaProximoContacto: estado === "promesa_pago" ? haceHoras(-72) : null,
		proximoPaso: null,
		requiereSeguimiento: null,
		estadoPromesa: estado === "promesa_pago" ? "pendiente" : null,
		cuotaInicio: estado === "promesa_pago" ? 5 : null,
		cuotaFin: estado === "promesa_pago" ? 6 : null,
		incluyeMora: null,
		montoComprometido: estado === "promesa_pago" ? "2900.00" : null,
		fechaAlerta: null,
		updatedAt: null,
		origen: "manual",
		fueEditadoManual: false,
		ultimaEdicion: null,
		vecesEditado: 0,
	};
}

const GESTIONES: FilaHistorialData[] = [
	gestion(
		0,
		1,
		USUARIOS[0],
		"Roberto Cárcamo",
		"llamada",
		"promesa_pago",
		"Pagará el viernes.",
		3,
	),
	gestion(
		1,
		2,
		USUARIOS[1],
		"Lucía Herrera",
		"whatsapp",
		"contactado",
		"Recordatorio de pago enviado.",
		1,
	),
	gestion(
		2,
		4,
		USUARIOS[2],
		"Gabriela Ordóñez",
		"llamada",
		"no_contesta",
		"Segundo intento sin respuesta.",
		2,
	),
	gestion(
		3,
		26,
		USUARIOS[0],
		"Ana Lucía Morales",
		"visita_domicilio",
		"acuerdo_parcial",
		"Abonará la mitad de la cuota.",
		3,
	),
];

const RESPUESTA: RespuestaHistorial = {
	items: GESTIONES,
	total: 312,
	totalEsAproximado: false,
	page: 1,
	pageSize: 50,
	totalPaginas: 7,
	rangoAplicado: {
		desde: haceHoras(24 * 30),
		hasta: haceHoras(-24),
		esDefault: true,
	},
	verTodos: false,
};

const RESUMEN: ResumenHistorial = {
	total: 312,
	efectivos: 198,
	promesas: 54,
	sinContacto: 114,
	conProximaAccion: 87,
	editadas: 6,
	porBucket: [
		{ bucket: 1, cantidad: 96 },
		{ bucket: 2, cantidad: 121 },
		{ bucket: 3, cantidad: 82 },
		{ bucket: null, cantidad: 13 },
	],
};

const FILTROS: FiltrosHistorialUI = {
	rangoFechas: undefined,
	usuarioIds: null,
	rol: "todos",
	estadoContacto: "todos",
	metodoContacto: "todos",
	estadoPromesa: "todos",
	busquedaSifco: "",
	incluirAutomaticos: false,
	buckets: null,
};

function GestionesEquipoDemo({ selector }: { selector: React.ReactNode }) {
	const [filtros, setFiltros] = useState(FILTROS);
	return (
		<HistorialGestionesVista
			encabezado={{
				tipo: "seccion",
				titulo: "Gestiones del equipo",
				descripcion: DESCRIPCION_GESTIONES,
				controles: selector,
			}}
			esSupervisor
			mostrarFiltrosEquipo
			usuarios={USUARIOS}
			filtros={filtros}
			onFiltros={(c) => setFiltros((f) => ({ ...f, ...c }))}
			filtrosActivos={0}
			onLimpiar={() => setFiltros(FILTROS)}
			catalogo={undefined}
			bucketsChips={RESUMEN.porBucket}
			resumen={{ datos: RESUMEN, cargando: false, error: false }}
			listado={{
				datos: RESPUESTA,
				cargando: false,
				error: false,
				actualizando: false,
			}}
			page={1}
			pageSize={50}
			hayMasPaginas
			onPage={nada}
			onPageSize={nada}
			exportacion={{
				exportando: false,
				deshabilitada: false,
				onExportar: nada,
			}}
		/>
	);
}

/* ── Demos ────────────────────────────────────────────────────────────────── */

function AperturaDemo({
	selector,
	abierto = null,
}: {
	selector: React.ReactNode;
	abierto?: number | null;
}) {
	return (
		<AperturaVista
			apertura={APERTURA}
			catalogo={undefined}
			fecha=""
			onFecha={nada}
			cargando={false}
			recargando={false}
			error={false}
			onAbrirCaso={nada}
			selector={selector}
			bucketAbiertoInicial={abierto}
		/>
	);
}

function CierreDemo({
	selector,
	abiertoInicial = null,
}: {
	selector: React.ReactNode;
	abiertoInicial?: string | null;
}) {
	const [abierto, setAbierto] = useState<string | null>(abiertoInicial);
	const [asesorId, setAsesorId] = useState("todos");
	const [rango, setRango] = useState({
		inicio: "2026-10-05",
		fin: "2026-10-07",
	});
	return (
		<CierreVista
			filas={CIERRE.filter(
				(f) => asesorId === "todos" || f.asesorId === asesorId,
			)}
			asesoresConCierre={CIERRE}
			fechaInicio={rango.inicio}
			fechaFin={rango.fin}
			onRango={setRango}
			asesorId={asesorId}
			onAsesor={setAsesorId}
			abierto={abierto}
			onToggle={(id) => setAbierto(abierto === id ? null : id)}
			cargando={false}
			recargando={false}
			error={false}
			selector={selector}
			renderDetalle={() => (
				<DetalleCierreVista
					cargando={false}
					items={DETALLE_CIERRE}
					onAbrirCaso={nada}
				/>
			)}
		/>
	);
}

/** Pestaña Día interactiva (la usa la página completa del showcase). */
export function DemoDia({ inicial = "apertura" }: { inicial?: VistaDia }) {
	const [vista, setVista] = useState<VistaDia>(inicial);
	return (
		<DiaVista
			vista={vista}
			onVista={setVista}
			apertura={(selector) => <AperturaDemo selector={selector} />}
			cierre={(selector) => (
				<CierreDemo selector={selector} abiertoInicial="u1" />
			)}
			gestiones={(selector) => <GestionesEquipoDemo selector={selector} />}
		/>
	);
}

/** Una vista fija del Día, con su selector (que cambia de vista en la demo). */
function DiaFija({
	vista,
	abierto,
}: {
	vista: VistaDia;
	abierto?: number | null;
}) {
	const [actual, setActual] = useState<VistaDia>(vista);
	return (
		<DiaVista
			vista={actual}
			onVista={setActual}
			apertura={(selector) => (
				<AperturaDemo selector={selector} abierto={abierto} />
			)}
			cierre={(selector) => (
				<CierreDemo selector={selector} abiertoInicial="u1" />
			)}
			gestiones={(selector) => <GestionesEquipoDemo selector={selector} />}
		/>
	);
}

/** Grupos del showcase para la pestaña Día. */
export function GruposDia() {
	return (
		<>
			<ShowcaseGroup title="Día › Apertura (B3 desplegado)">
				<div className="py-4">
					<DiaFija vista="apertura" abierto={3} />
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Día › Cierre (asesor desplegado)">
				<div className="py-4">
					<DiaFija vista="cierre" />
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Día › Gestiones (historial del equipo)">
				<div className="py-4">
					<DiaFija vista="gestiones" />
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Día › Cargando, error y vacíos">
				<div className="grid gap-8 py-4">
					<AperturaVista
						apertura={undefined}
						catalogo={undefined}
						fecha=""
						onFecha={nada}
						cargando
						recargando={false}
						error={false}
						onAbrirCaso={nada}
					/>
					<AperturaVista
						apertura={undefined}
						catalogo={undefined}
						fecha="2026-10-03"
						onFecha={nada}
						cargando={false}
						recargando={false}
						error
						onAbrirCaso={nada}
						onReintentar={nada}
					/>
					<AperturaVista
						apertura={{
							fecha: "2026-10-07",
							cuentas_nuevas: [],
							cumplimiento: {
								fecha: "2026-10-06",
								cuentas_esperadas: 0,
								cuentas_pagadas: 0,
								pct: 0,
								monto_esperado: 0,
								monto_pagado: 0,
							},
							top3: [],
							asignacion: [],
							movimientos: [],
						}}
						catalogo={undefined}
						fecha=""
						onFecha={nada}
						cargando={false}
						recargando={false}
						error={false}
						onAbrirCaso={nada}
					/>
					<CierreVista
						filas={[]}
						asesoresConCierre={[]}
						fechaInicio="2026-10-05"
						fechaFin="2026-10-07"
						onRango={nada}
						asesorId="todos"
						onAsesor={nada}
						abierto={null}
						onToggle={nada}
						cargando={false}
						recargando={false}
						error={false}
						renderDetalle={() => null}
					/>
				</div>
			</ShowcaseGroup>
		</>
	);
}
