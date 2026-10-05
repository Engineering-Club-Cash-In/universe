import { MapPin } from "lucide-react";
import { ActionCrm } from "@/components/ds/action-crm";
import {
	BucketBadge,
	ConvenioBadge,
	MoraBadge,
	PromesaBadge,
} from "@/components/ds/badges";
import { CardAprobacion } from "@/components/ds/card-aprobacion";
import { CardAsesor } from "@/components/ds/card-asesor";
import {
	CardCobro,
	CardConvenio,
	CardEstadoCuenta,
	CardModuleEntry,
	CardPromesa,
	CardProximaAccion,
} from "@/components/ds/cards-cobranza";
import {
	CardCliente,
	CardCredito,
	CardReferencia,
	CardSeguro,
	CardVehiculo,
	CrmPill,
} from "@/components/ds/cards-credito";
import { ProximaAccionCell } from "@/components/ds/proxima-accion-cell";
import { ShowcaseGroup, type ShowcaseMeta, ShowcaseRow } from "./_layout";

export const meta: ShowcaseMeta = {
	order: 130,
	title: "CRM · Cards",
	figma:
		"03 · Componentes CRM › Card · Crédito/Cliente/Vehículo/Referencia/Promesa/Convenio/Asesor/Seguro/Próxima Acción, Cards · Cobranza, Card/Aprobación",
	description:
		"Cards de presentación (ds/cards-credito, ds/cards-cobranza, ds/card-asesor, ds/card-aprobacion). Los badges y la acción principal entran como slots (React.ReactNode). Ancho fluido: aquí se fijan los anchos de Figma.",
};

const prioridades = ["alta", "media", "baja"] as const;

export default function CrmCardsShowcase() {
	return (
		<div className="space-y-6">
			<ShowcaseGroup title="Card · Crédito">
				<ShowcaseRow label="Prioridad=Alta · Media · Baja" className="gap-6">
					{prioridades.map((p) => (
						<CardCredito
							key={p}
							className="w-90"
							prioridad={p}
							bucket={<BucketBadge bucket="B2" formato="Completa" />}
							cliente="María José Contreras"
							vehiculo="Toyota Hilux 2021"
							placa="P-482GHT"
							accion="Llamar — seguimiento de promesa"
							mora={<MoraBadge mora="Mora60" />}
							saldo="Q 48,250.00"
							ultimoContacto="Hace 3 días"
							asesor="C. Ramírez"
						/>
					))}
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Card · Cliente · Vehículo · Referencia">
				<ShowcaseRow label="Default" className="items-start gap-6">
					<CardCliente
						className="w-85"
						nombre="María José Contreras"
						documento="DPI 2547 88213 0101"
						telefono="5521-4478"
						creditosActivos={2}
						ciudad="Guatemala"
						contactabilidad="alta"
					/>
					<CardVehiculo
						className="w-85"
						vehiculo="Toyota Hilux 2021"
						placa="P-482GHT"
						ubicacion={<CrmPill tone="success">Ubicado</CrmPill>}
						color="Blanco"
						motor="2.4L Diesel"
						chasis="…83402"
						estado="Operativo"
						gps="Activo"
					/>
					<CardReferencia
						className="w-85"
						nombre="Jorge López Méndez"
						iniciales="JL"
						tipo="Referencia familiar"
						telefono="4788-1120"
						parentesco="Hermano"
						ultimoContacto="Hace 2 días"
						resultado={<CrmPill tone="info">Contactado — dará razón</CrmPill>}
					/>
				</ShowcaseRow>
				<ShowcaseRow label="Contactabilidad / estado" className="gap-6">
					<CardCliente
						className="w-85"
						nombre="Luis Fernando Ajú Pérez"
						documento="DPI 3011 45520 0108"
						telefono="4410-2290"
						creditosActivos={1}
						ciudad="Mixco"
						contactabilidad="baja"
					/>
					<CardVehiculo
						className="w-85"
						vehiculo="Nissan Frontier 2019"
						placa="C-117BKD"
						ubicacion={<CrmPill tone="warning">Sin ubicar</CrmPill>}
						color="Gris"
						motor="2.5L Diesel"
						chasis="…19044"
						estado="Inmovilizado"
						estadoTone="danger"
						gps="Sin señal"
					/>
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Card · Promesa de pago · Convenio · Seguro">
				<ShowcaseRow label="Default" className="items-start gap-6">
					<CardPromesa
						className="w-85"
						estado={<PromesaBadge promesa="Pendiente" />}
						monto="Q 5,000.00"
						fechaCompromiso="15 / 07 / 2026"
						responsable="C. Ramírez"
					/>
					<CardConvenio
						className="w-85"
						estado={<ConvenioBadge convenio="Activo" />}
						montoTotal="Q 48,250"
						cuotas={6}
						cuotaMensual="Q 8,041"
						cuotasPagadas={2}
					/>
					<CardSeguro
						className="w-100"
						aseguradora="Seguros G&T"
						tipoSeguro="Cobertura amplia"
						telefonoEmergencia="1-801-SEGURO"
						coberturas="Daños, robo y RC"
					/>
				</ShowcaseRow>
				<ShowcaseRow label="Otros estados" className="items-start gap-6">
					<CardPromesa
						className="w-85"
						estado={<PromesaBadge promesa="Incumplida" />}
						monto="Q 2,750.00"
						fechaCompromiso="02 / 07 / 2026"
						responsable="A. Gómez"
					/>
					<CardConvenio
						className="w-85"
						estado={<ConvenioBadge convenio="Finalizado" />}
						montoTotal="Q 12,000"
						cuotas={4}
						cuotaMensual="Q 3,000"
						cuotasPagadas={4}
					/>
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Card · Asesor">
				<ShowcaseRow
					label="Estado=Default · Hover"
					className="items-start gap-6"
				>
					{(["default", "hover"] as const).map((estado) => (
						<CardAsesor
							key={estado}
							className="w-80"
							estado={estado}
							nombre="Carlos Ramírez"
							iniciales="CR"
							rol="Asesor Senior"
							creditosAsignados={40}
							distribucion={[
								{ bucket: "B1", cantidad: 12 },
								{ bucket: "B2", cantidad: 20 },
								{ bucket: "B3", cantidad: 8 },
							]}
							gestionesCumplidas="18 / 20"
							contactabilidad="92%"
							recuperacion={{ porcentaje: 92, detalle: "Q 8.4M de Q 9.1M" }}
						/>
					))}
				</ShowcaseRow>
				<ShowcaseRow
					label="Ausente · Default · Hover"
					className="items-start gap-6"
				>
					{(["default", "hover"] as const).map((estado) => (
						<CardAsesor
							key={estado}
							className="w-89"
							estado={estado}
							nombre="Diego Morales"
							iniciales="DM"
							rol="Asesor Junior"
							ausencia="Ausente · Vacaciones · vuelve el 30 sep"
							onReactivar={() => {}}
							creditosAsignados={31}
							distribucion={[{ bucket: "B1", cantidad: 31 }]}
							gestionesCumplidas="17 / 23"
							contactabilidad="74%"
							recuperacion={{ porcentaje: 74, detalle: "Q 2.6M de Q 3.5M" }}
						/>
					))}
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Card · Próxima acción">
				<ShowcaseRow label="Prioridad=Alta · Media · Baja" className="gap-6">
					{prioridades.map((p) => (
						<CardProximaAccion
							key={p}
							className="w-90"
							prioridad={p}
							tipo={<ProximaAccionCell accion="Llamar" />}
							accion="Llamar — seguimiento de promesa"
							responsable="C. Ramírez"
							fecha="15 jul 2026"
							hora="10:00 AM"
							cta={<ActionCrm accion="registrar-gestion" className="w-full" />}
						/>
					))}
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Cards · Cobranza">
				<ShowcaseRow
					label="Cobro · Estado de cuenta"
					className="items-start gap-6"
				>
					<CardCobro
						className="w-100"
						conceptos={[
							{ label: "1 cuota vencida", monto: "Q 3,200.00" },
							{ label: "Mora acumulada", monto: "Q 200.00" },
						]}
						total="Q 3,400.00"
						contexto={[
							"Cuota mensual Q3,200",
							"30 días en mora",
							"Saldo pendiente Q41,600",
						]}
					/>
					<CardEstadoCuenta
						className="w-100"
						diasAtraso={30}
						estado="En mora"
						ultimoAbono="Q 2,650.00"
						fechaUltimoPago="28 jun 2026"
						proximoVencimiento="05 ago 2026"
						cuotasPagadas="18 de 48"
					/>
				</ShowcaseRow>
				<ShowcaseRow
					label="Cobro con detalle · al día"
					className="items-start gap-6"
				>
					<CardCobro
						className="w-100"
						conceptos={[
							{
								label: "2 cuotas vencidas",
								detalle: "Q3,200 c/u",
								monto: "Q 6,400.00",
							},
							{ label: "Mora acumulada", monto: "Q 480.00" },
						]}
						total="Q 6,880.00"
						contexto={["Cuota mensual Q3,200", "62 días en mora"]}
					/>
					<CardEstadoCuenta
						className="w-100"
						diasAtraso={0}
						estado="Al día"
						ultimoAbono="Q 3,200.00"
						fechaUltimoPago="05 jul 2026"
						proximoVencimiento="05 ago 2026"
						cuotasPagadas="19 de 48"
					/>
				</ShowcaseRow>
				<ShowcaseRow label="Module entry">
					<CardModuleEntry
						className="w-90"
						icon={<MapPin aria-hidden />}
						titulo="Título"
						subtitulo="Subtítulo"
					/>
					<CardModuleEntry
						className="w-90"
						icon={<MapPin aria-hidden />}
						titulo="Ubicaciones"
						subtitulo="GPS y direcciones del cliente"
					/>
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Card · Aprobación">
				<ShowcaseRow label="Tipo=Convenio" className="block">
					<CardAprobacion
						className="max-w-150"
						tipo="convenio"
						solicitante="Marta Gómez · Asesor Senior"
						detalles={[
							{ label: "Propuesta", value: "Q 3,600 / mes · 6 meses" },
							{ label: "Monto total", value: "Q 21,600" },
							{
								label: "Estado",
								value: "Propuesto · pendiente de aprobación",
							},
						]}
						onAprobar={() => {}}
						onRechazar={() => {}}
					/>
				</ShowcaseRow>
				<ShowcaseRow label="Tipo=Entrega" className="block">
					<CardAprobacion
						className="max-w-150"
						tipo="entrega"
						solicitante="Marta Gómez · Asesor Senior"
						detalles={[
							{
								label: "Condición propuesta",
								value: "Entrega voluntaria de la unidad",
							},
							{
								label: "Estado del cliente",
								value: "Sin acuerdo de pago viable",
							},
							{
								label: "Efecto esperado",
								value: "Detiene avance a recuperación judicial",
							},
						]}
						onAprobar={() => {}}
						onRechazar={() => {}}
					/>
				</ShowcaseRow>
				<ShowcaseRow label="Tipo=Acción crítica · aprobando" className="block">
					<CardAprobacion
						className="max-w-150"
						tipo="accion-critica"
						solicitante="Marta Gómez · Asesor Senior"
						detalles={[
							{
								label: "Acción solicitada",
								value: "Apagado remoto de la unidad",
							},
							{
								label: "Motivo",
								value: "3 intentos sin contacto (5 días hábiles)",
							},
							{ label: "Requisito", value: "Autorización del Supervisor" },
						]}
						onAprobar={() => {}}
						onRechazar={() => {}}
						aprobando
					/>
				</ShowcaseRow>
			</ShowcaseGroup>
		</div>
	);
}
