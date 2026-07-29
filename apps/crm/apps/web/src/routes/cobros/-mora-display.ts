export type MoraBucket = {
	cantidad: number;
	sumaCapital: string;
	sumaMora: string;
};

type MoraSnapshotAsesor = {
	asesorId: number;
	nombre: string;
	totalEnMora: { cantidad: number; sumaMora: string };
} & Partial<
	Record<"mora_30" | "mora_60" | "mora_90" | "mora_120_plus", MoraBucket>
>;

type MoraRecoveryAsesor = {
	asesorId: number | null;
	nombre: string;
	esperado: string;
	cobradoEnSnapshot: string;
	cobradoFueraSnapshot: string;
	excedenteEnSnapshot: string;
	pendiente: string;
};

export type MoraDisplayAsesor = MoraRecoveryAsesor &
	Partial<Omit<MoraSnapshotAsesor, "asesorId" | "nombre">>;

export function buildMoraDisplayRows(
	porAsesor: MoraSnapshotAsesor[],
	recuperacion: MoraRecoveryAsesor[] | undefined,
	verCobrado = true,
): MoraDisplayAsesor[] {
	if (!verCobrado || !recuperacion) {
		return porAsesor.map((asesor) => ({
			...asesor,
			esperado: asesor.totalEnMora.sumaMora,
			cobradoEnSnapshot: "0",
			cobradoFueraSnapshot: "0",
			excedenteEnSnapshot: "0",
			pendiente: asesor.totalEnMora.sumaMora,
		}));
	}
	const snapshotPorAsesor = new Map<number, MoraSnapshotAsesor>(
		porAsesor.map((asesor) => [asesor.asesorId, asesor]),
	);
	return recuperacion.map((asesor) => ({
		...(asesor.asesorId === null
			? undefined
			: snapshotPorAsesor.get(asesor.asesorId)),
		...asesor,
	}));
}
