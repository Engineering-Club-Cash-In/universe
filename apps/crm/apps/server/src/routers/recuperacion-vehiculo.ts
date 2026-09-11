/**
 * Traslado manual de un crédito a recuperación de vehículo.
 *
 * El procedure vive en cobros.ts; acá solo se re-exporta como router aparte
 * para sacarlo de `cobrosAppRouter`, que ya está en el límite donde TS7056
 * trunca el tipo inferido en el web. Estando dentro, el tipo se cortaba antes
 * de llegar a él y `$id.tsx` no lo veía ("Property 'enviarCreditoARecuperacion'
 * does not exist"). Mismo patrón que pagalo-supervision.ts y pagalo-grupo-activo.ts.
 * Ver https://orpc.dev/docs/advanced/exceeds-the-maximum-length-problem
 */

import { cobrosRouter } from "./cobros";

export const recuperacionVehiculoRouter = {
	enviarCreditoARecuperacion: cobrosRouter.enviarCreditoARecuperacion,
};
