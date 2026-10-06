import { MessageCircle } from "lucide-react";
import * as React from "react";
import type { FilaCartera } from "@/components/cobros/asesor/fila-cartera";
import {
	ETAPAS_MORA,
	type EtapaOpcion,
	FILTROS_INICIALES,
	type FiltrosCartera,
	ORDEN_INICIAL,
	type OrdenCartera,
	ordenarPagina,
	PanelFiltrosCartera,
} from "@/components/cobros/asesor/filtros-cartera";
import {
	MiCarteraVista,
	type MiCarteraVistaProps,
	type PerfilVista,
	type ResumenCartera,
} from "@/components/cobros/asesor/mi-cartera-vista";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import {
	bucketsParaRender,
	labelBucketConCodigo,
} from "@/lib/cobros/buckets-catalogo";
import { ShowcaseGroup, type ShowcaseMeta } from "./_layout";

export const meta: ShowcaseMeta = {
	order: 310,
	title: "Cobros · Mi Cartera (asesor)",
	figma: "CRM Ventas › Asesor Junior › 02 · Mi Cartera (312:1606)",
	description:
		"Pantalla /cobros/cartera con datos de ejemplo: junior (B0–B1), supervisión (toda la cartera, columna Asesor) y estados (cargando, sin asesor, sin cartera, sin resultados, criterio sin pendientes, error). El popover «Filtros» conserva todos los filtros del dashboard anterior.",
};

const hoy = new Date();
const dia = (delta: number) => {
	const d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + delta);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const hace = (dias: number) =>
	new Date(hoy.getTime() - dias * 24 * 60 * 60 * 1000).toISOString();

type Semilla = {
	cliente: string;
	vehiculo: [string, string, string];
	sifco: string;
	bucket: 0 | 1 | 2 | 3;
	deuda: number;
	cuota: number;
	fecha: number;
	intentos: number;
	ultimo?: number;
	contactadoHoy?: boolean;
	gestion: string;
	accion: { tipo: string; fecha: string | null } | null;
	asesor: string;
	capital: number;
	etiquetas?: string[];
	promesa?: boolean;
	pool?: boolean;
};

const ESTADO = ["al_dia", "mora_30", "mora_60", "mora_90"];

function fila(s: Semilla, i: number): FilaCartera {
	return {
		contratoId: String(1000 + i),
		casoCobroId: `caso-${i}`,
		clienteNombre: s.cliente,
		vehiculoMarca: s.vehiculo[0],
		vehiculoModelo: s.vehiculo[1],
		vehiculoYear: 2021,
		vehiculoPlaca: s.vehiculo[2],
		estadoContrato: "activo",
		montoFinanciado: s.capital.toFixed(2),
		cuotaMensual: s.cuota.toFixed(2),
		fechaProximoPago: dia(s.fecha),
		asesorNombre: s.asesor,
		estadoMora: ESTADO[s.bucket],
		montoEnMora: (s.bucket === 0 ? 0 : s.deuda * 0.08).toFixed(2),
		diasMoraMaximo: s.bucket * 30 - (s.bucket ? 12 : 0),
		numeroCredito: s.sifco,
		etiquetas: s.etiquetas ?? null,
		promesaActiva: !!s.promesa,
		bucketNumero: s.bucket,
		deudaVencida: s.deuda.toFixed(2),
		seguimiento: {
			intentosSinContacto: s.intentos,
			ultimoIntentoEn: s.ultimo === undefined ? null : hace(s.ultimo),
			intentadoHoy: s.ultimo === 0,
			contactadoHoy: !!s.contactadoHoy,
			proximaLlamadaEn: null,
		},
		estadoGestion: s.gestion,
		accionPendiente: s.accion,
		isPool: !!s.pool,
	} as unknown as FilaCartera;
}

const SEMILLAS: Semilla[] = [
	{
		cliente: "María José Contreras",
		vehiculo: ["Toyota", "Hilux", "P-482GHT"],
		sifco: "01010214117590",
		bucket: 1,
		deuda: 48250,
		cuota: 3200,
		fecha: 4,
		intentos: 3,
		ultimo: 1,
		gestion: "sin_acuerdo",
		accion: { tipo: "llamar", fecha: hace(0) },
		asesor: "J. Pérez",
		capital: 185000,
		etiquetas: ["cobro"],
	},
	{
		cliente: "Luis Fernando Aguilar",
		vehiculo: ["Nissan", "Frontier", "P-201KLM"],
		sifco: "01010214117591",
		bucket: 1,
		deuda: 31800,
		cuota: 2900,
		fecha: -2,
		intentos: 2,
		ultimo: 1,
		gestion: "promesa_incumplida",
		accion: { tipo: "promesa_por_vencer", fecha: hace(0) },
		asesor: "J. Pérez",
		capital: 142500,
		etiquetas: ["compromiso_de_pago", "moras_pendientes"],
	},
	{
		cliente: "Ana Lucía Morales",
		vehiculo: ["Kia", "Sportage", "P-773XYZ"],
		sifco: "01010214117592",
		bucket: 0,
		deuda: 18400,
		cuota: 3600,
		fecha: 12,
		intentos: 1,
		ultimo: 2,
		gestion: "convenio_vigente",
		accion: { tipo: "promesa_vencida", fecha: hace(1) },
		asesor: "A. Gómez",
		capital: 98000,
		etiquetas: ["convenio"],
		pool: true,
	},
	{
		cliente: "Roberto Cárcamo",
		vehiculo: ["Mazda", "BT-50", "P-559ABC"],
		sifco: "01010214117593",
		bucket: 1,
		deuda: 67120,
		cuota: 3200,
		fecha: 0,
		intentos: 0,
		gestion: "sin_acuerdo",
		accion: { tipo: "confirmar_pago", fecha: hace(0) },
		asesor: "J. Pérez",
		capital: 210000,
	},
	{
		cliente: "Carmen Díaz López",
		vehiculo: ["Toyota", "Hilux", "P-482GHU"],
		sifco: "01010214117594",
		bucket: 1,
		deuda: 48250,
		cuota: 3200,
		fecha: 4,
		intentos: 0,
		contactadoHoy: true,
		gestion: "promesa_vigente",
		accion: { tipo: "promesa_por_vencer", fecha: hace(-2) },
		asesor: "A. Gómez",
		capital: 176500,
		promesa: true,
	},
	{
		cliente: "José Pérez Marroquín",
		vehiculo: ["Nissan", "Frontier", "P-201KLN"],
		sifco: "01010214117595",
		bucket: 1,
		deuda: 31800,
		cuota: 2900,
		fecha: -5,
		intentos: 2,
		ultimo: 3,
		gestion: "promesa_incumplida",
		accion: { tipo: "gestionar_sla", fecha: hace(0) },
		asesor: "J. Pérez",
		capital: 131000,
		etiquetas: ["no_localizable"],
	},
	{
		cliente: "Lucía Ramírez Soto",
		vehiculo: ["Kia", "Sportage", "P-773XYA"],
		sifco: "01010214117596",
		bucket: 0,
		deuda: 0,
		cuota: 3600,
		fecha: 20,
		intentos: 0,
		gestion: "sin_acuerdo",
		accion: null,
		asesor: "A. Gómez",
		capital: 89000,
	},
	{
		cliente: "Óscar Villalta Cruz",
		vehiculo: ["Mazda", "BT-50", "P-559ABD"],
		sifco: "01010214117597",
		bucket: 1,
		deuda: 67120,
		cuota: 3200,
		fecha: 1,
		intentos: 1,
		ultimo: 0,
		gestion: "sin_acuerdo",
		accion: { tipo: "cuota_vence_hoy", fecha: hace(0) },
		asesor: "J. Pérez",
		capital: 205000,
	},
];

const FILAS = SEMILLAS.map(fila);

const FILAS_SUPERVISION = [
	...FILAS,
	fila(
		{
			cliente: "Edgar Monterroso",
			vehiculo: ["Hyundai", "Tucson", "P-118QWE"],
			sifco: "01010214117598",
			bucket: 3,
			deuda: 96400,
			cuota: 4100,
			fecha: -64,
			intentos: 5,
			ultimo: 2,
			gestion: "sin_acuerdo",
			accion: { tipo: "llamar", fecha: hace(-1) },
			asesor: "R. Castillo",
			capital: 260000,
			etiquetas: ["juridico", "unidad_a_recuperar"],
		},
		9,
	),
];

const ETAPAS: EtapaOpcion[] = bucketsParaRender(undefined, ETAPAS_MORA).map(
	(b) => ({ key: b.key, label: labelBucketConCodigo(b) }),
);

const JUNIOR: PerfilVista = {
	esSupervision: false,
	sinAsesor: false,
	buckets: [0, 1],
};
const SUPERVISION: PerfilVista = {
	esSupervision: true,
	sinAsesor: false,
	buckets: [],
};

const RESUMEN: ResumenCartera = {
	asignados: 312,
	atencionHoy: 18,
	alDia: 74.2,
	cargando: false,
	porBucket: { B0: 231, B1: 81 },
};
const RESUMEN_SUP: ResumenCartera = {
	asignados: 1538,
	atencionHoy: 142,
	alDia: 68.4,
	cargando: false,
	parcial: true,
	porBucket: { B0: 980, B1: 260, B2: 141, B3: 77, B4: 52, B5: 28 },
};

const accionMasiva = (
	<ToolbarButton icon={MessageCircle}>Enviar WhatsApp masivo</ToolbarButton>
);

/** Vista con estado local (filtros, página, orden) para probarla a mano. */
function Demo(
	props: Partial<MiCarteraVistaProps> & {
		perfil: PerfilVista | undefined;
		filtrosIniciales?: Partial<FiltrosCartera>;
	},
) {
	const [filtros, setFiltros] = React.useState<FiltrosCartera>({
		...FILTROS_INICIALES,
		...props.filtrosIniciales,
	});
	const [pagina, setPagina] = React.useState(1);
	const [tamano, setTamano] = React.useState(25);
	const [orden, setOrden] = React.useState<OrdenCartera>(ORDEN_INICIAL);
	const filas = props.filas ?? FILAS;
	return (
		<div className="overflow-hidden rounded-2xl border border-line-subtle bg-canvas">
			<MiCarteraVista
				resumen={RESUMEN}
				filtros={filtros}
				onCambiarFiltros={(c) => setFiltros((f) => ({ ...f, ...c }))}
				onLimpiarFiltros={() => setFiltros(FILTROS_INICIALES)}
				etapas={ETAPAS}
				total={312}
				cargando={false}
				pagina={pagina}
				totalPaginas={Math.ceil((props.total ?? 312) / tamano) || 1}
				tamanoPagina={tamano}
				onPagina={setPagina}
				onTamanoPagina={setTamano}
				orden={orden}
				onOrden={setOrden}
				accionMasiva={accionMasiva}
				onVistaRapida={() => {}}
				{...props}
				filas={ordenarPagina(filas, orden)}
			/>
		</div>
	);
}

const VACIO = { filas: [] as FilaCartera[], total: 0 };

export default function CobrosMiCarteraShowcase() {
	return (
		<div className="space-y-8">
			<ShowcaseGroup title="Asesor junior (B0 y B1)">
				<div className="py-3">
					<Demo perfil={JUNIOR} />
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Supervisión (toda la cartera, filtros aplicados)">
				<div className="py-3">
					<Demo
						perfil={SUPERVISION}
						resumen={RESUMEN_SUP}
						filas={FILAS_SUPERVISION}
						total={1538}
						filtrosIniciales={{
							periodo: "mes",
							etiquetas: ["juridico"],
							capitalMin: 100000,
							gestion: "sin_gestion_48h",
						}}
					/>
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Popover «Filtros» (todos los filtros de antes)">
				<div className="max-w-[600px] py-3">
					<div className="rounded-xl border border-line-subtle bg-surface-raised p-5 shadow-dropdown">
						<PanelFiltrosCartera
							filtros={{
								...FILTROS_INICIALES,
								periodo: "semana",
								etapa: "mora_30",
								etiquetas: ["convenio", "reclamo"],
								excluirPagados: true,
							}}
							etapas={ETAPAS}
							onCambiar={() => {}}
							onLimpiar={() => {}}
							activos={4}
						/>
					</div>
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Estados">
				<div className="space-y-6 py-3">
					<p className="type-label-sm text-fg-tertiary">Cargando</p>
					<Demo
						perfil={undefined}
						resumen={{ ...RESUMEN, cargando: true }}
						cargando
						{...VACIO}
					/>
					<p className="type-label-sm text-fg-tertiary">
						Cargando la tabla (perfil ya cargado)
					</p>
					<Demo perfil={JUNIOR} cargando {...VACIO} />
					<p className="type-label-sm text-fg-tertiary">Sin asesor vinculado</p>
					<Demo perfil={{ ...JUNIOR, sinAsesor: true }} {...VACIO} />
					<p className="type-label-sm text-fg-tertiary">Sin cartera asignada</p>
					<Demo
						perfil={JUNIOR}
						resumen={{
							...RESUMEN,
							asignados: 0,
							atencionHoy: 0,
							alDia: null,
							porBucket: {},
						}}
						{...VACIO}
					/>
					<p className="type-label-sm text-fg-tertiary">Sin resultados</p>
					<Demo
						perfil={JUNIOR}
						filtrosIniciales={{ busqueda: "Zacarías", etiquetas: ["reclamo"] }}
						{...VACIO}
					/>
					<p className="type-label-sm text-fg-tertiary">
						Criterio sin pendientes (cartera sana)
					</p>
					<Demo
						perfil={JUNIOR}
						filtrosIniciales={{ gestion: "sin_contactar_hoy" }}
						{...VACIO}
					/>
					<p className="type-label-sm text-fg-tertiary">Error</p>
					<Demo
						perfil={JUNIOR}
						error="Cartera no respondió a tiempo."
						onReintentar={() => {}}
						{...VACIO}
					/>
				</div>
			</ShowcaseGroup>
		</div>
	);
}
