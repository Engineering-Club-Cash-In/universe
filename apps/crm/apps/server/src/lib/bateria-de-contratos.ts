import { and, eq, ne } from "drizzle-orm";
import { db } from "../db";
import { investorContractBatches } from "../db/schema/investor-contracts";
import { generatedLegalContracts } from "../db/schema/legal-contracts";

/**
 * En qué estado está la batería de contratos de un inversionista.
 *
 * La batería no tiene etapas como una oportunidad de ventas: lo que la mueve es
 * el estado de sus documentos.
 *
 * - `pendiente`: no hay ningún contrato vigente. Así nace con la compra, y es
 *   también adonde vuelve si se anulan todos.
 * - `en_proceso`: hay contratos y falta alguna firma. Jurídico la sigue viendo,
 *   porque mientras falte firmar todavía se puede corregir: reemplazar, anular
 *   o subir otro.
 * - `completada`: la cerró jurídico con "Listo", o la firmaron todos. Sale de
 *   la lista: jurídico ya dijo que terminó, y un documento firmado por todos no
 *   admite cambios (en WeeTrust tampoco se puede borrar).
 *
 * `descartada` no se recalcula nunca: alguien dijo que esa compra no llevaba
 * papelería, y eso no lo decide el estado de ningún documento.
 *
 * **Una completada no se reabre sola.** Que llegue una firma de las que
 * faltaban no la devuelve a la lista de jurídico: cerrarla fue una decisión
 * suya. Vuelve a abrirse cuando hay trabajo de verdad — se le emite otro
 * contrato (`reabrir`) o se anulan todos y queda sin ninguno.
 *
 * Se llama en los cuatro momentos que pueden moverla: al emitir, al subir uno a
 * mano, al anular, y cada vez que alguien firma.
 */
export async function recalcularEstadoDeLaBateria(
	batchId: string,
	/** Quién provocó el cambio, para dejarlo anotado si la batería se cierra. */
	userId?: string,
	opciones: {
		/**
		 * Devuelve a la lista una batería que jurídico ya había cerrado. Lo pasa
		 * quien le acaba de emitir o subir un contrato: eso es trabajo nuevo.
		 */
		reabrir?: boolean;
	} = {},
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

	const todosFirmados =
		vigentes.length > 0 && vigentes.every((c) => c.status === "signed");

	const estado =
		vigentes.length === 0
			? "pendiente"
			: todosFirmados
				? "completada"
				: // Falta firmar: es trabajo abierto, salvo que jurídico ya la haya
					// cerrado y nadie le haya agregado nada desde entonces.
					bateria.status === "completada" && !opciones.reabrir
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
			// Y cuándo quedó cerrada. Si se reabre (se anuló uno, o se le emitió
			// otro contrato) se limpia: volvió a haber trabajo.
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
