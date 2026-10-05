import {
	AlertItem,
	type AlertPriority,
	type AlertType,
	alertPriorityLabel,
	PanelAlertas,
} from "@/components/ds/alertas";
import { DistribucionBucket } from "@/components/ds/distribucion-bucket";
import { ShowcaseGroup, type ShowcaseMeta, ShowcaseRow } from "./_layout";

export const meta: ShowcaseMeta = {
	order: 160,
	title: "CRM · Alertas y distribución",
	figma:
		"03 · Componentes CRM › Panel de Alertas (Alert/Item, Panel/Alertas) · 🏦 Rescate & Supervisor › Distribución/Bucket",
	description:
		"Alert/Item = AlertItem: type (6 tipos) × priority critica·alta·media·informativa. Panel/Alertas = PanelAlertas (children = AlertItem). Distribución/Bucket = DistribucionBucket (segments con bg-bucket-bN).",
};

const tipos: { type: AlertType; description: string }[] = [
	{
		type: "promesa-vencida",
		description: "Crédito #48213 · venció hace 2 días",
	},
	{ type: "pago-recibido", description: "Q 5,000.00 · María José Contreras" },
	{ type: "cambio-bucket", description: "12 créditos migraron a B3" },
	{ type: "vehiculo-apagado", description: "Toyota Hilux · P-482GHT" },
	{ type: "gps-desconectado", description: "Nissan Frontier · hace 6 horas" },
	{ type: "caso-critico", description: "Requiere intervención inmediata" },
];

const prioridades: AlertPriority[] = [
	"critica",
	"alta",
	"media",
	"informativa",
];

export default function CrmAlertsShowcase() {
	return (
		<div className="space-y-6">
			<ShowcaseGroup title="Alert/Item · Tipo × Prioridad">
				<div className="grid grid-cols-[repeat(2,360px)] gap-x-5 gap-y-4 py-3">
					{prioridades.map((priority) => (
						<div key={priority} className="space-y-3">
							<p className="type-label-sm text-fg-tertiary">
								Prioridad · {alertPriorityLabel[priority]}
							</p>
							{tipos.map(({ type, description }) => (
								<AlertItem
									key={type}
									type={type}
									priority={priority}
									description={description}
								/>
							))}
						</div>
					))}
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Interactivo (onClick)">
				<ShowcaseRow label="Hover / focus">
					<div className="w-90 space-y-3">
						<AlertItem
							type="promesa-vencida"
							priority="critica"
							description="Crédito #48213 · venció hace 2 días"
							onClick={() => {}}
						/>
						<AlertItem
							type="caso-critico"
							priority="alta"
							description="Requiere intervención inmediata"
							onClick={() => {}}
						/>
					</div>
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Panel/Alertas">
				<ShowcaseRow label="Mostrar acción" className="items-start">
					<PanelAlertas className="w-105" newCount={4} onAction={() => {}}>
						<AlertItem
							type="promesa-vencida"
							priority="critica"
							description="Crédito #48213 · venció hace 2 días"
							onClick={() => {}}
						/>
						<AlertItem
							type="caso-critico"
							priority="alta"
							description="Requiere intervención inmediata"
							onClick={() => {}}
						/>
						<AlertItem
							type="cambio-bucket"
							priority="media"
							description="12 créditos migraron a B3"
							onClick={() => {}}
						/>
						<AlertItem
							type="pago-recibido"
							priority="informativa"
							description="Q 5,000.00 · María José Contreras"
							onClick={() => {}}
						/>
					</PanelAlertas>
					<PanelAlertas className="w-105" showAction={false}>
						<AlertItem
							type="gps-desconectado"
							priority="media"
							description="Nissan Frontier · hace 6 horas"
						/>
					</PanelAlertas>
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Distribución/Bucket">
				<ShowcaseRow label="2 segmentos (default)">
					<DistribucionBucket
						className="w-170"
						segments={[
							{ bucket: "B2", label: "B2 · Gestión", count: 312, percent: 50 },
							{ bucket: "B3", label: "B3 · Rescate", count: 312, percent: 50 },
						]}
					/>
				</ShowcaseRow>
				<ShowcaseRow label="5 segmentos B0–B4">
					<DistribucionBucket
						className="w-170"
						title="Cartera completa del equipo por bucket"
						subtitle="Ejemplo · 5 segmentos B0–B4 (mismo componente)"
						segments={[
							{ bucket: "B0", label: "B0 · Sana", count: 640, percent: 20 },
							{ bucket: "B1", label: "B1 · Alerta", count: 576, percent: 18 },
							{ bucket: "B2", label: "B2 · Gestión", count: 960, percent: 30 },
							{ bucket: "B3", label: "B3 · Rescate", count: 704, percent: 22 },
							{
								bucket: "B4",
								label: "B4 · Pre Jurídico",
								count: 320,
								percent: 10,
							},
						]}
					/>
				</ShowcaseRow>
			</ShowcaseGroup>
		</div>
	);
}
