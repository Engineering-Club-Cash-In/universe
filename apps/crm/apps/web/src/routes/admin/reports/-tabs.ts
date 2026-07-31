export type ReportTab =
	| "creditos"
	| "cobranza"
	| "inversiones"
	| "colocacion"
	| "proyeccion-liquidaciones";

export function getReportTabs({
	canAccessClosedCreditsReport,
	canAccessCobranzaReport,
	isAdmin,
}: {
	canAccessClosedCreditsReport: boolean;
	canAccessCobranzaReport: boolean;
	isAdmin: boolean;
}): { tabs: ReportTab[]; defaultTab: ReportTab } {
	const tabs: ReportTab[] = [];
	if (canAccessClosedCreditsReport) tabs.push("creditos");
	if (canAccessCobranzaReport) tabs.push("cobranza");
	if (isAdmin) {
		tabs.push("inversiones", "colocacion", "proyeccion-liquidaciones");
	}
	return { tabs, defaultTab: tabs[0] ?? "cobranza" };
}
