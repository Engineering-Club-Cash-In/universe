export type ModoTrasladoCartera = "traslado_completo" | "redistribucion" | "destino_por_bucket" | "nivelacion";

export type CreditoParaTraslado = {
	creditoId: number;
	bucket: number | null;
	asesorId: number | null;
	tieneCompromisoVigente: boolean;
	esEspecial?: boolean;
};

export type AsignacionTraslado = {
	creditoId: number;
	asesorAnteriorId: number | null;
	asesorNuevoId: number;
	bucket: number | null;
	prioridad: 0 | 1;
};

export type BloqueoTraslado = {
	bucket: number;
	creditoId: number;
	razon: "sin_receptor_elegible" | "destino_no_configurado" | "destino_no_elegible";
};

export type ExcluidoTraslado = {
	creditoId: number;
	razon: "fuera_del_funnel";
};

export type PrevisualizacionTraslado = {
	asignaciones: AsignacionTraslado[];
	bloqueos: BloqueoTraslado[];
	excluidos: ExcluidoTraslado[];
};

export function previsualizarTrasladoCartera(input: {
	asesorOrigenId: number;
	asesorDestinoId?: number;
	asesorDestinoEspecialId?: number;
	destinosPorBucket?: ReadonlyMap<number, number>;
	modo: ModoTrasladoCartera;
	creditos: readonly CreditoParaTraslado[];
	poolPorBucket: ReadonlyMap<number, readonly number[]>;
	cargaPorBucket: ReadonlyMap<number, ReadonlyMap<number, number>>;
}): PrevisualizacionTraslado {
	const asignaciones: AsignacionTraslado[] = [];
	const bloqueos: BloqueoTraslado[] = [];
	const excluidos: ExcluidoTraslado[] = [];
	const carga = new Map<number, Map<number, number>>();

	for (const [bucket, porAsesor] of input.cargaPorBucket) {
		carga.set(bucket, new Map(porAsesor));
	}

	const creditos = [...input.creditos]
		.filter((credito) => credito.asesorId === input.asesorOrigenId)
		.sort((a, b) => {
			if (a.tieneCompromisoVigente !== b.tieneCompromisoVigente) {
				return a.tieneCompromisoVigente ? -1 : 1;
			}
			return a.creditoId - b.creditoId;
		});

	for (const credito of creditos) {
		if (credito.esEspecial) {
			if (
				input.asesorDestinoEspecialId === undefined ||
				input.asesorDestinoEspecialId === input.asesorOrigenId
			) {
				excluidos.push({ creditoId: credito.creditoId, razon: "fuera_del_funnel" });
				continue;
			}
			asignaciones.push({
				creditoId: credito.creditoId,
				asesorAnteriorId: credito.asesorId,
				asesorNuevoId: input.asesorDestinoEspecialId,
				bucket: null,
				prioridad: credito.tieneCompromisoVigente ? 0 : 1,
			});
			continue;
		}
		if (credito.bucket === null) {
			excluidos.push({ creditoId: credito.creditoId, razon: "fuera_del_funnel" });
			continue;
		}

		const pool = (input.poolPorBucket.get(credito.bucket) ?? [])
			.filter((asesorId) => asesorId !== input.asesorOrigenId)
			.slice()
			.sort((a, b) => a - b);

		let asesorNuevoId: number | undefined;
		const destino = input.modo === "destino_por_bucket"
			? input.destinosPorBucket?.get(credito.bucket)
			: input.asesorDestinoId;
		if (input.modo === "destino_por_bucket" && destino === undefined) {
			bloqueos.push({
				bucket: credito.bucket,
				creditoId: credito.creditoId,
				razon: "destino_no_configurado",
			});
			continue;
		}
		if (destino !== undefined) {
			if (!pool.includes(destino)) {
				bloqueos.push({
					bucket: credito.bucket,
					creditoId: credito.creditoId,
					razon: "destino_no_elegible",
				});
				continue;
			}
			asesorNuevoId = destino;
		} else {
			asesorNuevoId = elegirMenorCarga(pool, carga.get(credito.bucket));
			if (asesorNuevoId === undefined) {
				bloqueos.push({
					bucket: credito.bucket,
					creditoId: credito.creditoId,
					razon: "sin_receptor_elegible",
				});
				continue;
			}
		}

		asignaciones.push({
			creditoId: credito.creditoId,
			asesorAnteriorId: credito.asesorId,
			asesorNuevoId,
			bucket: credito.bucket,
			prioridad: credito.tieneCompromisoVigente ? 0 : 1,
		});

		const porAsesor = carga.get(credito.bucket) ?? new Map<number, number>();
		porAsesor.set(asesorNuevoId, (porAsesor.get(asesorNuevoId) ?? 0) + 1);
		carga.set(credito.bucket, porAsesor);
	}

	return { asignaciones, bloqueos, excluidos };
}

function elegirMenorCarga(
	pool: readonly number[],
	carga: ReadonlyMap<number, number> | undefined,
): number | undefined {
	let elegido: number | undefined;
	let menorCarga = Number.POSITIVE_INFINITY;
	for (const asesorId of pool) {
		const cargaActual = carga?.get(asesorId) ?? 0;
		if (cargaActual < menorCarga) {
			elegido = asesorId;
			menorCarga = cargaActual;
		}
	}
	return elegido;
}
