/**
 * Endpoints de CB-041 re-exportados aparte de `inmovilizacionUnidadRouter`:
 * ese objeto ya está en el límite donde TS7056 trunca el tipo inferido en
 * el web. Mismo patrón que recuperacion-vehiculo.ts y pagalo-supervision.ts
 * — las definiciones siguen viviendo en inmovilizacion-unidad.ts (tienen
 * acceso a sus helpers privados), esto solo las saca de ese objeto para el
 * tipo que ve el web.
 * Ver https://orpc.dev/docs/advanced/exceeds-the-maximum-length-problem
 */

import {
	getHistorialInmovilizaciones,
	registrarLlamadaApagado,
	registrarLlamadaReactivacion,
} from "./inmovilizacion-unidad";

export const inmovilizacionReactivacionLlamadaRouter = {
	registrarLlamadaApagado,
	registrarLlamadaReactivacion,
	getHistorialInmovilizaciones,
};
