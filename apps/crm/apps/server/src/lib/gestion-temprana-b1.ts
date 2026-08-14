/**
 * CB-026 — Gestión temprana B1 (función pura, sin DB ni red).
 *
 * Regla: una cuenta en B1 debe agotar 3 intentos en 3 canales DISTINTOS
 * (WhatsApp, llamada, SMS) antes de darse por gestionada. Si el cliente
 * contesta por cualquiera de los 3 — o se registra un compromiso de pago —
 * no hace falta intentar los restantes (early exit del criterio de aceptación).
 *
 * Decisiones de dominio, todas deliberadas:
 *
 *  1. LOS 3 CANALES son exactamente los del ticket. email / visita_domicilio /
 *     carta_notarial NO cuentan ni sustituyen a ninguno — dejar que un email
 *     tape el hueco del SMS vaciaría de sentido "3 canales distintos". Igual se
 *     cuentan aparte (`otrosCanales`) para que la UI pueda explicar por qué el
 *     resumen dice 2/3 mientras el Historial de abajo muestra más filas.
 *
 *  2. SOLO INTENTOS MANUALES. Los contactos que genera el sistema (premora
 *     automática, WhatsApp masivo) se excluyen — `contactos_cobros` no tiene
 *     columna de origen, así que se detectan por prefijo en `comentarios`,
 *     mismo criterio que ya usa el cierre diario (CB-024, es_efectivo_manual).
 *     Si contaran, un B1 mostraría "WhatsApp ✓" sin que el asesor lo tocara:
 *     exactamente el gaming que la alerta busca evitar.
 *
 *  3. "CONTESTÓ" = contactado | acuerdo_parcial | rechaza_pagar | promesa_pago.
 *     Los primeros tres son el set de es_efectivo_manual de CB-024 — se reusa
 *     en vez de inventar una segunda definición de "efectivo". `rechaza_pagar`
 *     cuenta: el cliente atendió, y llamarlo por los otros dos canales no lo va
 *     a des-negar; lo que sigue es escalar, no seguir marcando. `promesa_pago`
 *     se suma porque el ticket lo nombra explícito ("desencadenar un compromiso
 *     de pago"); CB-024 lo excluía solo porque allá las categorías son
 *     mutuamente excluyentes, restricción que acá no existe.
 *     `numero_equivocado` NO es respuesta, pero marca el canal como inutilizable
 *     (`datoInvalido`) — es distinto de "sin intentar" y la UI debe poder
 *     diferenciarlo.
 *
 *  4. VENTANA: solo cuentan los contactos desde que el crédito ENTRÓ al bucket
 *     (`fechaEntradaBucket`, inclusivo). Sin esto, un crédito que ya ciclò
 *     B1→B2→B1 arrastraría la gestión del trimestre pasado y suprimiría la
 *     alerta justo cuando más importa.
 *
 *  5. SIN FECHA DE ENTRADA → `aplica: false`. Mismo criterio "degradar sin
 *     inventar dato" de cola-dia.ts, que EXCLUYE los créditos sin fila en
 *     buckets_historial en vez de asumirles una fecha. Un falso "gestión
 *     agotada" es peor que no mostrar nada.
 *
 * Módulo PURO a propósito: lo importa tanto el server como el web
 * (`server/src/lib/...` vía el path alias del tsconfig del web, mismo patrón
 * que lead-sources.ts) — una sola definición de la regla, no dos que puedan
 * divergir.
 */

/** Los 3 canales que la gestión temprana B1 exige agotar. El orden es el de render. */
export const CANALES_GESTION_B1 = ["whatsapp", "llamada", "sms"] as const;

export type CanalGestionB1 = (typeof CANALES_GESTION_B1)[number];

/** Único bucket al que aplica la regla (B1 = "Alerta Temprana"). */
export const BUCKET_GESTION_TEMPRANA = 1;

/**
 * Prefijos con los que el sistema marca los contactos que genera solo
 * (`contactos_cobros` no tiene columna de origen). Los escriben
 * send-premora-reminders.ts y cobros.ts::enviarWhatsappMasivoCobros.
 *
 * Viven acá —y no en jobs/cierre-diario-asesores.ts, donde nacieron— porque
 * este módulo es puro y el web lo puede importar; el job arrastra `db` y
 * `carteraBackClient`, que no pueden entrar al bundle del browser. El job los
 * re-exporta para que sus consumidores actuales no cambien de import.
 */
export const PREFIJO_PREMORA_AUTO = "Recordatorio automático";
export const PREFIJO_WSP_MASIVO = "Envío masivo de WhatsApp";
/**
 * Prefijo de los recordatorios de convenio (send-convenio-reminders.ts), MÁS
 * ESPECÍFICO que PREFIJO_PREMORA_AUTO ("Recordatorio automático Convenio..."
 * empieza con "Recordatorio automático"). Quien clasifique origen debe probar
 * este prefijo ANTES que PREFIJO_PREMORA_AUTO o todo convenio se reporta como
 * premora.
 */
export const PREFIJO_CONVENIO_AUTO = "Recordatorio automático Convenio";

/** `estadoContacto` que significan "el cliente CONTESTÓ" (ver decisión 3 arriba). */
export const ESTADOS_CONTESTO = [
	"contactado",
	"acuerdo_parcial",
	"rechaza_pagar",
	"promesa_pago",
] as const;

/** Fila mínima de `contactos_cobros` que la regla necesita. */
export interface ContactoParaGestionB1 {
	metodoContacto: string;
	estadoContacto: string;
	fechaContacto: Date | string | null;
	comentarios: string | null;
}

export interface EstadoCanalB1 {
	canal: CanalGestionB1;
	/** Intentos manuales registrados por este canal dentro de la ventana. */
	intentos: number;
	/** true si algún intento por este canal tuvo estado de "contestó". */
	contesto: boolean;
	/** true si algún intento marcó numero_equivocado (canal inutilizable, ≠ sin intentar). */
	datoInvalido: boolean;
	/** Fecha del último intento por este canal dentro de la ventana. */
	ultimoIntento: Date | null;
}

/**
 * - "respondio"  → contestó en algún canal (o hay promesa): NO hace falta
 *                  intentar los restantes. Es el early exit del ticket.
 * - "agotada"    → los 3 canales tienen al menos un intento, sin respuesta.
 * - "incompleta" → faltan canales por intentar. Es el caso que ALERTA.
 *
 * Precedencia en ese orden: si el cliente respondió Y además se intentó por los
 * 3, el estado es "respondio" (más informativo que "agotada").
 */
export type EstadoGestionB1 = "respondio" | "agotada" | "incompleta";

export type ResultadoGestionB1 =
	| { aplica: false; motivo: "no_es_b1" | "sin_fecha_entrada" }
	| {
			aplica: true;
			canales: EstadoCanalB1[];
			/** Canales de los 3 sin ningún intento manual en la ventana. */
			canalesFaltantes: CanalGestionB1[];
			/** Canal donde el cliente contestó primero (cronológicamente), o null. */
			canalQueContesto: CanalGestionB1 | null;
			/** true si hay una promesa de pago registrada en la ventana. */
			tienePromesa: boolean;
			/** Intentos manuales en la ventana por canales FUERA de los 3 (email, visita...). */
			otrosCanales: number;
			estado: EstadoGestionB1;
	  };

/** true si el contacto lo generó el sistema (premora automática / WhatsApp masivo). */
export function esContactoAutomatico(comentarios: string | null): boolean {
	if (!comentarios) return false;
	return (
		comentarios.startsWith(PREFIJO_PREMORA_AUTO) ||
		comentarios.startsWith(PREFIJO_WSP_MASIVO)
	);
}

const ETIQUETAS_METODO: Record<string, string> = {
	llamada: "Llamada",
	whatsapp: "WhatsApp",
	sms: "SMS",
	email: "Email",
	visita_domicilio: "Visita a domicilio",
	carta_notarial: "Carta notarial",
};

/**
 * Etiqueta en español de un `metodoContacto`. Existe porque capitalizar el
 * valor crudo produce "Visita_domicilio" y "Sms". Un valor desconocido (enum
 * ampliado en el futuro) cae al capitalizado en vez de renderizar vacío.
 */
export function etiquetaMetodoContacto(metodo: string): string {
	const conocida = ETIQUETAS_METODO[metodo];
	if (conocida) return conocida;
	if (!metodo) return "—";
	return metodo.charAt(0).toUpperCase() + metodo.slice(1);
}

function aFecha(valor: Date | string | null): Date | null {
	if (!valor) return null;
	const fecha = valor instanceof Date ? valor : new Date(valor);
	return Number.isNaN(fecha.getTime()) ? null : fecha;
}

const esCanalGestion = (metodo: string): metodo is CanalGestionB1 =>
	(CANALES_GESTION_B1 as readonly string[]).includes(metodo);

const contesto = (estadoContacto: string): boolean =>
	(ESTADOS_CONTESTO as readonly string[]).includes(estadoContacto);

/**
 * Evalúa la gestión temprana de un crédito. Ver el encabezado del módulo para
 * las decisiones de dominio. Nunca lanza: entradas inválidas (fecha corrupta,
 * comentarios null) degradan, no revientan.
 */
export function evaluarGestionTempranaB1(params: {
	bucket: number | null;
	fechaEntradaBucket: Date | string | null;
	contactos: readonly ContactoParaGestionB1[];
}): ResultadoGestionB1 {
	if (params.bucket !== BUCKET_GESTION_TEMPRANA) {
		return { aplica: false, motivo: "no_es_b1" };
	}

	const entrada = aFecha(params.fechaEntradaBucket);
	if (!entrada) return { aplica: false, motivo: "sin_fecha_entrada" };

	const porCanal = new Map<CanalGestionB1, EstadoCanalB1>(
		CANALES_GESTION_B1.map((canal) => [
			canal,
			{
				canal,
				intentos: 0,
				contesto: false,
				datoInvalido: false,
				ultimoIntento: null,
			},
		]),
	);

	let otrosCanales = 0;
	let tienePromesa = false;
	// Se resuelve al final: el canal que contestó PRIMERO cronológicamente, no
	// el primero en el orden de render ni el primero del array de entrada (que
	// llega en orden descendente desde getHistorialContactos).
	let respuestaMasTemprana: { canal: CanalGestionB1; fecha: Date } | null =
		null;

	for (const contacto of params.contactos) {
		if (esContactoAutomatico(contacto.comentarios)) continue;

		const fecha = aFecha(contacto.fechaContacto);
		// Sin fecha no se puede ubicar en la ventana: se descarta en vez de
		// asumir que cae dentro (mismo criterio que la fecha de entrada). A
		// diferencia de "fuera de ventana" (esperado, no se avisa), esto es un
		// dato corrupto — un intento real puede desaparecer sin que nadie note
		// por qué el canal sigue en rojo. Warning, no error: la regla igual
		// degrada con seguridad y no debe tumbar la carga de la página.
		if (contacto.fechaContacto && !fecha) {
			console.warn(
				`[gestion-temprana-b1] fechaContacto no parseable, se descarta el intento: ${JSON.stringify(contacto.fechaContacto)}`,
			);
			continue;
		}
		if (!fecha || fecha < entrada) continue;

		if (contacto.estadoContacto === "promesa_pago") tienePromesa = true;

		if (!esCanalGestion(contacto.metodoContacto)) {
			otrosCanales++;
			continue;
		}

		const estado = porCanal.get(contacto.metodoContacto);
		if (!estado) continue;

		estado.intentos++;
		if (!estado.ultimoIntento || fecha > estado.ultimoIntento) {
			estado.ultimoIntento = fecha;
		}
		if (contacto.estadoContacto === "numero_equivocado") {
			estado.datoInvalido = true;
		}
		if (contesto(contacto.estadoContacto)) {
			estado.contesto = true;
			if (!respuestaMasTemprana || fecha < respuestaMasTemprana.fecha) {
				respuestaMasTemprana = { canal: contacto.metodoContacto, fecha };
			}
		}
	}

	const canales = CANALES_GESTION_B1.map(
		(canal) => porCanal.get(canal) as EstadoCanalB1,
	);
	const canalesFaltantes = canales
		.filter((c) => c.intentos === 0)
		.map((c) => c.canal);
	const canalQueContesto = respuestaMasTemprana?.canal ?? null;

	// Precedencia: respondió > agotada > incompleta.
	// `tienePromesa` también satisface el early exit: una promesa registrada
	// por un canal fuera de los 3 (p.ej. visita) sigue siendo un compromiso
	// conseguido, y el ticket lo nombra como condición de salida.
	let estado: EstadoGestionB1;
	if (canalQueContesto !== null || tienePromesa) estado = "respondio";
	else if (canalesFaltantes.length === 0) estado = "agotada";
	else estado = "incompleta";

	return {
		aplica: true,
		canales,
		canalesFaltantes,
		canalQueContesto,
		tienePromesa,
		otrosCanales,
		estado,
	};
}
