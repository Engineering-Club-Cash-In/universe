import type { ConsultaMoraResponse } from "../types/cartera-back";
import { normalizarDpi } from "../utils/cui-validation";
import type { AuditEntry } from "./audit";
import { resolverValidacionMora } from "./validacion-mora";

/**
 * El gate de mora aplicado a los SEIS puntos donde el CRM da de alta o edita a
 * una persona por DPI: cuatro en `routers/crm.ts` (createLead, updateLead, el
 * co-deudor y la edición del co-deudor) y dos en `controllers/portal-lead.ts`.
 *
 * 🔴 `controllers/public-lead.ts` y `controllers/bot.ts` NO llevan gate, y esa
 * ausencia es deliberada: son rutas anónimas, y consultar la mora ahí las
 * convertiría en un oráculo público de situación crediticia. Está razonado en
 * cada archivo, y `gate-mora-dpi.wiring.test.ts` falla si alguien se lo agrega
 * sin pasar por esa discusión. No es que "todavía" no lo tengan.
 *
 * La regla —y el fail-closed— ya viven en `validacion-mora.ts`; acá no se
 * reimplementa nada: esto traduce aquel veredicto informativo ("el cliente
 * tiene mora activa en 2 créditos") a una decisión de paso ("no se puede
 * continuar") con el texto que ve el asesor.
 *
 * **No lanza.** Los seis puntos tienen convenciones de error distintas —los
 * procedures ORPC lanzan `ORPCError`, el portal devuelve
 * `c.json({ success: false, error }, 400)`—, así que cada sitio traduce el
 * veredicto a su forma. Devolver un valor es lo único que sirve para ambas.
 *
 * Las dependencias entran por parámetro, igual que en `validacion-mora.ts`:
 * en bun, reemplazar un módulo con `mock.module` es global al proceso y
 * envenena a los otros setenta archivos de test.
 */

export type VeredictoGateMora = {
	/** `true` ⇒ el llamador debe cortar la operación con `mensaje`. */
	rechazado: boolean;
	motivo: ConsultaMoraResponse["motivo"];
	mensaje: string;
};

export type DependenciasGateMora = {
	/** Pregunta a cartera. En producción, `carteraBackClient.consultarMoraPorDpi`. */
	consultar: (
		dpi: string,
		numerosCreditoConocidos?: string[],
	) => Promise<ConsultaMoraResponse>;
	/**
	 * Los números de crédito que el CRM asocia a este DPI. En producción,
	 * `numerosSifcoConocidosPorDpi` (`lib/numeros-sifco-por-dpi.ts`).
	 *
	 * 🔴 Existe porque cartera resuelve el DPI preguntándole a SIFCO, y SIFCO no
	 * conoce los créditos que nacieron acá: los `CRM-<uuid>` de las oportunidades
	 * ganadas en el CRM ni los `insoluto-N`. Para el cliente cuyos créditos son
	 * TODOS de esos, el core ni siquiera tiene ficha suya y la consulta salía
	 * "no encontrado" → puede continuar. El CRM es la única fuente que puede
	 * cerrar ese hueco, porque es quien emitió esos números.
	 *
	 * Opcional: sin ella el gate sigue funcionando sobre lo que SIFCO sí ve.
	 */
	numerosCreditoConocidos?: (dpi: string) => Promise<string[]>;
	/**
	 * La palanca de emergencia. En producción, `isCarteraBackEnabled`
	 * (`ENABLE_CARTERA_BACK_INTEGRATION`), la misma que el resto del CRM ya
	 * consulta para degradar con gracia cuando cartera no está.
	 *
	 * 🔴 Si devuelve `false`, el gate es **fail-open** y deja pasar SIN
	 * consultar. Es deliberado y es lo contrario del fail-closed de más abajo:
	 * aquel cubre "cartera no contestó" —un fallo, donde no saber tiene que
	 * frenar—, y esto cubre "un humano apagó la integración a mano". Si SIFCO
	 * queda caído horas, sin esta palanca no habría forma de seguir dando de
	 * alta clientes salvo desplegando código. La diferencia es quién decide:
	 * acá decide una persona tocando una variable de entorno, no una excepción.
	 *
	 * Cada paso así queda anotado con acción propia
	 * (`validar_mora_dpi_apagado`), porque mientras la bandera esté abajo entra
	 * gente sin validar y después hay que poder saber quiénes fueron.
	 *
	 * Opcional: sin ella el gate consulta siempre.
	 */
	habilitado?: () => boolean;
	/** Deja la fila en la bitácora. En producción, `auditRecord`. */
	anotar: (entrada: AuditEntry) => void;
};

/**
 * Lo que dice el gate cuando la integración está apagada. No es un rechazo
 * —`rechazado: false`—, así que este texto normalmente no lo ve nadie: existe
 * para que quien lea el veredicto en un log no confunda "no tiene mora" con
 * "no se miró".
 */
export const MENSAJE_GATE_APAGADO =
	"La validación de mora está desactivada por configuración; no se consultó el estado del cliente en cartera.";

/**
 * El texto del rechazo. Es distinto del de `mensajeConsultaMora` a propósito:
 * aquel describe un estado para una pantalla de consulta, este explica por qué
 * la operación no siguió.
 *
 * Los cuatro casos se redactan bien separados porque el asesor tiene que poder
 * distinguir "esta persona está en mora" de "no pudimos averiguarlo": lo
 * primero es una decisión sobre el cliente, lo segundo es un problema nuestro
 * que se resuelve reintentando. El insoluto se separa de la mora por la misma
 * razón: no se arregla poniéndose al día, así que prometer eso sería mandar al
 * asesor a una gestión imposible.
 */
export function mensajeRechazoGateMora(
	motivo: ConsultaMoraResponse["motivo"],
): string {
	switch (motivo) {
		case "MORA_ACTIVA":
			return "El DPI corresponde a un cliente con saldo en mora en cartera. No se puede continuar hasta que se ponga al día.";
		case "CREDITO_INSOLUTO":
			return "El DPI corresponde a un cliente con un crédito insoluto en cartera. No se puede continuar.";
		case "EN_CONVENIO":
			return "El DPI corresponde a un cliente con un convenio de pago vigente en cartera. No se puede continuar mientras el convenio esté vigente.";
		case "SERVICIO_NO_DISPONIBLE":
			return "No se pudo verificar el estado de mora del cliente porque el sistema de cartera no está disponible. No se puede continuar; intenta de nuevo en unos minutos.";
		default:
			// Ningún otro motivo bloquea (`puedeContinuar` viene en `true`), pero si
			// cartera estrena uno que sí bloquee, el gate no puede quedarse mudo.
			return "No se puede continuar: cartera no autorizó el registro para este DPI.";
	}
}

/**
 * Consulta la mora de un DPI **ya validado y normalizado** y dice si la
 * operación puede seguir.
 *
 * Fail-closed por los dos caminos que trae `resolverValidacionMora`: la
 * excepción `ConsultaMoraNoDisponibleError` y el HTTP 200 con
 * `motivo: "SERVICIO_NO_DISPONIBLE"`. Nunca se mira `tieneMoraActiva` —ahí
 * `false` significa "no consta", no "está al día"—: el campo del veredicto es
 * `puedeContinuar`.
 *
 * Antes de preguntar, junta los números de crédito que el CRM ya asocia a ese
 * DPI y se los pasa a cartera (ver `numerosCreditoConocidos`). Si esa búsqueda
 * falla, el gate corta: la consulta sin esos números vería menos cartera de la
 * que hay, y un veredicto armado sobre media cartera es exactamente el falso
 * "sin mora" que este gate existe para evitar.
 */
export async function evaluarGateMoraDpi(
	dpiNormalizado: string,
	deps: DependenciasGateMora,
): Promise<VeredictoGateMora> {
	// Fail-open DELIBERADO, y el único del gate: la integración con cartera está
	// apagada a mano. Va antes que todo lo demás para que ni la búsqueda de
	// números ni la consulta lleguen a salir. Ver `habilitado` arriba.
	if (deps.habilitado && !deps.habilitado()) {
		deps.anotar({
			entity: "lead",
			id: null,
			action: "validar_mora_dpi_apagado",
			data: {
				dpi: dpiNormalizado,
				detalle:
					"la integración con cartera está desactivada (ENABLE_CARTERA_BACK_INTEGRATION); se dejó pasar sin consultar la mora",
			},
		});
		return {
			rechazado: false,
			motivo: "SIN_MORA",
			mensaje: MENSAJE_GATE_APAGADO,
		};
	}

	let numerosConocidos: string[] = [];
	if (deps.numerosCreditoConocidos) {
		try {
			numerosConocidos = await deps.numerosCreditoConocidos(dpiNormalizado);
		} catch (error) {
			console.error(
				`[evaluarGateMoraDpi] no se pudieron reunir los números de crédito del CRM: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
			deps.anotar({
				entity: "lead",
				id: null,
				action: "validar_mora_dpi_no_disponible",
				data: {
					dpi: dpiNormalizado,
					motivo: "SERVICIO_NO_DISPONIBLE",
					detalle: "falló la búsqueda de números de crédito en el CRM",
				},
				ok: false,
				errorCode: "SERVICIO_NO_DISPONIBLE",
			});
			return {
				rechazado: true,
				motivo: "SERVICIO_NO_DISPONIBLE",
				mensaje: mensajeRechazoGateMora("SERVICIO_NO_DISPONIBLE"),
			};
		}
	}

	const resultado = await resolverValidacionMora(dpiNormalizado, {
		// El DPI ya pasó por `validarDpi` en el sitio que llama —es su primer
		// paso— y volver a validarlo acá solo abriría la puerta a que las dos
		// validaciones se separen. `resolverValidacionMora` entonces nunca
		// devuelve `dpi_invalido` por este camino.
		validar: (dpi) => ({ valid: true as const, dpiLimpio: dpi }),
		// Los números viajan atados acá y no como parámetro de
		// `resolverValidacionMora`: aquella función es la regla del veredicto y no
		// tiene por qué enterarse de cómo se arma la pregunta.
		consultar: (dpi) => deps.consultar(dpi, numerosConocidos),
		anotar: deps.anotar,
	});

	if (resultado.tipo === "dpi_invalido") {
		// Inalcanzable con el `validar` de arriba, pero el tipo lo contempla y el
		// fail-closed manda: ante la duda, no pasa.
		return {
			rechazado: true,
			motivo: "SERVICIO_NO_DISPONIBLE",
			mensaje: mensajeRechazoGateMora("SERVICIO_NO_DISPONIBLE"),
		};
	}

	const { veredicto } = resultado;

	if (veredicto.puedeContinuar) {
		return {
			rechazado: false,
			motivo: veredicto.motivo,
			mensaje: veredicto.mensaje,
		};
	}

	return {
		rechazado: true,
		motivo: veredicto.motivo,
		mensaje: mensajeRechazoGateMora(veredicto.motivo),
	};
}

/**
 * ¿Hay que consultar a cartera en esta edición?
 *
 * 🔴 Solo si el DPI es nuevo o cambia. Consultar en toda edición dejaría a los
 * clientes morosos imposibles de editar —nadie podría corregirles el teléfono
 * ni la dirección—, y los morosos son justamente a quienes cobranza edita
 * todos los días. El gate existe para no dejar entrar gente nueva, no para
 * congelar las fichas que ya están adentro.
 *
 * Un registro que no tenía DPI y al que se le pone uno SÍ cuenta como nuevo:
 * ahí el DPI entra al sistema por primera vez y nunca pasó por el gate.
 *
 * Ambos lados se normalizan porque los DPI viejos quedaron guardados con
 * espacios ("3460 66638 0101"): comparar en crudo vería un cambio donde no lo
 * hay y mandaría a consultar de más.
 */
/**
 * La frase que se le suma al rechazo en las EDICIONES. Sin ella, el asesor que
 * está corrigiendo un DPI mal tecleado lee "no se puede continuar" y no tiene
 * a dónde ir: el dato malo se queda ahí para siempre.
 */
export const MENSAJE_CORRECCION_POR_ADMINISTRADOR =
	"Si el DPI quedó mal capturado, un administrador puede corregirlo.";

export type ResolucionEdicionConMora =
	| { permitir: true }
	| { permitir: false; mensaje: string };

/**
 * Qué hacer cuando el gate rechaza una EDICIÓN de DPI (`updateLead`,
 * `updateCoDebtor`). Nunca en un alta y nunca en el portal.
 *
 * 🔴 El agujero que tapa. Si a un cliente le capturaron mal el DPI y el
 * correcto resulta ser el de una persona con mora, poner el correcto es —para
 * el gate— "cambiar a un DPI con mora", así que rechaza. El resultado es que el
 * dato malo queda congelado: nadie puede arreglarlo nunca, ni el día que
 * cobranza necesita cobrarle a esa ficha. Y no es una admisión nueva: la
 * persona ya está adentro, lo que cambia es que su identificador pase a ser el
 * de verdad.
 *
 * Por eso la válvula es SOLO `admin`, y no `canUpdateAnyLead` (`!== "sales"`,
 * que incluye analista, jurídico y supervisor de ventas): es el criterio más
 * restrictivo razonable. Saltarse el gate de mora es exactamente la clase de
 * cosa que un asesor con presión de cuota pediría "de favor" a su supervisor,
 * y el punto del gate es que esa conversación no exista. Si algún día
 * operaciones necesita que jurídico también corrija DPIs, se amplía acá, con
 * la misma fila de bitácora.
 *
 * El paso NO es silencioso: deja `validar_mora_dpi_override_admin` con el
 * motivo que el gate había dado, para que la revisión pueda preguntar después
 * por qué ese DPI entró pese a la mora.
 */
export function resolverEdicionConMora(
	gate: VeredictoGateMora,
	userRole: string | null | undefined,
	destino: {
		entity: AuditEntry["entity"];
		/** `null` cuando la fila editada no es un lead (p. ej. un co-deudor). */
		id: string | null;
		dpi: string;
		/** Contexto extra para la bitácora (p. ej. `{ coDebtorId }`). */
		datosExtra?: Record<string, unknown>;
	},
	anotar: (entrada: AuditEntry) => void,
): ResolucionEdicionConMora {
	if (!gate.rechazado) {
		return { permitir: true };
	}

	if (userRole !== "admin") {
		return {
			permitir: false,
			mensaje: `${gate.mensaje} ${MENSAJE_CORRECCION_POR_ADMINISTRADOR}`,
		};
	}

	anotar({
		entity: destino.entity,
		id: destino.id,
		action: "validar_mora_dpi_override_admin",
		data: {
			dpi: destino.dpi,
			motivo: gate.motivo,
			mensajeDelGate: gate.mensaje,
			detalle:
				"un administrador corrigió el DPI pese al rechazo del gate de mora",
			...destino.datosExtra,
		},
	});

	return { permitir: true };
}

export function requiereConsultaDeMora(
	dpiNuevoNormalizado: string,
	dpiGuardado: string | null | undefined,
): boolean {
	if (!dpiGuardado || dpiGuardado.trim() === "") {
		return true;
	}
	return normalizarDpi(dpiGuardado) !== normalizarDpi(dpiNuevoNormalizado);
}
