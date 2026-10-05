type CompanyRelationshipCountRow = {
	companyId: string | null;
	total: number;
};

type CompanyRelationshipCounts = {
	leads: CompanyRelationshipCountRow[];
	opportunities: CompanyRelationshipCountRow[];
	clients: CompanyRelationshipCountRow[];
};

type CompanyRelationshipStats = {
	companyId: string;
	leads: number;
	opportunities: number;
	clients: number;
};

export function mergeCompanyRelationshipStats({
	leads,
	opportunities,
	clients,
}: CompanyRelationshipCounts): CompanyRelationshipStats[] {
	const statsByCompany = new Map<string, CompanyRelationshipStats>();

	const mergeRows = (
		rows: CompanyRelationshipCountRow[],
		key: "leads" | "opportunities" | "clients",
	) => {
		for (const row of rows) {
			if (!row.companyId) continue;
			const stats = statsByCompany.get(row.companyId) ?? {
				companyId: row.companyId,
				leads: 0,
				opportunities: 0,
				clients: 0,
			};
			stats[key] = Number(row.total) || 0;
			statsByCompany.set(row.companyId, stats);
		}
	};

	mergeRows(leads, "leads");
	mergeRows(opportunities, "opportunities");
	mergeRows(clients, "clients");

	return [...statsByCompany.values()].sort((a, b) =>
		a.companyId.localeCompare(b.companyId),
	);
}
