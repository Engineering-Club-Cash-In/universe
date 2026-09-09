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
		return "Selecciona un asesor de origen.";
	if (!input.motivo.trim())
		return "Selecciona un motivo y completa la explicación.";
	if (input.modo === "traslado_completo") {
		if (!input.destino) return "Selecciona un asesor de destino.";
		if (input.destino === input.origen)
			return "Origen y destino deben ser distintos.";
	}
	if (input.requiereDestinoEspecial) {
		if (!input.destinoEspecial)
			return "Selecciona responsable para cuentas sin bucket operativo.";
		if (input.destinoEspecial === input.origen)
			return "El responsable de cuentas sin bucket debe ser distinto del origen.";
	}
	if (input.modo === "destino_por_bucket") {
		const faltante = (input.bucketsOrigen ?? []).find(
			(bucket) => !input.destinosPorBucket?.[bucket],
		);
		if (faltante !== undefined)
			return `Selecciona un asesor de destino para B${faltante}.`;
		// Fallback `{}`, no `[]`: el tipo es un objeto por bucket. Con `[]`
		// funcionaba de casualidad (Object.values de un array vacío también da
		// []) pero mentía sobre la forma del dato.
		if (
			Object.values(input.destinosPorBucket ?? {}).some(
				(destino) => destino === input.origen,
			)
		)
			return "El destino de cada bucket debe ser distinto del origen.";
	}
	return null;
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
