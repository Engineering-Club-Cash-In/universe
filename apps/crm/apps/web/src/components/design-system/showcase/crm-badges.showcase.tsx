import {
	AccionBadge,
	type Bucket,
	BucketBadge,
	ConvenioBadge,
	GestionBadge,
	type Mora,
	MoraBadge,
	PromesaBadge,
} from "@/components/ds/badges";
import {
	AsesorChip,
	EstadoGestion,
	FilterChip,
	TipoCartera,
} from "@/components/ds/cartera-chips";
import {
	AccionPendiente,
	ProximoContacto,
	SinContacto,
} from "@/components/ds/indicadores";
import {
	type ProximaAccion,
	ProximaAccionCell,
} from "@/components/ds/proxima-accion-cell";
import { ShowcaseGroup, type ShowcaseMeta, ShowcaseRow } from "./_layout";

export const meta: ShowcaseMeta = {
	order: 110,
	title: "CRM · Badges e indicadores",
	figma:
		"03 · Componentes CRM › Badges (Bucket, Mora, Promesa, Convenio, Acción, Gestión) · Cartera › Indicador/SinContacto, Info/AccionPendiente, EstadoGestión, Asesor, Tipo, FilterChip · Seguimiento de contacto · Próxima Acción",
	description:
		"Componentes de presentación en components/ds/. Bucket = etapa operativa (B0–B5); Mora = condición financiera por días de atraso, independiente del bucket.",
};

const buckets: Bucket[] = ["B0", "B1", "B2", "B3", "B4", "B5"];
const moras: Mora[] = ["AlDia", "Mora30", "Mora60", "Mora90", "Mora120"];
const acciones: ProximaAccion[] = [
	"Llamar",
	"SeguirPromesa",
	"Referencias",
	"Juridico",
	"Visita",
	"Ninguna",
];

export default function CrmBadgesShowcase() {
	return (
		<div className="space-y-6">
			<ShowcaseGroup title="Badge/Bucket">
				<ShowcaseRow label="Compacta">
					{buckets.map((b) => (
						<BucketBadge key={b} bucket={b} />
					))}
				</ShowcaseRow>
				<ShowcaseRow label="Completa">
					{buckets.map((b) => (
						<BucketBadge key={b} bucket={b} formato="Completa" />
					))}
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Badge/Mora">
				<ShowcaseRow label="mora">
					{moras.map((m) => (
						<MoraBadge key={m} mora={m} />
					))}
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Badges de estado y tipo">
				<ShowcaseRow label="Promesa">
					<PromesaBadge promesa="Pendiente" />
					<PromesaBadge promesa="Cumplida" />
					<PromesaBadge promesa="Incumplida" />
					<PromesaBadge promesa="Vigente" />
					<PromesaBadge promesa="Cancelada" />
				</ShowcaseRow>
				<ShowcaseRow label="Convenio">
					<ConvenioBadge convenio="Activo" />
					<ConvenioBadge convenio="Finalizado" />
					<ConvenioBadge convenio="Incumplido" />
				</ShowcaseRow>
				<ShowcaseRow label="Acción">
					<AccionBadge accion="Llamada" />
					<AccionBadge accion="WhatsApp" />
					<AccionBadge accion="SMS" />
					<AccionBadge accion="Correo" />
					<AccionBadge accion="Visita" />
				</ShowcaseRow>
				<ShowcaseRow label="Gestión">
					<GestionBadge gestion="Promesa" />
					<GestionBadge gestion="Convenio" />
					<GestionBadge gestion="Reestructura" />
					<GestionBadge gestion="Apagado" />
					<GestionBadge gestion="Recuperacion" />
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Cell/PróximaAcción">
				<ShowcaseRow label="accion">
					{acciones.map((a) => (
						<ProximaAccionCell key={a} accion={a} />
					))}
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Seguimiento de contacto">
				<ShowcaseRow label="Indicador/SinContacto" className="gap-10">
					<SinContacto intentos={2} ultimoIntento="11 ago 2026" />
					<SinContacto intentos={0} />
					<SinContacto intentos={1} ultimoIntento="11 ago 2026" />
				</ShowcaseRow>
				<ShowcaseRow label="Info/ProximoContacto" className="gap-10">
					<ProximoContacto estado="Programado" valor="12 ago · 3:00 PM" />
					<ProximoContacto estado="Hoy" />
					<ProximoContacto estado="SinProgramar" />
				</ShowcaseRow>
				<ShowcaseRow label="Info/AccionPendiente" className="gap-8">
					<AccionPendiente tipo="Llamar" detalle="hoy · 3:00 PM" />
					<AccionPendiente tipo="Promesa por vencer" detalle="vence hoy" />
					<AccionPendiente tipo="Promesa vencida" detalle="venció ayer" />
					<AccionPendiente tipo="Confirmar pago" detalle="recibido hoy" />
					<AccionPendiente tipo="Contactar referencia" detalle="pendiente" />
					<AccionPendiente tipo="Sin intento" detalle="72 h restantes" />
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Cartera">
				<ShowcaseRow label="EstadoGestión">
					<EstadoGestion estado="Sin acuerdo" />
					<EstadoGestion estado="Convenio vigente" />
					<EstadoGestion estado="Promesa incumplida" />
				</ShowcaseRow>
				<ShowcaseRow label="Asesor">
					<AsesorChip nombre="J. Pérez" iniciales="LF" />
					<AsesorChip nombre="A. Díaz" />
				</ShowcaseRow>
				<ShowcaseRow label="Tipo">
					<TipoCartera tipo="Documentos" />
					<TipoCartera tipo="Entrega" />
					<TipoCartera tipo="Rebaja" />
					<TipoCartera tipo="Convenio" />
					<TipoCartera tipo="Crítica" />
				</ShowcaseRow>
				<ShowcaseRow label="FilterChip">
					<FilterChip cantidad={312}>Todos</FilterChip>
					{/* Hover forzado para la captura; en uso real lo pone :hover. */}
					<FilterChip cantidad={312} className="border-line bg-surface-raised">
						Todos
					</FilterChip>
					<FilterChip cantidad={312} seleccionado>
						Todos
					</FilterChip>
				</ShowcaseRow>
			</ShowcaseGroup>
		</div>
	);
}
