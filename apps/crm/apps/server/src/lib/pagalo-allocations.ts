/** Cálculo puro de links Págalo. Centavos BigInt; nunca Number monetario. */
export type PagaloInstallment = {
	cuotaId: number;
	numeroCuota: number;
	capital?: string | null;
	interes?: string | null;
	iva?: string | null;
	seguro?: string | null;
	gps?: string | null;
	membresias?: string | null;
};

export type PagaloAllocation = {
	link_type: "CAPITAL" | "MORA_INTERES";
	cartera_cuota_id: number;
	numero_cuota: number;
	rubro:
		| "CAPITAL"
		| "INTERES"
		| "IVA"
		| "SEGURO"
		| "GPS"
		| "MEMBRESIAS"
		| "MORA"
		| "OTROS";
	amount: string;
	facturable: boolean;
};

const cents = (value: string | null | undefined) => {
	const match = String(value ?? "0")
		.trim()
		.match(/^(\d+)(?:\.(\d{1,2}))?$/);
	if (!match) throw new Error("Monto de cartera inválido para Págalo.");
	return BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
};
const money = (amount: bigint) =>
	`${amount / 100n}.${String(amount % 100n).padStart(2, "0")}`;

export function buildPagaloAllocations({
	installments,
	mora,
	otros,
}: {
	installments: PagaloInstallment[];
	mora: string | null | undefined;
	otros?: string | null;
}) {
	if (installments.length === 0)
		throw new Error("Seleccione al menos una cuota.");
	const allocations: PagaloAllocation[] = [];
	let capitalCents = 0n;
	let facturableCents = 0n;
	const add = (
		link_type: PagaloAllocation["link_type"],
		cuota: PagaloInstallment,
		rubro: PagaloAllocation["rubro"],
		value: string | null | undefined,
	) => {
		const amount = cents(value);
		if (amount === 0n) return;
		allocations.push({
			link_type,
			cartera_cuota_id: cuota.cuotaId,
			numero_cuota: cuota.numeroCuota,
			rubro,
			amount: money(amount),
			facturable: link_type === "MORA_INTERES",
		});
		if (link_type === "CAPITAL") capitalCents += amount;
		else facturableCents += amount;
	};
	for (const cuota of installments) {
		add("CAPITAL", cuota, "CAPITAL", cuota.capital);
		add("MORA_INTERES", cuota, "INTERES", cuota.interes);
		add("MORA_INTERES", cuota, "IVA", cuota.iva);
		add("MORA_INTERES", cuota, "SEGURO", cuota.seguro);
		add("MORA_INTERES", cuota, "GPS", cuota.gps);
		add("MORA_INTERES", cuota, "MEMBRESIAS", cuota.membresias);
	}
	const moraCents = cents(mora);
	if (moraCents > 0n) {
		const first = installments[0]!;
		allocations.unshift({
			link_type: "MORA_INTERES",
			cartera_cuota_id: first.cuotaId,
			numero_cuota: first.numeroCuota,
			rubro: "MORA",
			amount: money(moraCents),
			facturable: true,
		});
		facturableCents += moraCents;
	}
	const otrosCents = cents(otros);
	if (otrosCents > 0n) {
		const first = installments[0]!;
		allocations.push({
			link_type: "MORA_INTERES",
			cartera_cuota_id: first.cuotaId,
			numero_cuota: first.numeroCuota,
			rubro: "OTROS",
			amount: money(otrosCents),
			facturable: true,
		});
		facturableCents += otrosCents;
	}
	if (capitalCents + facturableCents === 0n)
		throw new Error("No hay saldo pagable para Págalo.");
	return {
		allocations,
		capitalTotal: money(capitalCents),
		facturableTotal: money(facturableCents),
		totalAmount: money(capitalCents + facturableCents),
		otrosTotal: money(otrosCents),
	};
}
