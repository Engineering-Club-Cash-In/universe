import { CircleAlert } from "lucide-react";
import { DashboardRoleHeader } from "@/components/ds/dashboard-role-header";
import {
	KpiDesglose,
	KpiDistribucion,
	type KpiDistribucionItem,
	KpiMeta,
	KpiRanking,
	type KpiRankingItem,
	KpiSimple,
	KpiTrend,
} from "@/components/ds/kpi";
import { ShowcaseGroup, type ShowcaseMeta, ShowcaseRow } from "./_layout";

export const meta: ShowcaseMeta = {
	order: 150,
	title: "CRM · KPIs y dashboards",
	figma:
		"03 · Componentes CRM › Componentes Fuente (Masters) · KPI Cards — Catálogo de Tipos · Dashboard · Asesor/Supervisor/Gerencia",
	description:
		"KPI/Simple=KpiSimple (trend positiva·negativa·neutra) · KPI/Meta=KpiMeta · KPI/Desglose=KpiDesglose · KPI/Distribución=KpiDistribucion · KPI/Ranking=KpiRanking · KPI/Trend=KpiTrend · Dashboard/RoleHeader=DashboardRoleHeader (role asesor·supervisor·gerencia). Ancho fluido: lo pone la retícula.",
};

const distribucion: KpiDistribucionItem[] = [
	{ label: "B0", bucket: "B0", percent: 48 },
	{ label: "B1", bucket: "B1", percent: 18 },
	{ label: "B2", bucket: "B2", percent: 14 },
	{ label: "B3", bucket: "B3", percent: 10 },
	{ label: "B4", bucket: "B4", percent: 6 },
	{ label: "B5", bucket: "B5", percent: 4 },
];

const ranking: KpiRankingItem[] = [
	{ name: "Carlos Ramírez", value: "92%", tone: "success" },
	{ name: "Andrea Solís", value: "88%", tone: "success" },
	{ name: "Luis Marroquín", value: "83%", tone: "good" },
	{ name: "María Gómez", value: "76%", tone: "warning" },
];

const desglose = [
	{ value: 5, label: "convenios pendientes de aprobación" },
	{ value: 3, label: "promesas incumplidas" },
	{ value: 10, label: "sin gestión > 48h" },
];

const serie = {
	positiva: [14, 18, 15, 26, 23, 33, 37, 44],
	negativa: [44, 41, 43, 33, 30, 26, 20, 12],
	neutra: [22, 46, 14, 36, 22, 30, 14, 26],
} as const;

const info = "Descripción del indicador.";

export default function CrmKpiShowcase() {
	return (
		<div className="space-y-6">
			<ShowcaseGroup title="KPI/Simple">
				<ShowcaseRow label="Tendencia × Icono">
					<KpiSimple
						className="w-60"
						title="Título del KPI"
						info={info}
						value="000"
						trend="positiva"
						trendValue="+0%"
						comparison="vs. período anterior"
					/>
					<KpiSimple
						className="w-60"
						title="Título del KPI"
						value="000"
						trend="negativa"
						trendValue="+0%"
						comparison="vs. período anterior"
					/>
					<KpiSimple
						className="w-60"
						title="Título del KPI"
						value="000"
						trend="neutra"
						trendValue="+0%"
						comparison="vs. período anterior"
					/>
				</ShowcaseRow>
				<ShowcaseRow label="Sin ícono / sin tendencia">
					<KpiSimple
						className="w-60"
						title="Acciones pendientes hoy"
						info={info}
						value="18"
						showIcon={false}
					/>
					<KpiSimple
						className="w-60"
						title="Promesas por vencer hoy"
						value="6"
					/>
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="KPI/Meta · KPI/Desglose">
				<ShowcaseRow label="Meta / Desglose" className="items-start">
					<KpiMeta
						className="w-75"
						title="Recuperación del mes"
						info={info}
						value="Q 8.5M"
						target="/ Q 9.2M"
						progress={92}
						progressLabel="92% de la meta mensual"
						trend="positiva"
						trendValue="+8%"
					/>
					<KpiDesglose
						className="w-75"
						title="Casos críticos"
						value="18"
						icon={CircleAlert}
						items={desglose}
					/>
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="KPI/Distribución · KPI/Ranking">
				<ShowcaseRow label="Distribución / Ranking" className="items-start">
					<KpiDistribucion
						className="w-85"
						title="Distribución por Bucket"
						items={distribucion}
						onItemClick={() => {}}
					/>
					<KpiRanking
						className="w-75"
						title="Ranking de asesores"
						period="Mes actual"
						items={ranking}
					/>
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="KPI/Trend">
				<ShowcaseRow label="Tendencia" className="items-start">
					{(["positiva", "negativa", "neutra"] as const).map((t) => (
						<KpiTrend
							key={t}
							className="w-75"
							title="Recuperación mensual"
							value="Q 8.5M"
							trend={t}
							trendValue="+12%"
							data={[...serie[t]]}
							range={["Feb", "Jul"]}
						/>
					))}
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Dashboard/RoleHeader">
				<div className="space-y-4 py-3">
					<DashboardRoleHeader rol="asesor" />
					<DashboardRoleHeader rol="supervisor" />
					<DashboardRoleHeader rol="gerencia" />
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Composición · Dashboard Asesor">
				<div className="space-y-4 py-3">
					<DashboardRoleHeader rol="asesor" />
					<div className="grid grid-cols-3 gap-4">
						<KpiSimple
							title="Acciones pendientes hoy"
							info={info}
							value="18"
							showIcon={false}
						/>
						<KpiSimple
							title="Cartera asignada"
							info={info}
							value="143"
							trendValue="+12"
							comparison="vs. mes anterior"
						/>
						<KpiSimple title="Promesas por vencer hoy" value="6" />
						<KpiSimple
							title="Gestiones de hoy"
							info={info}
							value="34"
							trendValue="+9"
							comparison="vs. promedio diario"
						/>
						<KpiSimple
							title="Efectividad de recuperación"
							info={info}
							value="82%"
							trendValue="+4%"
							comparison="vs. mes anterior"
						/>
						<KpiSimple
							title="Recuperado hoy"
							info={info}
							value="Q 42,350"
							trendValue="+6%"
							comparison="vs. promedio diario"
						/>
					</div>
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Composición · Dashboard Supervisor">
				<div className="space-y-4 py-3">
					<DashboardRoleHeader rol="supervisor" />
					<div className="grid grid-cols-4 gap-4">
						<KpiSimple title="Casos críticos" value="18" />
						<KpiSimple
							title="Cumplimiento del equipo"
							info={info}
							value="86%"
							trendValue="+3%"
							comparison="meta mensual"
						/>
						<KpiSimple title="Cartera supervisada" value="1,538" />
						<KpiSimple
							title="Migración a Bucket crítico"
							value="12"
							trend="negativa"
							trendValue="-5"
							comparison="vs. período anterior"
						/>
					</div>
					<div className="grid grid-cols-2 gap-4">
						<KpiDistribucion
							title="Distribución por Bucket"
							items={distribucion}
						/>
						<KpiRanking
							title="Ranking de asesores"
							period="Mes actual"
							items={ranking}
						/>
					</div>
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Composición · Dashboard Gerencia">
				<div className="space-y-4 py-3">
					<DashboardRoleHeader rol="gerencia" />
					<div className="grid grid-cols-4 gap-4">
						<KpiMeta
							className="col-span-2"
							title="Recuperación del mes"
							info={info}
							value="Q 8.5M"
							target="/ Q 9.2M"
							progress={47}
							progressLabel="92% de la meta mensual"
							trendValue="+8%"
						/>
						<KpiSimple
							title="Cartera sana"
							info={info}
							value="73%"
							trendValue="+2%"
							comparison="del total"
						/>
						<KpiSimple
							title="Capital en riesgo"
							info={info}
							value="Q 12.4M"
							trendValue="-4%"
							comparison="vs. mes anterior"
						/>
						<KpiSimple
							title="Efectividad global"
							info={info}
							value="87%"
							trendValue="+1%"
							comparison="recuperación efectiva"
						/>
						<KpiSimple
							title="Tiempo prom. recuperación"
							info={info}
							value="41 días"
							trendValue="-3d"
							comparison="más rápido"
						/>
						<KpiDistribucion
							className="col-span-2"
							title="Distribución por Bucket"
							items={distribucion}
						/>
					</div>
					<KpiTrend
						title="Evolución de la recuperación"
						value="Q 8.5M"
						trendValue="+12%"
						data={[5.1, 5.8, 5.4, 6.6, 6.9, 7.4, 7.2, 8.0, 8.5]}
						range={["Nov", "Jul"]}
					/>
				</div>
			</ShowcaseGroup>
		</div>
	);
}
