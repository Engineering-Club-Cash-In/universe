export function validarFormularioTraslado(input: {
	modo: string;
	origen: string;
	destino: string;
	destinoEspecial?: string;
	requiereDestinoEspecial?: boolean;
	destinosPorBucket?: Record<number, string>;
	bucketsOrigen?: readonly number[];
	motivo: string;
}): string | null {
	if (!/^\d+$/.test(input.origen) || Number(input.origen) <= 0)
		return "Seleccione el asesor que entrega la cartera.";
	if (!input.motivo.trim())
		return "Con el motivo «Otro», escriba la nota que explica el traslado.";
	if (input.modo === "traslado_completo") {
		if (!input.destino) return "Seleccione quién recibe la cartera.";
		if (input.destino === input.origen)
			return "Quien recibe la cartera debe ser otro asesor.";
	}
	if (input.requiereDestinoEspecial) {
		if (!input.destinoEspecial)
			return "Elija quién queda a cargo de los créditos fuera de cobranza.";
		if (input.destinoEspecial === input.origen)
			return "Quien queda a cargo de los créditos fuera de cobranza debe ser otro asesor.";
	}
	if (input.modo === "destino_por_bucket") {
		const faltante = (input.bucketsOrigen ?? []).find(
			(bucket) => !input.destinosPorBucket?.[bucket],
		);
		if (faltante !== undefined) return `Seleccione quién recibe B${faltante}.`;
		// Fallback `{}`, no `[]`: el tipo es un objeto por bucket. Con `[]`
		// funcionaba de casualidad (Object.values de un array vacío también da
		// []) pero mentía sobre la forma del dato.
		if (
			Object.values(input.destinosPorBucket ?? {}).some(
				(destino) => destino === input.origen,
			)
		)
			return "Quien recibe cada bucket debe ser otro asesor.";
	}
	return null;
}

/**
 * Separa la cartera del asesor de origen en lo que está en los buckets que él
 * atiende (su pool) y los créditos «sueltos»: los que el motor subió a un
 * bucket que no atiende y siguen a su nombre. Solo cuenta buckets con
 * créditos. Sin pool conocido (p. ej. un asesor inactivo) todo cuenta como
 * propio, que es como se trataba antes.
 */
export function partirCarteraPorPool(
	porBucket: readonly { bucket: number; cuentas: number }[],
	pool: readonly number[],
) {
	const conCreditos = porBucket.filter((d) => d.cuentas > 0);
	if (!pool.length) return { propios: conCreditos, sueltos: [] };
	return {
		propios: conCreditos.filter((d) => pool.includes(d.bucket)),
		sueltos: conCreditos.filter((d) => !pool.includes(d.bucket)),
	};
}

/**
 * Buckets que debe atender quien reciba TODA la cartera («A un solo asesor»):
 * los del pool del origen en los que tiene créditos (igual que el suplente de
 * «Marcar ausente»), no los de cada crédito suelto. Si solo tiene sueltos, los
 * de sus créditos.
 */
export function bucketsParaDestinoUnico(
	porBucket: readonly { bucket: number; cuentas: number }[],
	pool: readonly number[],
): number[] {
	const { propios, sueltos } = partirCarteraPorPool(porBucket, pool);
	return (propios.length ? propios : sueltos)
		.map((d) => d.bucket)
		.sort((a, b) => a - b);
}

export function puedeRecibirTodosBuckets(
	bucketsOrigen: readonly number[],
	bucketsDestino: readonly number[],
): boolean {
	return bucketsOrigen.every((bucket) => bucketsDestino.includes(bucket));
}

export function resumirTraslado(
	asignaciones: readonly {
		bucket: number | null;
		asesorNuevoId: number;
		prioridad: number;
	}[],
) {
	const filas = new Map<
		string,
		{
			bucket: number | null;
			asesorId: number;
			cuentas: number;
			compromisos: number;
		}
	>();
	for (const item of asignaciones) {
		const key = `${item.bucket ?? "sin_bucket"}:${item.asesorNuevoId}`;
		const fila = filas.get(key) ?? {
			bucket: item.bucket,
			asesorId: item.asesorNuevoId,
			cuentas: 0,
			compromisos: 0,
		};
		fila.cuentas++;
		if (item.prioridad === 0) fila.compromisos++;
		filas.set(key, fila);
	}
	return [...filas.values()].sort(
		(a, b) => (a.bucket ?? -1) - (b.bucket ?? -1) || a.asesorId - b.asesorId,
	);
}
