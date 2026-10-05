import {
	ConsultaMoraNoDisponibleError,
	type ConsultaMoraResponse,
} from "../types/cartera-back";
import type { AuditEntry } from "./audit";

/**
 * La regla del gate de mora por DPI, sin HTTP, sin base y sin ORPC.
 *
 * Vive aparte del procedure porque es la parte que hay que poder probar de
 * verdad: el procedure es cableado (validar, llamar, responder) y esto es la
 * decisión. Las dependencias entran por parámetro — así el test le pasa
 * funciones comunes y corrientes en vez de reemplazar módulos enteros, que en
 * bun es global al proceso y contamina a los demás archivos de test.
 *
 * La regla es **fail-closed**: si no se pudo saber si la persona está en mora,
 * no se deja pasar. "No sé" nunca se convierte en "no tiene".
 */

export type ValidacionDpi =
	| { valid: true; dpiLimpio: string }
	| { valid: false; error: string };

export type VeredictoMora = ConsultaMoraResponse & { mensaje: string };

export type ResultadoValidacionMora =
	| { tipo: "dpi_invalido"; error: string }
	| { tipo: "veredicto"; veredicto: VeredictoMora };

export type DependenciasValidacionMora = {
	/** Normaliza y valida el DPI. En producción, `validarDpi`. */
	validar: (dpi: string) => ValidacionDpi;
	/** Pregunta a cartera. Lanza `ConsultaMoraNoDisponibleError` si no se pudo. */
	consultar: (dpi: string) => Promise<ConsultaMoraResponse>;
	/** Deja la fila en la bitácora. En producción, `auditRecord`. */
	anotar: (entrada: AuditEntry) => void;
};

/**
 * Estados de crédito que cartera cuenta como mora aunque no haya fila viva en
 * `moras_credito` (p. ej. un CAIDO al que le borraron la mora). Copia
 * deliberada de `STATUS_CON_MORA` en `consultaMoraPolicy.ts` de cartera-back:
 * son dos servicios distintos y el campo `estado` viaja como string libre en el
 * contrato, así que acá solo se usa para CONTAR, nunca para decidir. La
 * decisión sigue siendo de cartera y llega en `motivo`/`puedeContinuar`.
 */
const ESTADOS_CON_MORA = new Set(["MOROSO", "CAIDO", "INCOBRABLE"]);

/**
 * Cuántos créditos motivan el veredicto de mora.
 *
 * 🔴 No es `creditos.filter(c => c.moraActiva)`: cartera declara MORA_ACTIVA
 * también por estado, así que un cliente con un único crédito CAIDO sin fila de
 * mora salía como "mora activa en 0 créditos" — un texto que contradecía al
 * veredicto que lo acompañaba.
 */
export function creditosQueMotivanMora(
	creditos: ConsultaMoraResponse["creditos"],
): number {
	return creditos.filter(
		(c) => c.moraActiva !== null || ESTADOS_CON_MORA.has(c.estado),
	).length;
}

/**
 * Texto para la pantalla. El veredicto lo decide cartera; acá solo se le ponen
 * palabras, en español y sin números de crédito (esos van en el detalle).
 */
export function mensajeConsultaMora(resultado: ConsultaMoraResponse): string {
	switch (resultado.motivo) {
		case "SIN_MORA":
			return "El cliente no tiene mora activa en cartera.";
		case "MORA_ACTIVA": {
			const cuantos = creditosQueMotivanMora(resultado.creditos);
			// Si cartera dijo MORA_ACTIVA con un detalle que no permite contar
			// —créditos recortados, un estado nuevo que acá no se conoce—, el
			// mensaje va sin número antes que mentir con un cero.
			if (cuantos === 0) {
				return "El cliente tiene mora activa en cartera.";
			}
			return cuantos === 1
				? "El cliente tiene mora activa en 1 crédito."
				: `El cliente tiene mora activa en ${cuantos} créditos.`;
		}
		case "CREDITO_INSOLUTO":
			// Sin número de créditos a propósito: uno solo ya basta para bloquear y
			// contarlos invitaría a leer "son pocos" como "es leve".
			return "El cliente tiene un crédito insoluto en cartera.";
		case "EN_CONVENIO":
			return "El cliente tiene un convenio de pago vigente.";
		case "CLIENTE_NO_ENCONTRADO":
			return "El DPI no corresponde a ningún cliente registrado en cartera.";
		case "SERVICIO_NO_DISPONIBLE":
			return "No se pudo verificar el estado de mora del cliente porque el sistema de cartera no está disponible. Intenta de nuevo en unos minutos.";
	}
}

export async function resolverValidacionMora(
	dpiCrudo: string,
	deps: DependenciasValidacionMora,
): Promise<ResultadoValidacionMora> {
	// Antes de molestar a SIFCO: un DPI mal formado no puede ser de nadie.
	const validacion = deps.validar(dpiCrudo);
	if (!validacion.valid) {
		return { tipo: "dpi_invalido", error: validacion.error };
	}
	const dpi = validacion.dpiLimpio;

	// "No se pudo consultar" llega por DOS caminos y los dos terminan igual:
	// (a) cartera no contesta —red, timeout, 5xx, circuit breaker— y el cliente
	//     lanza ConsultaMoraNoDisponibleError;
	// (b) cartera contesta 200 con el contrato completo pero
	//     `motivo: "SERVICIO_NO_DISPONIBLE"` (así lo decidió cartera, para que el
	//     veredicto no se pierda si alguien descarta el cuerpo de un 5xx). Acá el
	//     HTTP salió bien: mirar el status no alcanza.
	const noDisponible = (
		detalle: string,
		mensajeDefinitivo?: string,
	): ResultadoValidacionMora => {
		console.error(
			`[validarMoraPorDpi] no se pudo verificar la mora: ${detalle}`,
		);
		deps.anotar({
			entity: "lead",
			id: null,
			action: "validar_mora_dpi_no_disponible",
			data: { dpi, motivo: "SERVICIO_NO_DISPONIBLE", detalle },
			// Fila propia y con `ok: false`: media hora de SIFCO caído no puede
			// verse en la bitácora como cuarenta clientes morosos.
			ok: false,
			errorCode: "SERVICIO_NO_DISPONIBLE",
		});
		const veredicto: VeredictoMora = {
			encontrado: false,
			tieneMoraActiva: false,
			puedeContinuar: false,
			motivo: "SERVICIO_NO_DISPONIBLE",
			cliente: null,
			creditos: [],
			historialMora: [],
			consultadoEn: new Date().toISOString(),
			mensaje: "",
		};
		return {
			tipo: "veredicto",
			veredicto: {
				...veredicto,
				// El fallo DEFINITIVO (p. ej. más créditos que el tope) trae su propio
				// texto: decirle al asesor "intentá en unos minutos" ante un fallo
				// determinista era mandarlo a reintentar para siempre.
				mensaje: mensajeDefinitivo ?? mensajeConsultaMora(veredicto),
			},
		};
	};

	let resultado: ConsultaMoraResponse;
	try {
		resultado = await deps.consultar(dpi);
	} catch (error) {
		if (!(error instanceof ConsultaMoraNoDisponibleError)) throw error;
		return noDisponible(
			error.message,
			error.definitivo ? error.message : undefined,
		);
	}

	if (resultado.motivo === "SERVICIO_NO_DISPONIBLE") {
		// 🔴 Acá `tieneMoraActiva: false` significa "no consta", NO "está al día".
		// Por eso el veredicto se lee de `motivo`/`puedeContinuar` y nunca de
		// `tieneMoraActiva`: ramificar por ese campo dejaría pasar a todo el mundo
		// justo cuando el core está caído.
		return noDisponible("cartera respondió SERVICIO_NO_DISPONIBLE");
	}

	deps.anotar({
		entity: "lead",
		id: null,
		action: resultado.puedeContinuar
			? "validar_mora_dpi_sin_bloqueo"
			: "validar_mora_dpi_bloqueado",
		data: {
			dpi,
			motivo: resultado.motivo,
			encontrado: resultado.encontrado,
			tieneMoraActiva: resultado.tieneMoraActiva,
			creditosConMora: creditosQueMotivanMora(resultado.creditos),
		},
	});

	return {
		tipo: "veredicto",
		veredicto: { ...resultado, mensaje: mensajeConsultaMora(resultado) },
	};
}
