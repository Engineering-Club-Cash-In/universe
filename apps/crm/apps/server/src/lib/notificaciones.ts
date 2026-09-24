import { db } from "../db";
import type { NewNotification } from "../db/schema/notifications";
import { notifications } from "../db/schema/notifications";

/**
 * Crea una notificación. No es un endpoint: lo llaman los flujos que tienen que
 * avisarle a alguien de algo.
 *
 * Vive acá y no en `routers/notifications.ts` porque ese módulo arrastra el
 * router entero —oRPC, oportunidades, almacenamiento en R2— y hay avisos que
 * salen desde sitios que no necesitan nada de eso, como las rutas REST que
 * escuchan a cartera. El router lo re-exporta, así que quien ya lo importaba de
 * ahí sigue igual.
 */
export async function createNotification(
	data: Omit<NewNotification, "id" | "createdAt" | "updatedAt" | "status">,
	/**
	 * Con qué conexión se escribe. Por defecto la de siempre; quien necesite que
	 * el aviso entre en su misma transacción —para que un candado lo serialice—
	 * le pasa la suya.
	 */
	ejecutor: Pick<typeof db, "insert"> = db,
) {
	const [notification] = await ejecutor
		.insert(notifications)
		.values({
			...data,
			status: "pending",
		})
		.returning();

	return notification;
}
