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
 * Corre `tarea` con el candado tomado, y lo suelta al terminar.
 *
 * La transacción de afuera sólo lo sostiene: la tarea trabaja con sus propias
 * conexiones, así que puede tardar sin dejar filas bloqueadas de por medio.
 */
export async function conCandadoDeFirma<T>(
	opportunityId: string,
	tarea: () => Promise<T>,
	opciones?: {
		/**
		 * Segundos que puede estar tomado el candado mientras la tarea trabaja
		 * afuera. Si se pasa, Postgres corta la transacción y lo suelta: un
		 * proveedor que no responde no deja la oportunidad trabada para siempre.
		 * Sin esto, el candado dura lo que dure la tarea.
		 */
		segundosMaximos?: number;
	},
): Promise<T> {
	return db.transaction(async (candado) => {
		if (opciones?.segundosMaximos) {
			// `set local` muere con la transacción, y no acepta parámetros: el valor
			// va en el texto, por eso es un entero de milisegundos y no lo que
			// llegue.
			const ms = Math.round(opciones.segundosMaximos) * 1000;
			await candado.execute(
				sql.raw(`set local idle_in_transaction_session_timeout = ${ms}`),
			);
		}
		await candado.execute(
			sql`select pg_advisory_xact_lock(${claveDeFirma(opportunityId)})`,
		);
		return tarea();
	});
}
