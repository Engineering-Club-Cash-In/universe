import { and, eq, ne } from "drizzle-orm";
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
	const [bateria] = await db
		.select()
		.from(investorContractBatches)
		.where(eq(investorContractBatches.id, batchId))
		.limit(1);

	if (!bateria || bateria.status === "descartada") return null;

	const vigentes = await db
		.select({ status: generatedLegalContracts.status })
		.from(generatedLegalContracts)
		.where(
			and(
				eq(generatedLegalContracts.batchId, batchId),
				ne(generatedLegalContracts.status, "cancelled"),
			),
		);

	// Mientras jurídico arma, nada la mueve: el Listo es lo único que la saca
	// de acá, porque es el que manda los contratos.
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

	await db
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
