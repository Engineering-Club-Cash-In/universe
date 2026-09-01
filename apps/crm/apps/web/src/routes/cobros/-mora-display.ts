export type MoraBucket = {
	cantidad: number;
	sumaCapital: string;
	sumaMora: string;
};

const MORA_BUCKET_KEYS = [
	"mora_30",
	"mora_60",
	"mora_90",
	"mora_120_plus",
] as const;

type MoraBucketKey = (typeof MORA_BUCKET_KEYS)[number];
type CapitalAgingMetric = {
	cantidad: number;
	capital: number;
	porcentaje: number | null;
};

type CapitalAgingInput = {
	totales: Partial<Record<MoraBucketKey, MoraBucket>>;
	porAsesor: ({ asesorId: number; nombre: string } & Partial<
		Record<MoraBucketKey, MoraBucket>
	>)[];
	capitalCartera?: {
		total: string;
		porAsesor: { asesorId: number; nombre: string; capital: string }[];
	};
	dataDisponibleDesde?: string;
};

const capitalMetric = (
	bucket: MoraBucket | undefined,
	denominador: number,
): CapitalAgingMetric => {
	const capital = Number(bucket?.sumaCapital ?? 0);
	return {
		cantidad: bucket?.cantidad ?? 0,
		capital,
		porcentaje:
			denominador > 0 ? (capital / denominador) * 100 : capital > 0 ? null : 0,
	};
};

export function buildCapitalAging(data: CapitalAgingInput) {
	const sinCoberturaHistorica = data.dataDisponibleDesde !== undefined;
	const disponible =
		data.capitalCartera !== undefined && !sinCoberturaHistorica;
	const capitalCartera = data.capitalCartera ?? { total: "0", porAsesor: [] };
	const capitalTotal = Number(capitalCartera.total);
	const acumulados = MORA_BUCKET_KEYS.map((_, index) => {
		const buckets = MORA_BUCKET_KEYS.slice(index).map(
			(key) => data.totales[key],
		);
		const capital = buckets.reduce(
			(sum, bucket) => sum + Number(bucket?.sumaCapital ?? 0),
			0,
		);
		return {
			umbral: [30, 60, 90, 120][index] as 30 | 60 | 90 | 120,
			capital,
			cantidad: buckets.reduce(
				(sum, bucket) => sum + (bucket?.cantidad ?? 0),
				0,
			),
			porcentaje:
				capitalTotal > 0 ? (capital / capitalTotal) * 100 : capital > 0 ? null : 0,
		};
	});

	const moraPorAsesor = new Map(
		data.porAsesor.map((asesor) => [asesor.asesorId, asesor]),
	);
	const capitalPorAsesor = new Map(
		capitalCartera.porAsesor.map((asesor) => [asesor.asesorId, asesor]),
	);
	for (const asesor of data.porAsesor) {
		if (!capitalPorAsesor.has(asesor.asesorId)) {
			capitalPorAsesor.set(asesor.asesorId, {
				asesorId: asesor.asesorId,
				nombre: asesor.nombre,
				capital: "0",
			});
		}
	}

	const porAsesor = Array.from(capitalPorAsesor.values())
		.map((asesor) => {
			const capitalCartera = Number(asesor.capital);
			const mora = moraPorAsesor.get(asesor.asesorId);
			return {
				asesorId: asesor.asesorId,
				nombre: asesor.nombre,
				capitalCartera,
				mora_30: capitalMetric(mora?.mora_30, capitalCartera),
				mora_60: capitalMetric(mora?.mora_60, capitalCartera),
				mora_90: capitalMetric(mora?.mora_90, capitalCartera),
				mora_120_plus: capitalMetric(mora?.mora_120_plus, capitalCartera),
			};
		})
		.sort((a, b) => {
			const exposureA = MORA_BUCKET_KEYS.reduce(
				(sum, key) => sum + a[key].capital,
				0,
			);
			const exposureB = MORA_BUCKET_KEYS.reduce(
				(sum, key) => sum + b[key].capital,
				0,
			);
			return exposureB - exposureA || a.nombre.localeCompare(b.nombre, "es");
		});

	return {
		disponible,
		sinCoberturaHistorica,
		capitalTotal,
		acumulados,
		porAsesor,
	};
}

type MoraSnapshotAsesor = {
	asesorId: number;
	nombre: string;
	totalEnMora: { cantidad: number; sumaMora: string };
} & Partial<
	Record<
		"mora_30" | "mora_60" | "mora_90" | "mora_120" | "mora_120_plus",
		MoraBucket
	>
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

export function getMoraSnapshotDate(
	modo: "hoy" | "mes",
	mesAnio: string,
	hoy: string,
) {
	if (modo === "hoy") return undefined;
	const apertura = `${mesAnio}-05`;
	return apertura > hoy ? hoy : apertura;
}

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
