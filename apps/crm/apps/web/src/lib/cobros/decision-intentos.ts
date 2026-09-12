/**
 * CB-033 — persistencia de "intentos de decisión" sobre un convenio
 * (aprobar/rechazar), por usuario.
 *
 * Por qué existe: si un rechazo se CONFIRMA en cartera pero la respuesta se
 * pierde (timeout, cierre de pestaña, error de red), el convenio desaparece
 * del listado — ya no hay fila que abrir ni modal desde donde reintentar. El
 * `operacionId` solo, guardado suelto, no alcanza: hace falta también el
 * payload original (para reenviarlo idéntico) y un resumen legible, porque el
 * convenio real ya no está para leerlo de ahí. Ver
 * docs/features/cobros-02/06-ficha-360.md §3.5.
 *
 * `localStorage` (no sessionStorage): el intento debe sobrevivir a cerrar la
 * pestaña — es justo el caso de "cerré todo después del timeout y volví
 * después" que hay que cubrir.
 */

const PREFIJO = "cb033:intento";

export type ConvenioDecisionTipo = "aprobado" | "rechazado";

export interface ConvenioDecisionResumen {
	clienteNombre?: string;
	numeroCreditoSifco?: string;
	montoTotalConvenio?: string;
}

export interface ConvenioDecisionIntento {
	operacionId: string;
	convenioId: number;
	decision: ConvenioDecisionTipo;
	motivo: string | null;
	creadoEn: string;
	resumen: ConvenioDecisionResumen;
}

function claveIntento(userId: string, convenioId: number): string {
	return `${PREFIJO}:${userId}:${convenioId}`;
}

/** Guarda el intento ANTES de disparar la llamada — si la respuesta nunca llega, esto es lo único que queda. */
export function guardarIntentoPendiente(
	userId: string,
	intento: ConvenioDecisionIntento,
): void {
	try {
		localStorage.setItem(
			claveIntento(userId, intento.convenioId),
			JSON.stringify(intento),
		);
		notificarCambio();
	} catch {
		// localStorage puede fallar (modo privado, cuota llena) — no debe
		// bloquear la decisión real. Se pierde el mecanismo de reintento del
		// banner, no la decisión en sí.
	}
}

export function leerIntentoPendiente(
	userId: string,
	convenioId: number,
): ConvenioDecisionIntento | null {
	try {
		const raw = localStorage.getItem(claveIntento(userId, convenioId));
		return raw ? (JSON.parse(raw) as ConvenioDecisionIntento) : null;
	} catch {
		return null;
	}
}

/**
 * Se llama al recibir una respuesta CONFIRMADA (éxito, idempotente, o error
 * de negocio definitivo). Un timeout/error de red NO debe llamar a esto —
 * es justo el caso que tiene que sobrevivir.
 *
 * `operacionId` acota el borrado a la operación que este caller resolvió:
 * con dos pestañas abiertas sobre el mismo convenio, la que termina segunda
 * no debe borrar el intento que guardó la otra (que puede seguir sin
 * confirmarse). Sin el parámetro borra lo que haya, para los callers que no
 * tienen un id concreto en mano.
 */
export async function borrarIntentoPendiente(
	userId: string,
	convenioId: number,
	operacionId?: string,
): Promise<void> {
	const borrar = () => {
		try {
			if (operacionId) {
				const actual = leerIntentoPendiente(userId, convenioId);
				// Otra pestaña ya reservó una operación distinta: no es la
				// nuestra, no se toca.
				if (actual && actual.operacionId !== operacionId) return;
			}
			localStorage.removeItem(claveIntento(userId, convenioId));
			notificarCambio();
		} catch {
			// no-op
		}
	};

	// Mismo lock que la reserva: comprobar-y-borrar tiene que ser atómico
	// respecto a comprobar-y-reservar, o una respuesta tardía puede borrar
	// el intento que otra pestaña acaba de reservar.
	const locks = globalThis.navigator?.locks;
	if (!locks) return borrar();
	await locks.request(`cb033:intento:${userId}:${convenioId}`, borrar);
}

/**
 * Resultado de intentar reservar una operación para un convenio.
 *
 * `conflicto` significa que YA hay otra decisión esperando confirmación
 * (típicamente de otra pestaña). El caller NO debe enviarla por su cuenta:
 * puede ser un rechazo mientras el usuario apretó "Aprobar", y mandarlo
 * borraría el convenio sin que nadie lo pidiera. Se le muestra cuál es y se
 * le pide una acción explícita.
 */
export type ResultadoReserva =
	| { estado: "reservado"; intento: ConvenioDecisionIntento }
	| { estado: "conflicto"; intento: ConvenioDecisionIntento };

/**
 * Reserva el intento para una operación nueva, sin pisar uno que ya esté
 * esperando confirmación.
 *
 * La sección crítica corre bajo un **Web Lock** con nombre por
 * (usuario, convenio): sin él, dos pestañas leen vacío casi a la vez y la
 * segunda pisa el `operacion_id` de la primera — que puede estar confirmado
 * en cartera, y ese id es lo único con lo que se recupera el resultado. La
 * idempotencia del server no ayuda si el id se perdió del cliente.
 *
 * Si `navigator.locks` no existe (navegador viejo, contexto no seguro), se
 * degrada a la comprobación sin lock: sigue siendo correcta salvo en la
 * ventana de carrera exacta, que es lo que había antes.
 */
export async function reservarIntentoPendiente(
	userId: string,
	intento: ConvenioDecisionIntento,
): Promise<ResultadoReserva> {
	const reservar = (): ResultadoReserva => {
		const existente = leerIntentoPendiente(userId, intento.convenioId);
		if (existente) {
			return existente.operacionId === intento.operacionId
				? { estado: "reservado", intento: existente }
				: { estado: "conflicto", intento: existente };
		}
		guardarIntentoPendiente(userId, intento);
		return { estado: "reservado", intento };
	};

	const locks = globalThis.navigator?.locks;
	if (!locks) return reservar();
	return locks.request(
		`cb033:intento:${userId}:${intento.convenioId}`,
		reservar,
	);
}

/**
 * Estados 4xx que NO dicen nada sobre la petición anterior: el reenvío ni
 * siquiera llegó a evaluarse contra el convenio. Descartar el intento por
 * uno de estos borraría el `operacion_id` justo cuando el usuario necesita
 * volver a intentarlo (reloguearse, esperar el rate limit, pedir permisos).
 */
const ESTADOS_4XX_QUE_NO_PRUEBAN_NADA = new Set([
	401, // sesión vencida
	403, // permisos (pudo cambiar el rol entre un intento y otro)
	408, // request timeout
	425, // too early
	429, // rate limit
]);

/**
 * ¿El error prueba que la decisión NO se aplicó?
 *
 * Solo lo prueba un 4xx **de negocio**: el server evaluó la petición y la
 * rechazó (motivo inválido, convenio ya decidido, identificador reusado con
 * otro contenido). Ahí el intento ya no sirve y se descarta.
 *
 * Todo lo demás deja el resultado INCIERTO y el intento debe sobrevivir:
 *  - 5xx: el server falló, pero la transacción de cartera pudo haber
 *    commiteado antes de que se cortara la respuesta.
 *  - 401/403/408/425/429: el reenvío no llegó a evaluarse — no dicen nada
 *    de lo que pasó con la petición original.
 *  - Sin `status`: ni siquiera hubo respuesta HTTP (red caída, request
 *    abortada). Es el caso clásico de "se aplicó pero no me enteré".
 *
 * NO mirar `error.code`: un ORPCError SIEMPRE lo trae poblado —también en
 * INTERNAL_SERVER_ERROR—, así que `code !== undefined` da true para todo y
 * borraría el intento justo cuando más se necesita.
 */
export function errorPruebaQueNoSeAplico(error: unknown): boolean {
	const status = (error as { status?: unknown } | null)?.status;
	if (typeof status !== "number") return false;
	if (ESTADOS_4XX_QUE_NO_PRUEBAN_NADA.has(status)) return false;
	return status >= 400 && status < 500;
}

/**
 * `localStorage` no dispara eventos en la pestaña que escribe (solo en las
 * otras), así que un componente que muestre la lista de intentos no se
 * entera de los cambios que hace otro componente de la misma pestaña. Este
 * evento cubre ese hueco; el `storage` nativo del navegador cubre el resto
 * de pestañas. Ver `suscribirseAIntentos`.
 */
const EVENTO_CAMBIO = "cb033:intentos-cambiaron";

function notificarCambio(): void {
	try {
		window.dispatchEvent(new Event(EVENTO_CAMBIO));
	} catch {
		// entorno sin window (SSR/tests) — nada que notificar
	}
}

/**
 * Avisa cada vez que la lista de intentos cambia, venga el cambio de esta
 * pestaña (evento propio) o de otra (evento `storage` del navegador).
 * Devuelve la función para desuscribirse.
 */
export function suscribirseAIntentos(onCambio: () => void): () => void {
	const handlerStorage = (e: StorageEvent) => {
		// Solo interesan las claves de este módulo. `key === null` es un
		// `localStorage.clear()`, que también cuenta.
		if (e.key === null || e.key.startsWith(PREFIJO)) onCambio();
	};
	window.addEventListener(EVENTO_CAMBIO, onCambio);
	window.addEventListener("storage", handlerStorage);
	return () => {
		window.removeEventListener(EVENTO_CAMBIO, onCambio);
		window.removeEventListener("storage", handlerStorage);
	};
}

/**
 * Todos los intentos pendientes del usuario actual, para pintar el banner
 * "Decisión por confirmar" sin depender de que el convenio siga en ninguna
 * lista. Recorre localStorage completo (no hay índice) — el volumen esperado
 * es de unidades, no vale la pena mantener un índice aparte.
 */
export function listarIntentosPendientes(
	userId: string,
): ConvenioDecisionIntento[] {
	const prefijo = `${PREFIJO}:${userId}:`;
	const intentos: ConvenioDecisionIntento[] = [];
	try {
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (!key || !key.startsWith(prefijo)) continue;
			const raw = localStorage.getItem(key);
			if (!raw) continue;
			try {
				intentos.push(JSON.parse(raw) as ConvenioDecisionIntento);
			} catch {
				// fila corrupta — se ignora, no debe tumbar el banner completo
			}
		}
	} catch {
		return [];
	}
	return intentos;
}
