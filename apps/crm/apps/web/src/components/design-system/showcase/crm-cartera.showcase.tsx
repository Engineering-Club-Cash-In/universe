import { House } from "lucide-react";
import * as React from "react";
import { BucketBadge, MoraBadge } from "@/components/ds/badges";
import {
	AsesorChip,
	EstadoGestion,
	TipoCartera,
} from "@/components/ds/cartera-chips";
import { AccionPendiente, SinContacto } from "@/components/ds/indicadores";
import {
	COLUMNAS_APROBACIONES,
	COLUMNAS_CARTERA_CON_ASESOR,
	FilaAprobaciones,
	FilaCredito,
	TablaCartera,
} from "@/components/ds/tabla-cartera";
import {
	CellAvatar,
	CellBadge,
	CellDinero,
	CellEstado,
	CellFecha,
} from "@/components/ds/table-cells";
import {
	GpsEstadoVehiculo,
	LocationRow,
	MapView,
	PhotoStrip,
	SegmentedNav,
	VolverButton,
} from "@/components/ds/ubicaciones";
import { Pagination } from "@/components/ui/pagination";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import { ShowcaseGroup, type ShowcaseMeta, ShowcaseRow } from "./_layout";

export const meta: ShowcaseMeta = {
	order: 180,
	title: "CRM · Tabla de cartera y ubicaciones",
	figma:
		"03 · Componentes CRM › Tabla de Cartera (Table/Cartera) · Cells de Tabla · Cartera/FilaCrédito · Cartera/FilaAprobaciones · Ubicaciones",
	description:
		"TablaCartera compone ui/table; las filas reciben badges, chips e indicadores como nodos. Hover de fila = brand-subtle (`activa` lo fija). Prioridad=True → `prioridad`. Asesor visible → COLUMNAS_CARTERA_CON_ASESOR.",
};

function Toolbar({ activo }: { activo?: "filtros" | "ordenar" }) {
	return (
		<>
			<ToolbarButton action="buscar" />
			<ToolbarButton action="filtros" active={activo === "filtros"} />
			<ToolbarButton action="ordenar" active={activo === "ordenar"} />
			<ToolbarButton action="columnas" />
		</>
	);
}

const ultimo = "11 ago 2026";

export default function CrmCarteraShowcase() {
	const [pagina, setPagina] = React.useState(1);
	const [vista, setVista] = React.useState("a");
	const [activa, setActiva] = React.useState<number | null>(1);

	return (
		<div className="space-y-6">
			<ShowcaseGroup title="Table/Cartera">
				<div className="py-3">
					<TablaCartera
						contador={1538}
						herramientas={<Toolbar />}
						pie={
							<Pagination
								page={pagina}
								pageCount={77}
								totalItems={1538}
								pageSize={20}
								onPageChange={setPagina}
							/>
						}
					>
						{[
							{
								cliente: "María José Contreras",
								detalle: "Toyota Hilux · P-482GHT",
								bucket: <BucketBadge bucket="B2" />,
								mora: <MoraBadge mora="Mora60" />,
								deuda: "Q 48,250.00",
								cuota: "Q3,200",
								fecha: "15 ago",
								seguimiento: (
									<SinContacto intentos={3} ultimoIntento={ultimo} />
								),
								estado: "Sin acuerdo",
								accion: (
									<AccionPendiente tipo="Llamar" detalle="hoy · 3:00 PM" />
								),
							},
							{
								cliente: "Luis Fernando Aguilar",
								detalle: "Nissan Frontier · P-201KLM",
								bucket: <BucketBadge bucket="B4" />,
								mora: <MoraBadge mora="Mora120" />,
								deuda: "Q 112,900.00",
								cuota: "Q2,900",
								fecha: "5 ago",
								seguimiento: (
									<SinContacto intentos={2} ultimoIntento={ultimo} />
								),
								estado: "Promesa incumplida",
								accion: (
									<AccionPendiente
										tipo="Promesa por vencer"
										detalle="vence hoy"
									/>
								),
							},
							{
								cliente: "Ana Lucía Morales",
								detalle: "Kia Sportage · P-773XYZ",
								bucket: <BucketBadge bucket="B0" />,
								mora: <MoraBadge mora="AlDia" />,
								deuda: "Q 18,400.00",
								cuota: "Q3,600",
								fecha: "28 jul",
								seguimiento: (
									<SinContacto intentos={1} ultimoIntento={ultimo} />
								),
								estado: "Promesa vigente",
								accion: (
									<AccionPendiente
										tipo="Promesa vencida"
										detalle="venció ayer"
									/>
								),
							},
							{
								cliente: "Roberto Cárcamo",
								detalle: "Mazda BT-50 · P-559ABC",
								bucket: <BucketBadge bucket="B3" />,
								mora: <MoraBadge mora="Mora90" />,
								deuda: "Q 67,120.00",
								cuota: "Q3,200",
								fecha: "20 ago",
								seguimiento: <SinContacto intentos={0} />,
								estado: "Sin acuerdo",
								accion: (
									<AccionPendiente
										tipo="Confirmar pago"
										detalle="recibido hoy"
									/>
								),
							},
						].map((f, i) => (
							<FilaCredito
								key={f.cliente}
								cliente={f.cliente}
								detalle={f.detalle}
								bucket={f.bucket}
								mora={f.mora}
								deudaVencida={f.deuda}
								cuotaNormal={f.cuota}
								fechaPago={f.fecha}
								seguimiento={f.seguimiento}
								estadoGestion={f.estado}
								accionPendiente={f.accion}
								activa={activa === i}
								onClick={() => setActiva(i)}
								className="cursor-pointer"
							/>
						))}
					</TablaCartera>
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Cartera/FilaCrédito · Asesor visible · Default / Hover · Prioridad">
				<div className="py-3">
					<TablaCartera
						titulo="Cartera del equipo"
						contador={2}
						herramientas={<Toolbar activo="filtros" />}
						columnas={COLUMNAS_CARTERA_CON_ASESOR}
						prioridad
					>
						{[false, true].map((hover, i) => (
							<FilaCredito
								key={String(hover)}
								prioridad={i + 1}
								cliente="María José Contreras"
								detalle="Toyota Hilux · P-482GHT"
								asesor={<AsesorChip nombre="J. Pérez" iniciales="LF" />}
								bucket={<BucketBadge bucket="B1" />}
								mora={<MoraBadge mora="Mora30" />}
								deudaVencida={48250}
								cuotaNormal="Q3,200"
								fechaPago="15 ago"
								seguimiento={
									<SinContacto intentos={3} ultimoIntento={ultimo} />
								}
								estadoGestion={<EstadoGestion estado="Sin acuerdo" />}
								accionPendiente={
									<AccionPendiente tipo="Llamar" detalle="hoy · 3:00 PM" />
								}
								activa={hover}
							/>
						))}
					</TablaCartera>
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Cartera/FilaAprobaciones · Default / Hover">
				<div className="py-3">
					<TablaCartera
						titulo="Aprobaciones pendientes"
						contador="2 solicitudes"
						columnas={COLUMNAS_APROBACIONES}
					>
						{[false, true].map((hover) => (
							<FilaAprobaciones
								key={String(hover)}
								cliente="Roberto Cárcamo"
								detalle="Crédito #47120"
								asesor={<AsesorChip nombre="A. Díaz" iniciales="RC" />}
								tipo={<TipoCartera tipo="Documentos" />}
								fecha="hace 2 días"
								bucket={<BucketBadge bucket="B4" formato="Completa" />}
								activa={hover}
							/>
						))}
					</TablaCartera>
				</div>
				<ShowcaseRow label="Sin filas" className="block">
					<TablaCartera
						titulo="Aprobaciones pendientes"
						contador="0 solicitudes"
						columnas={COLUMNAS_APROBACIONES}
						vacio="No hay solicitudes pendientes de aprobación."
					/>
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Cells de Tabla">
				<ShowcaseRow label="Cell/Avatar">
					<CellAvatar
						nombre="María José Contreras"
						subtitulo="Toyota Hilux · P-482GHT"
					/>
				</ShowcaseRow>
				<ShowcaseRow label="Cell/Dinero">
					<CellDinero monto={48250} className="border-divider border-r" />
					<CellDinero monto="—" />
				</ShowcaseRow>
				<ShowcaseRow label="Cell/Fecha">
					<CellFecha fecha="15 jul 2026" relativo="hace 3 días" />
					<CellFecha fecha={new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)} />
				</ShowcaseRow>
				<ShowcaseRow label="Cell/Badge">
					<CellBadge>
						<MoraBadge mora="Mora60" />
					</CellBadge>
				</ShowcaseRow>
				<ShowcaseRow label="Cell/Estado">
					<CellEstado>
						<BucketBadge bucket="B2" />
					</CellEstado>
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Ubicaciones">
				<ShowcaseRow label="MapView" className="items-start">
					<MapView />
					<MapView
						pins={[
							{ x: 30, y: 40, etiqueta: "Casa" },
							{ x: 72, y: 70, etiqueta: "Trabajo" },
						]}
						etiqueta="Últimas 2 ubicaciones"
					/>
				</ShowcaseRow>
				<ShowcaseRow label="LocationRow" className="items-start">
					<div className="w-90 space-y-2">
						<LocationRow
							nombre="Casa"
							descripcion="Residencia habitual · Z.10"
							frecuencia="62% del tiempo"
						/>
						<LocationRow
							nombre="Trabajo"
							descripcion="Oficinas Torre Reforma · Z.9"
							frecuencia="28% del tiempo"
							icono={<House />}
						/>
					</div>
				</ShowcaseRow>
				<ShowcaseRow label="PhotoStrip">
					<PhotoStrip
						fotos={Array.from({ length: 7 }, () => ({}))}
						onFotoClick={() => {}}
						onVerMas={() => {}}
					/>
				</ShowcaseRow>
				<ShowcaseRow label="GPS/EstadoVehiculo">
					<GpsEstadoVehiculo estado="detenido" />
					<GpsEstadoVehiculo estado="en-movimiento" />
				</ShowcaseRow>
				<ShowcaseRow label="SegmentedNav">
					<SegmentedNav
						value={vista}
						onValueChange={setVista}
						opciones={[
							{ value: "a", label: "Opción A" },
							{ value: "b", label: "Opción B" },
						]}
					/>
				</ShowcaseRow>
				<ShowcaseRow label="Nav/VolverButton">
					<VolverButton />
					<VolverButton disabled />
				</ShowcaseRow>
			</ShowcaseGroup>
		</div>
	);
}
