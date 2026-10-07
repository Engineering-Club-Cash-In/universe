import { Clock, MessageCircle } from "lucide-react";
import * as React from "react";
import type { FilaCartera } from "@/components/cobros/asesor/fila-cartera";
import {
	ETAPAS_MORA,
	type EtapaOpcion,
	FILTROS_INICIALES,
	type FiltrosCartera,
	ORDEN_INICIAL,
	type OrdenCartera,
} from "@/components/cobros/asesor/filtros-cartera";
import {
	MiCarteraVista,
	type MiCarteraVistaProps,
	type PerfilVista,
	type ResumenCartera,
} from "@/components/cobros/asesor/mi-cartera-vista";
import { ResumenReasignacion } from "@/components/cobros/cartera-general/reasignar-bloque";
import type {
	AlertaConvenio,
	AlertaPromesa,
	ConteosSegmentos,
	DetalleSegmento,
	Segmento,
} from "@/components/cobros/cartera-general/segmentos";
import {
	type AsesorOpcion,
	PanelSegmentos,
	type SupervisionCartera,
} from "@/components/cobros/cartera-general/vista-supervision";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import {
	bucketsParaRender,
	labelBucketConCodigo,
} from "@/lib/cobros/buckets-catalogo";
import { ShowcaseGroup, type ShowcaseMeta } from "./_layout";

export const meta: ShowcaseMeta = {
	order: 311,
	title: "Cobros · Cartera general (supervisor)",
	figma:
		"CRM Ventas › Supervisor › Cartera general (2262:12) y estado vacío (2010:4449)",
	description:
		"Pantalla /cobros/cartera para supervisión y admin con datos de ejemplo: columna Asesor, filtro por asesor, chips rápidos de Figma, el selector «Cola del día y alertas» (reemplaza a la Cola del día y a las Alertas de promesas y de convenios), selección múltiple con «Reasignar en bloque», «Configurar SLA» y el estado vacío por segmento.",
};

const hoy = new Date();
const dia = (delta: number) => {
	const d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + delta);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const hace = (dias: number) =>
	new Date(hoy.getTime() - dias * 24 * 60 * 60 * 1000).toISOString();

const ESTADO = ["al_dia", "mora_30", "mora_60", "mora_90", "mora_120"];

type Semilla = [
	cliente: string,
	vehiculo: string,
	placa: string,
	asesor: string,
	bucket: number,
	deuda: number,
	cuota: number,
	fecha: number,
	intentos: number,
	gestion: string,
	accion: { tipo: string; fecha: string | null } | null,
];

const SEMILLAS: Semilla[] = [
	[
		"Luis Fernando Aguilar",
		"Nissan Frontier",
		"P-201KLM",
		"J. Pérez",
		0,
		11900,
		2900,
		4,
		0,
		"sin_acuerdo",
		{ tipo: "llamar", fecha: hace(0) },
	],
	[
		"Ana Lucía Morales",
		"Kia Sportage",
		"P-773XYZ",
		"C. Ramírez",
		1,
		18300,
		3600,
		-2,
		0,
		"convenio_vigente",
		{ tipo: "promesa_por_vencer", fecha: hace(0) },
	],
	[
		"Roberto Cárcamo",
		"Mazda BT-50",
		"P-559ABC",
		"L. Morales",
		1,
		15400,
		3200,
		-10,
		3,
		"promesa_incumplida",
		{ tipo: "promesa_vencida", fecha: hace(1) },
	],
	[
		"María José Contreras",
		"Toyota Hilux",
		"P-482GHT",
		"L. Morales",
		2,
		14600,
		3200,
		5,
		2,
		"sin_acuerdo",
		{ tipo: "confirmar_pago", fecha: hace(0) },
	],
	[
		"Sergio Ramírez",
		"Toyota Corolla",
		"P-112DEF",
		"J. Pérez",
		2,
		9800,
		2400,
		-5,
		0,
		"convenio_vigente",
		{ tipo: "gestionar_sla", fecha: hace(0) },
	],
	[
		"Diana Herrera",
		"Hyundai Tucson",
		"P-904GHJ",
		"A. Díaz",
		3,
		7450,
		1900,
		-13,
		1,
		"promesa_incumplida",
		{ tipo: "llamar", fecha: hace(-1) },
	],
	[
		"Carlos Mendoza",
		"Chevrolet D-Max",
		"P-330KLM",
		"C. Ramírez",
		3,
		10200,
		2600,
		0,
		3,
		"sin_acuerdo",
		{ tipo: "cuota_vence_hoy", fecha: hace(0) },
	],
	[
		"Patricia López",
		"Kia Rio",
		"P-221NOP",
		"A. Díaz",
		4,
		6100,
		1500,
		3,
		0,
		"convenio_vigente",
		{ tipo: "promesa_por_vencer", fecha: hace(0) },
	],
	[
		"Andrés Castillo",
		"Nissan Versa",
		"P-887QRS",
		"L. Morales",
		4,
		5400,
		1400,
		-40,
		0,
		"promesa_incumplida",
		{ tipo: "promesa_vencida", fecha: hace(1) },
	],
];

function fila(s: Semilla, i: number): FilaCartera {
	const [
		cliente,
		vehiculo,
		placa,
		asesor,
		bucket,
		deuda,
		cuota,
		fecha,
		intentos,
		gestion,
		accion,
	] = s;
	const [marca, modelo] = vehiculo.split(" ");
	return {
		contratoId: String(2000 + i),
		casoCobroId: `caso-${i}`,
		clienteNombre: cliente,
		vehiculoMarca: marca,
		vehiculoModelo: modelo,
		vehiculoYear: 2022,
		vehiculoPlaca: placa,
		estadoContrato: "activo",
		montoFinanciado: (deuda * 10).toFixed(2),
		cuotaMensual: cuota.toFixed(2),
		fechaProximoPago: dia(fecha),
		asesorNombre: asesor,
		estadoMora: ESTADO[bucket],
		montoEnMora: (deuda * 0.08).toFixed(2),
		diasMoraMaximo: bucket * 30,
		numeroCredito: `0101021411${7600 + i}`,
		etiquetas: null,
		promesaActiva: false,
		bucketNumero: bucket,
		deudaVencida: deuda.toFixed(2),
		seguimiento: {
			intentosSinContacto: intentos,
			ultimoIntentoEn: hace(intentos ? 2 : 1),
			intentadoHoy: false,
			contactadoHoy: false,
			proximaLlamadaEn: null,
		},
		estadoGestion: gestion,
		accionPendiente: accion,
		isPool: false,
	} as unknown as FilaCartera;
}

const FILAS = SEMILLAS.map(fila);

const ASESORES: AsesorOpcion[] = [
	{ asesorId: 1, nombre: "A. Díaz", email: "a.diaz@example.com" },
	{ asesorId: 2, nombre: "C. Ramírez", email: "c.ramirez@example.com" },
	{ asesorId: 3, nombre: "J. Pérez", email: "j.perez@example.com" },
	{ asesorId: 4, nombre: "L. Morales", email: "l.morales@example.com" },
];

const CONTEOS: ConteosSegmentos = {
	cola: {
		todas: 64,
		sla_hoy: 12,
		promesa_hoy: 7,
		vence_hoy: 9,
		incumplida: 15,
		promesa_proxima: 6,
		sin_contacto: 21,
		llamada_hoy: 18,
		sin_intento_hoy: 40,
	},
	promesa: {
		todas: 38,
		vencida: 11,
		vence_hoy: 7,
		por_vencer: 9,
		programada: 11,
	},
	convenio: { todas: 24, vencida: 5, vence_hoy: 2, por_vencer: 6, proxima: 11 },
};

/* Detalle de los segmentos (lo que mostraban las páginas viejas). */
const COLA: Map<string, DetalleSegmento> = new Map(
	FILAS.map((f, i) => [
		f.numeroCredito ?? "",
		{
			tipo: "cola",
			mostrarAsesor: true,
			item: {
				numeroCreditoSifco: f.numeroCredito ?? "",
				cliente: f.clienteNombre ?? "",
				asesor: f.asesorNombre ?? "",
				cubierto: i === 2,
				suplente: i === 2 ? "A. Díaz" : null,
				fechaLimiteSla: i % 2 === 0 ? dia(0) : dia(1),
				fechaPromesa: i % 3 === 0 ? dia(0) : null,
				telefono: i === 4 ? null : `5${String(5512345 + i)}`,
				slaHoy: i % 2 === 0,
				promesaHoy: i % 3 === 0,
				venceHoy: i === 6,
				incumplida: i === 2 || i === 5,
				promesaProxima: i === 7,
				sinContacto: i === 3,
				promesaActiva: i === 1,
				diasSinContacto: i === 3 ? 7 : null,
			},
		},
	]),
);

const PROMESAS: Map<string, DetalleSegmento> = new Map(
	FILAS.map((f, i) => {
		const alerta: AlertaPromesa = {
			id: `p-${i}`,
			casoCobroId: `caso-${i}`,
			numeroCreditoSifco: f.numeroCredito,
			clienteNombre: f.clienteNombre,
			asesorNombre: f.asesorNombre,
			fechaPrometida: i % 2 === 0 ? hace(3) : hace(-2),
			fechaAlerta: null,
			montoComprometido: String(1500 + i * 250),
			cuotaInicio: 3 + i,
			cuotaFin: i % 2 === 0 ? 4 + i : 3 + i,
			incluyeMora: i % 3 === 0,
			estadoPromesa: "pendiente",
			categoria: i % 2 === 0 ? "vencida" : "por_vencer",
		};
		return [
			f.numeroCredito ?? "",
			{ tipo: "promesa", alertas: i === 0 ? [alerta, alerta] : [alerta] },
		];
	}),
);

const CONVENIOS: Map<string, DetalleSegmento> = new Map(
	FILAS.map((f, i) => {
		const alerta: AlertaConvenio = {
			convenio_id: i,
			credito_id: 2000 + i,
			numero_credito_sifco: f.numeroCredito ?? "",
			cliente: f.clienteNombre,
			asesor_id: 1,
			asesor: f.asesorNombre,
			fecha_vencimiento: dia(i % 2 === 0 ? -4 : 2),
			dias_para_vencer: i % 2 === 0 ? -4 : 2,
			cuotas_vencidas: i % 2 === 0 ? (i % 4 === 0 ? 2 : 1) : 0,
			cuotas_pendientes: 6 - (i % 5),
			monto_vencido: String(2400 + i * 100),
			monto_pendiente_convenio: String(14000 + i * 900),
			cuota_convenio: "1200",
			monto_cuota: String(1200 + i * 50),
			fecha_convenio: dia(-60),
			bucket: f.bucketNumero,
			categoria: i % 2 === 0 ? "vencida" : "por_vencer",
			casoCobroId: `caso-${i}`,
		};
		return [f.numeroCredito ?? "", { tipo: "convenio", alerta }];
	}),
);

const ETAPAS: EtapaOpcion[] = bucketsParaRender(undefined, ETAPAS_MORA).map(
	(b) => ({ key: b.key, label: labelBucketConCodigo(b) }),
);

const SUPERVISION: PerfilVista = {
	esSupervision: true,
	sinAsesor: false,
	buckets: [],
};

const RESUMEN: ResumenCartera = {
	asignados: 312,
	atencionHoy: 64,
	alDia: 68.4,
	cargando: false,
	porBucket: { B0: 62, B1: 88, B2: 74, B3: 51, B4: 37, B5: 0 },
};

/** Vista con estado local (filtros, segmento, asesor, selección) para probarla a mano. */
function Demo(
	props: Partial<MiCarteraVistaProps> & {
		filtrosIniciales?: Partial<FiltrosCartera>;
		segmentoInicial?: Segmento | null;
		asesorInicial?: number | null;
		seleccionInicial?: string[];
		avisos?: string[];
		sinFila?: SupervisionCartera["sinFila"];
	},
) {
	const [filtros, setFiltros] = React.useState<FiltrosCartera>({
		...FILTROS_INICIALES,
		...props.filtrosIniciales,
	});
	const [segmento, setSegmento] = React.useState<Segmento | null>(
		props.segmentoInicial ?? null,
	);
	const [asesorId, setAsesorId] = React.useState<number | null>(
		props.asesorInicial ?? null,
	);
	const [seleccion, setSeleccion] = React.useState(
		() => new Set(props.seleccionInicial ?? []),
	);
	const [pagina, setPagina] = React.useState(1);
	const [tamano, setTamano] = React.useState(25);
	const [orden, setOrden] = React.useState<OrdenCartera>(ORDEN_INICIAL);
	const filas = props.filas ?? FILAS;
	const total = props.total ?? 312;
	const detalles =
		segmento?.tipo === "cola"
			? COLA
			: segmento?.tipo === "promesa"
				? PROMESAS
				: segmento?.tipo === "convenio"
					? CONVENIOS
					: undefined;
	return (
		<div className="overflow-hidden rounded-2xl border border-line-subtle bg-canvas">
			<MiCarteraVista
				perfil={SUPERVISION}
				resumen={RESUMEN}
				filtros={filtros}
				onCambiarFiltros={(c) => {
					setFiltros((f) => ({ ...f, ...c }));
					if (c.gestion) setSegmento(null);
				}}
				onLimpiarFiltros={() => {
					setFiltros(FILTROS_INICIALES);
					setSegmento(null);
					setAsesorId(null);
				}}
				etapas={ETAPAS}
				total={total}
				cargando={false}
				pagina={pagina}
				totalPaginas={Math.ceil(total / tamano) || 1}
				tamanoPagina={tamano}
				onPagina={setPagina}
				onTamanoPagina={setTamano}
				orden={orden}
				onOrden={setOrden}
				accionMasiva={
					<ToolbarButton icon={MessageCircle}>
						Enviar WhatsApp masivo
					</ToolbarButton>
				}
				onVistaRapida={() => {}}
				onAbrir={() => {}}
				{...props}
				filas={filas}
				supervision={{
					asesores: ASESORES,
					asesorId,
					onAsesor: setAsesorId,
					segmento,
					onSegmento: (s) => {
						setSegmento(s);
						if (s) setFiltros((f) => ({ ...f, gestion: null }));
					},
					conteos: CONTEOS,
					detalles,
					avisos: props.avisos,
					sinFila: props.sinFila,
					seleccion,
					onSeleccionar: (ids, marcar) =>
						setSeleccion((prev) => {
							const n = new Set(prev);
							for (const id of ids) {
								if (marcar) n.add(id);
								else n.delete(id);
							}
							return n;
						}),
					onLimpiarSeleccion: () => setSeleccion(new Set()),
					onReasignar: () => {},
					herramientas: (
						<ToolbarButton icon={Clock}>Configurar SLA</ToolbarButton>
					),
					onAtencionHoy: () => setSegmento({ tipo: "cola", valor: "todas" }),
				}}
			/>
		</div>
	);
}

export default function CobrosCarteraGeneralShowcase() {
	return (
		<div className="space-y-8">
			<ShowcaseGroup title="Cartera general (Figma 2262:12), con selección múltiple">
				<div className="py-3">
					<Demo seleccionInicial={["2001", "2002", "2006"]} />
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Segmento «Cola del día · SLA vence hoy» de un asesor">
				<div className="py-3">
					<Demo
						segmentoInicial={{ tipo: "cola", valor: "sla_hoy" }}
						asesorInicial={4}
						total={12}
						avisos={[
							"L. Morales está registrado como ausente hoy: su cola la está trabajando su suplente.",
						]}
					/>
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Segmentos «Alertas de promesas» y «Alertas de convenios»">
				<div className="space-y-6 py-3">
					<Demo
						segmentoInicial={{ tipo: "promesa", valor: "todas" }}
						total={38}
						sinFila={[
							{
								sifco: "01010214117690",
								nombre: "Julio Estrada",
								casoCobroId: "caso-x",
							},
						]}
					/>
					<Demo
						segmentoInicial={{ tipo: "convenio", valor: "vencida" }}
						total={5}
					/>
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Popover «Cola del día y alertas» (todas las categorías con conteo)">
				<div className="max-w-[600px] py-3">
					<div className="rounded-xl border border-line-subtle bg-surface-raised p-5 shadow-dropdown">
						<PanelSegmentos
							segmento={{ tipo: "promesa", valor: "vencida" }}
							onSegmento={() => {}}
							gestion={null}
							onGestion={() => {}}
							conteos={CONTEOS}
						/>
					</div>
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Estado vacío del segmento (Figma 2010:4449)">
				<div className="py-3">
					<Demo
						segmentoInicial={{ tipo: "cola", valor: "sin_contacto" }}
						filas={[]}
						total={0}
					/>
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="«Sin acuerdo» (se filtra sobre la página hasta S5)">
				<div className="py-3">
					<Demo
						filtrosIniciales={{ gestion: "sin_acuerdo" }}
						filas={FILAS.filter((f) => f.estadoGestion === "sin_acuerdo")}
						avisos={[
							"«Sin acuerdo» se aplica sobre la página visible: el total y las demás páginas todavía no lo descuentan.",
						]}
					/>
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Reasignar en bloque · resumen al terminar">
				<div className="max-w-[520px] py-3">
					<div className="rounded-xl border border-line-subtle bg-surface p-5">
						<ResumenReasignacion
							resultado={{
								exitos: 5,
								fallos: [
									{
										sifco: "01010214117603",
										cliente: "María José Contreras",
										motivo: "Cartera no respondió a tiempo.",
									},
								],
								omitidos: [
									{
										sifco: "01010214117607",
										cliente: "Patricia López",
										motivo: "El asesor no está en el pool de B4.",
									},
								],
							}}
						/>
					</div>
				</div>
			</ShowcaseGroup>
		</div>
	);
}
