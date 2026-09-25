import { and, eq, gte, ne } from "drizzle-orm";
import { db } from "../db";
import { investorContractBatches } from "../db/schema/investor-contracts";
import { generatedLegalContracts } from "../db/schema/legal-contracts";

/**
 * En qué estado está la batería de contratos de un inversionista.
 *
 * La batería no tiene etapas como una oportunidad de ventas: lo que la mueve es
 * el estado de sus documentos, y nada más.
 *
 * - `pendiente` ("Pendiente"): jurídico la está armando. Emite, mira los PDF,
 *   reemplaza o sube alguno; tenga o no contratos, sigue acá hasta el "Listo".
 * - `en_proceso` ("Por firmar"): jurídico le dio "Listo" —que manda los
 *   contratos al hilo de la compra— y falta alguna firma. Puede seguir
 *   agregando o reemplazando; eso sale solo al mismo hilo.
 * - `completada` ("Cerrada"): después del Listo, todos sus contratos vigentes
 *   están firmados. Ya no admite cambios: la papelería está completa, y en
 *   WeeTrust un documento firmado tampoco se puede borrar.
 *
 * Sólo el Listo la saca de pendiente: es el que manda el correo. Y no se cierra
 * a mano: cerrada es cuando se firma todo. Si después del Listo se anulan todos
 * sus contratos, vuelve a pendiente, porque hay que armarla y mandarla de nuevo.
 *
 * `descartada` no se recalcula nunca: alguien dijo que esa compra no llevaba
 * papelería, y eso no lo decide el estado de ningún documento.
 *
 * Se llama en los cuatro momentos que pueden moverla: al emitir, al subir uno a
 * mano, al anular, y cada vez que alguien firma.
 */
export async function recalcularEstadoDeLaBateria(
	batchId: string,
	/** Quién provocó el cambio, para dejarlo anotado si la batería se cierra. */
	userId?: string,
): Promise<"pendiente" | "en_proceso" | "completada" | null> {
	// Leer y escribir juntos, con la fila de la batería bloqueada: dos
	// recálculos a la vez —una firma que completa lo que había y un contrato
	// que se agrega después del Listo— leían juegos de contratos distintos, y
	// el que escribía último podía ser el de la foto vieja: "completada" con
	// un contrato pendiente adentro, fuera de la lista de jurídico y sin poder
	// corregirse. En fila, el segundo lee después de que el primero escribió.
	//
	// Es un candado de fila y no el de la batería (`conCandadoDeBateria`): esto
	// se llama también desde tareas que ya tienen ese tomado, y esperarían
	// contra sí mismas.
	return db.transaction(async (tx) => {
		const [bateria] = await tx
			.select()
			.from(investorContractBatches)
			.where(eq(investorContractBatches.id, batchId))
			.for("update")
			.limit(1);

		if (!bateria || bateria.status === "descartada") return null;

		// Sólo los de la compra actual, como el Listo y el descarte. Otra compra
		// sobre los mismos créditos reusa la batería con los contratos de la
		// anterior adentro: contándolos, sus firmas viejas cerraban una batería
		// cuya compra nueva no tenía nada vigente, y un pendiente viejo la
		// dejaba trabada aunque lo nuevo estuviera firmado.
		const vigentes = await tx
			.select({ status: generatedLegalContracts.status })
			.from(generatedLegalContracts)
			.where(
				and(
					eq(generatedLegalContracts.batchId, batchId),
					ne(generatedLegalContracts.status, "cancelled"),
					gte(generatedLegalContracts.generatedAt, bateria.acceptedAt),
				),
			);

		// Mientras jurídico arma, nada la mueve: el Listo es lo único que la
		// saca de acá, porque es el que manda los contratos.
		if (bateria.status === "pendiente") return "pendiente";

		const todosFirmados =
			vigentes.length > 0 && vigentes.every((c) => c.status === "signed");

		const estado =
			vigentes.length === 0
				? "pendiente"
				: todosFirmados
					? "completada"
					: "en_proceso";

		if (estado === bateria.status) return estado;

		const ahora = new Date();

		await tx
			.update(investorContractBatches)
			.set({
				status: estado,
				updatedAt: ahora,
				// Cuándo la empezó a trabajar jurídico: se anota la primera vez que
				// salió de "pendiente" y no se vuelve a tocar.
				...(estado !== "pendiente" && !bateria.startedAt
					? { startedAt: ahora, startedBy: userId ?? bateria.startedBy }
					: {}),
				// Y cuándo quedó cerrada. Si vuelve a faltar una firma se limpia: una
				// cerrada a mano con el "Listo" de antes vuelve a la lista así.
				...(estado === "completada"
					? { completedAt: ahora, completedBy: userId ?? bateria.completedBy }
					: { completedAt: null, completedBy: null }),
			})
			.where(eq(investorContractBatches.id, batchId));

		return estado;
	});
}

/**
 * Lo mismo, a partir de un contrato.
 *
 * Sale de la puerta por la que se escribe el estado de firma, que es la misma
 * para ventas y para inversiones: un contrato de ventas no tiene batería y acá
 * no hace nada.
 */
export async function recalcularLaBateriaDelContrato(
	contractId: string,
	userId?: string,
): Promise<void> {
	const [contrato] = await db
		.select({ batchId: generatedLegalContracts.batchId })
		.from(generatedLegalContracts)
		.where(eq(generatedLegalContracts.id, contractId))
		.limit(1);

	if (!contrato?.batchId) return;

	try {
		await recalcularEstadoDeLaBateria(contrato.batchId, userId);
	} catch (error) {
		// Best-effort: el estado de firma ya quedó guardado, que es lo que
		// importa. La batería se recalcula sola en la próxima firma o consulta.
		console.error(
			`[bateria-de-contratos] no se pudo recalcular la batería de ${contractId}:`,
			error,
		);
	}
}
