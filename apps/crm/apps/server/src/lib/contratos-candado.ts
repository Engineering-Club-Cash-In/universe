import { sql } from "drizzle-orm";
import { db } from "../db";

/**
 * Candado por oportunidad que comparten las acciones sobre sus contratos que
 * no pueden pisarse: confirmar la firma, regenerar los enlaces y mandarlos por
 * WhatsApp.
 *
 * Las tres tardan porque hablan con alguien de afuera (cartera-back, WeeTrust,
 * SimpleTech) y, sin un candado común, se cruzaban: una regeneración que
 * entraba mientras se confirmaba dejaba un contrato nuevo que la confirmación
 * marcaba firmado, y una que entraba mientras salía el WhatsApp borraba en
 * WeeTrust los documentos de los enlaces que se estaban mandando.
 *
 * Es de transacción y no de fila: quien lo toma sigue escribiendo la
 * oportunidad y sus contratos desde otras conexiones, y un `FOR UPDATE` lo
 * trabaría contra sí mismo.
 */
export function claveDeFirma(opportunityId: string) {
	return sql`hashtext(${`firma-oportunidad:${opportunityId}`}::text)`;
}

/**
 * Corre `tarea` con el candado tomado, y lo suelta cuando la tarea terminó.
 *
 * La transacción de afuera sólo lo sostiene: la tarea trabaja con sus propias
 * conexiones, así que puede tardar sin dejar filas bloqueadas de por medio.
 *
 * **La tarea tiene que tener su propio tope.** Neon corta las transacciones
 * inactivas a los 300s (`idle_in_transaction_session_timeout`), y ese corte
 * suelta el candado sin detener la tarea: seguiría trabajando mientras otro
 * empieza a tocar los mismos contratos. Quien pase una tarea que habla con
 * alguien de afuera tiene que garantizar que termina bastante antes de eso.
 */
export async function conCandadoDeFirma<T>(
	opportunityId: string | null,
	tarea: () => Promise<T>,
): Promise<T> {
	// Un contrato suelto, sin oportunidad, no comparte nada con nadie.
	if (!opportunityId) return tarea();

	return db.transaction(async (candado) => {
		await candado.execute(
			sql`select pg_advisory_xact_lock(${claveDeFirma(opportunityId)})`,
		);
		return tarea();
	});
}
