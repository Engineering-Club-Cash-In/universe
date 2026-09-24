import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { WialonLlamadaContexto } from "./wialon-types";

/**
 * Propaga de dónde vino una llamada a Wialon (qué procedure/job del CRM, para
 * qué usuario/vehículo/crédito) sin tener que agregar un parámetro de
 * contexto a cada método de WialonClient. El cliente lee este contexto al
 * emitir cada evento de intento (CB-121); si no hay contexto activo (por
 * ejemplo, una llamada hecha directo en un test), usa "desconocido".
 */
const storage = new AsyncLocalStorage<WialonLlamadaContexto>();

export function conContextoGps<T>(
	contexto: Omit<WialonLlamadaContexto, "correlationId"> & {
		correlationId?: string;
	},
	fn: () => Promise<T>,
): Promise<T> {
	const completo: WialonLlamadaContexto = {
		correlationId: contexto.correlationId ?? randomUUID(),
		...contexto,
	};
	return storage.run(completo, fn);
}

export function contextoGpsActual(): WialonLlamadaContexto {
	return (
		storage.getStore() ?? {
			origen: "desconocido",
			correlationId: randomUUID(),
		}
	);
}

/**
 * getGpsVehiculo solo sabe el id de la fila de gps_consulta_logs DESPUÉS de
 * auditar (adentro de conContextoGps), así que no puede pasarlo al armar el
 * contexto inicial. Muta el objeto de contexto vigente in-place —
 * AsyncLocalStorage guarda una referencia, no una copia— para que las
 * llamadas a Wialon que sigan dentro del mismo `conContextoGps` (telemetría,
 * después de resolver la unidad) queden enlazadas a esa fila de auditoría.
 */
export function enlazarConsultaLogEnContexto(gpsConsultaLogId: string): void {
	const actual = storage.getStore();
	if (actual) {
		actual.gpsConsultaLogId = gpsConsultaLogId;
	}
}
