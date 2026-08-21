/**
 * Paso 4 · El cliente confirmó: se registra el pago en cartera.
 *
 * Contrato: docs/features/bot-whatsapp-cobros/04-validacion-de-boleta.md (§4, §5)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EL CASO FEO NO ES QUE EL CLIENTE CONFIRME DOS VECES.
 *
 * Es que **cartera registre el pago y nosotros no nos enteremos**: un timeout,
 * un corte de red, el proceso que se cae entre el `newPayment` y el guardado.
 * Si un reintento viera el borrador todavía sin confirmar, volvería a llamar a
 * cartera y crearía un **segundo pago real**.
 *
 * Y la protección de cartera no alcanza: su chequeo de duplicados solo corre
 * cuando vienen `numeroAutorizacion` y `banco_id` a la vez, y hay boletas que no
 * traen autorización. Sin autorización, no hay red.
 *
 * Por eso la confirmación es una máquina de tres pasos y el borrador se marca
 * `confirmando` **antes** de salir a cartera:
 *
 *   leida ──(UPDATE ... WHERE estado='leida')──► confirmando ──► confirmada
 *                                                     │
 *                                                     └─ nadie contestó: se
 *                                                        queda ahí y lo resuelve
 *                                                        la reconciliación
 *
 * El monto NO viaja en el request: sale del borrador. Es la diferencia entre
 * que el monto lo dicte la boleta y que lo dicte quien está del otro lado del
 * chat (D-26).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { and, eq, gt, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "../../db";
import {
	botCobrosBoletaPagos,
	botCobrosBoletas,
	type EstadoBoletaBot,
} from "../../db/schema/bot-cobros-boletas";
import { carteraBackClient } from "../../services/cartera-back-client";
import { reconocerCuenta } from "../cuentas-pago";
import { bancoValido, nombreDeBanco } from "./bancos-boleta";
import { creditoAceptaBoleta, hoyGuatemala } from "./boleta";
import { type MensajesBoleta, mensajesPagoRegistrado } from "./mensajes-boleta";
import { verificarAcceso } from "./menu-credito";

/** Quién queda registrado como autor del pago. Es el filtro del circuito de vuelta. */
export const REGISTRADO_POR = "bot-cobros@clubcashin.com";

/** Una boleta de más de esto no la subió un cliente normal: es un error de lectura. */
const DIAS_PARA_AVISARLE_A_CONTA = 90;

export type CodigoConfirmarBoleta =
	| "REFERENCIA_INVALIDA"
	| "SESION_VENCIDA"
	| "CREDITO_NO_ES_DEL_CLIENTE"
	| "CREDITO_SIN_DATOS"
	| "CREDITO_NO_ACEPTA_BOLETA"
	| "BORRADOR_NO_ENCONTRADO"
	| "BORRADOR_VENCIDO"
	| "BORRADOR_NO_CONFIRMABLE"
	| "BOLETA_YA_CONFIRMADA"
	| "CONFIRMACION_EN_CURSO"
	| "BOLETA_DUPLICADA"
	| "BANCO_REQUERIDO"
	| "BANCO_INVALIDO"
	| "PAGO_NO_REGISTRADO"
	| "CARTERA_NO_DISPONIBLE";

export type BoletaConfirmada = {
	/** Una lista, no un id: una boleta que cubre dos cuotas crea dos pagos (§5.2). */
	pagoIds: number[];
	cuotasCubiertas: number[];
	estado: "en_validacion";
	monto: string;
	banco: string | null;
	fechaBoleta: string;
	numeroAutorizacion: string | null;
	mensajes: MensajesBoleta;
};

export type ResultadoConfirmarBoleta =
	| { ok: true; boleta: BoletaConfirmada }
	| {
			ok: false;
			codigo: CodigoConfirmarBoleta;
			datos?: Record<string, unknown>;
	  };

/** Estados desde los que ya no se puede confirmar, y por qué. */
const YA_REGISTRADOS: EstadoBoletaBot[] = [
	"confirmada",
	"confirmada_a_verificar",
];

/**
 * La observación que ve contabilidad.
 *
 * Es donde va todo lo que el bot **no bloquea pero sí tiene que decir**: una
 * cuenta destino que no reconocimos, una boleta de hace meses, la fecha que se
 * corrigió porque venía del futuro. Bloquear por esas cosas sería peor —pueden
 * ser una cuenta vieja o un número mal leído— pero callarlas también.
 */
export function armarObservaciones(datos: {
	fechaBoleta: string | null;
	cuentaDestino: string | null;
	/**
	 * `ilegible` y `no_reconocida` NO son lo mismo y no se reportan igual.
	 *
	 * De una cuenta que no se pudo leer —menos de 6 dígitos— no se dice nada:
	 * "no se pudo verificar" no es "está mal", y anotarlo llenaría las
	 * observaciones de ruido que conta tendría que ignorar todos los días.
	 */
	cuentaEstado: "reconocida" | "ilegible" | "no_reconocida";
	numeroAutorizacion: string | null;
	hoy: string;
}): string {
	const partes = ["Boleta cargada por el cliente vía WhatsApp"];

	if (datos.numeroAutorizacion) {
		partes.push(`Autorización: ${datos.numeroAutorizacion}`);
	} else {
		partes.push("Sin número de autorización legible");
	}

	if (datos.cuentaEstado === "no_reconocida" && datos.cuentaDestino) {
		partes.push(
			`Cuenta destino leída (${datos.cuentaDestino}) NO coincide con las cuentas de Cash-In: verificar`,
		);
	}

	if (datos.fechaBoleta) {
		const dias = Math.floor(
			(Date.parse(`${datos.hoy}T00:00:00Z`) -
				Date.parse(`${datos.fechaBoleta}T00:00:00Z`)) /
				86_400_000,
		);
		if (dias > DIAS_PARA_AVISARLE_A_CONTA) {
			partes.push(`Boleta con ${dias} días de antigüedad`);
		}
	}

	return partes.join(". ");
}

/**
 * ¿Esta misma boleta ya se registró antes en esta sesión?
 *
 * Es el **segundo** control de §9: banco + monto + autorización. El primero —el
 * hash de la imagen— ya corrió al leer.
 *
 * **Solo corre si hay número de autorización, y es a propósito.** Dos depósitos
 * legítimos del mismo banco por el mismo monto —pagar dos cuotas en la misma
 * sesión, algo perfectamente normal— tienen banco y monto idénticos; si además
 * ninguno trae autorización, esos campos vacíos también "coinciden" y el segundo
 * pago quedaría rechazado siendo válido. Comparar `NULL` con `NULL` no es
 * evidencia de nada.
 */
async function yaRegistradaEnLaSesion(borrador: {
	id: string;
	otpId: string | null;
	bancoId: number | null;
	monto: string | null;
	numeroAutorizacion: string | null;
}): Promise<string | null> {
	if (!borrador.numeroAutorizacion || !borrador.otpId) return null;

	const [gemela] = await db
		.select({ id: botCobrosBoletas.id })
		.from(botCobrosBoletas)
		.where(
			and(
				eq(botCobrosBoletas.otpId, borrador.otpId),
				ne(botCobrosBoletas.id, borrador.id),
				eq(botCobrosBoletas.numeroAutorizacion, borrador.numeroAutorizacion),
				borrador.bancoId === null
					? isNotNull(botCobrosBoletas.id)
					: eq(botCobrosBoletas.bancoId, borrador.bancoId),
				borrador.monto === null
					? isNotNull(botCobrosBoletas.id)
					: eq(botCobrosBoletas.monto, borrador.monto),
				// Solo bloquea lo que llegó a registrarse o está en camino.
				sql`${botCobrosBoletas.estado} IN ('confirmando', 'confirmada', 'confirmada_a_verificar')`,
				gt(botCobrosBoletas.createdAt, sql`now() - interval '24 hours'`),
			),
		)
		.limit(1);

	return gemela?.id ?? null;
}

/** Los pagos que ya quedaron amarrados a un borrador. */
async function pagosDeLaBoleta(
	boletaId: string,
): Promise<{ pagoId: number; numeroCuota: number | null }[]> {
	return db
		.select({
			pagoId: botCobrosBoletaPagos.pagoId,
			numeroCuota: botCobrosBoletaPagos.numeroCuota,
		})
		.from(botCobrosBoletaPagos)
		.where(eq(botCobrosBoletaPagos.boletaId, boletaId));
}

export async function confirmarBoleta(input: {
	referencia: string;
	numeroSifco: string;
	boletaId: string;
	bancoId?: number;
}): Promise<ResultadoConfirmarBoleta> {
	// 1 · Que quien confirma sea el dueño del crédito (D-24).
	const acceso = await verificarAcceso(input.referencia, input.numeroSifco);
	if (!acceso.ok) return { ok: false, codigo: acceso.codigo };

	const { identidad } = acceso;

	// 2 · El borrador: de ESTA sesión **y de ESTE crédito**.
	//
	// ⚠️ Las dos condiciones, no una. `verificarAcceso` solo prueba que el
	// crédito del request es del cliente, y la sesión solo prueba que el
	// borrador es suyo: un cliente con dos créditos podía leer la boleta contra
	// el crédito A y confirmarla contra el B, y el monto y el comprobante
	// terminaban aplicados al crédito equivocado. Nada en el camino lo
	// desmentía, porque las dos mitades eran legítimas por separado.
	//
	// Un id que no cruce las dos es indistinguible de uno inexistente a
	// propósito: no se confirma que exista.
	const [borrador] = await db
		.select()
		.from(botCobrosBoletas)
		.where(
			and(
				eq(botCobrosBoletas.id, input.boletaId),
				eq(botCobrosBoletas.otpId, identidad.otpId),
				eq(botCobrosBoletas.numeroSifco, input.numeroSifco),
			),
		)
		.limit(1);

	if (!borrador) return { ok: false, codigo: "BORRADOR_NO_ENCONTRADO" };

	// 3 · ¿En qué estado está? Es la primera mitad de la máquina de §4.1.
	if (YA_REGISTRADOS.includes(borrador.estado)) {
		const pagos = await pagosDeLaBoleta(borrador.id);
		return {
			ok: false,
			codigo: "BOLETA_YA_CONFIRMADA",
			datos: { pagoIds: pagos.map((p) => p.pagoId) },
		};
	}

	// Hay una confirmación a medio camino de este MISMO borrador. No se vuelve a
	// llamar a cartera: es exactamente el caso que crearía el segundo pago.
	if (borrador.estado === "confirmando") {
		return { ok: false, codigo: "CONFIRMACION_EN_CURSO" };
	}

	if (borrador.estado !== "leida") {
		// `fallida`, `rechazada`, `revision_manual`, `descartada`, `leyendo`: son
		// callejones distintos, pero ninguno se destraba reintentando la
		// confirmación, y decirle al cliente "probá otra vez" sería mandarlo a
		// chocar contra la misma pared. El estado viaja en `datos` para que el
		// bot elija el mensaje y para poder contarlos.
		return {
			ok: false,
			codigo: "BORRADOR_NO_CONFIRMABLE",
			datos: { estado: borrador.estado },
		};
	}

	if (borrador.expiraEn.getTime() <= Date.now()) {
		return { ok: false, codigo: "BORRADOR_VENCIDO" };
	}

	// 4 · El banco. El request solo puede corregir esto (D-26).
	if (input.bancoId !== undefined && !bancoValido(input.bancoId)) {
		return { ok: false, codigo: "BANCO_INVALIDO" };
	}
	const bancoId = input.bancoId ?? borrador.bancoId;
	if (bancoId === null || bancoId === undefined) {
		return { ok: false, codigo: "BANCO_REQUERIDO" };
	}

	// 5 · El segundo control de duplicados (§9).
	const gemela = await yaRegistradaEnLaSesion({
		id: borrador.id,
		otpId: borrador.otpId,
		bancoId,
		monto: borrador.monto,
		numeroAutorizacion: borrador.numeroAutorizacion,
	});
	if (gemela) {
		return {
			ok: false,
			codigo: "BOLETA_DUPLICADA",
			datos: { boletaId: gemela },
		};
	}

	// 6 · El crédito: de acá salen `usuario_id` y la cuota a pagar.
	const resumen = await carteraBackClient.getResumenCredito(input.numeroSifco);
	if (!resumen) return { ok: false, codigo: "CREDITO_SIN_DATOS" };

	// Se vuelve a mirar el estado, aunque ya se haya mirado al leer: entre las
	// dos llamadas pasaron hasta 15 minutos y el crédito pudo cancelarse o
	// caerse. La regla de §13 es "antes de registrar", y el momento de registrar
	// es este — no aquel.
	if (!creditoAceptaBoleta(resumen.status_credito)) {
		return {
			ok: false,
			codigo: "CREDITO_NO_ACEPTA_BOLETA",
			datos: { estado: resumen.status_credito },
		};
	}

	if (!resumen.cuota_actual) {
		return {
			ok: false,
			codigo: "CREDITO_NO_ACEPTA_BOLETA",
			datos: { estado: "SIN_CUOTA_PENDIENTE" },
		};
	}

	// Cartera lo agregó al resumen en esta misma capa. Si falta, la instancia
	// está vieja: se corta ANTES de marcar `confirmando`, porque un pago sin
	// `usuario_id` cartera lo rechaza igual y quedaría un borrador colgado por
	// un problema de despliegue nuestro.
	if (typeof resumen.usuario_id !== "number") {
		console.error(
			`[BotCobros] /credito/resumen no trae usuario_id (crédito ${input.numeroSifco}): cartera-back está desactualizado`,
		);
		return { ok: false, codigo: "CREDITO_SIN_DATOS" };
	}

	if (!borrador.monto || !borrador.r2Key) {
		// Un `leida` sin monto o sin key no debería existir; si existe, es un bug
		// nuestro y no algo que el cliente pueda arreglar mandando otra foto.
		console.error(
			`[BotCobros] borrador ${borrador.id} en 'leida' sin monto o sin r2Key`,
		);
		return { ok: false, codigo: "BORRADOR_NO_CONFIRMABLE", datos: {} };
	}

	// 7 · LA MARCA. Antes de salir a cartera, y condicionada al estado: dos
	// peticiones simultáneas entran acá y solo una gana.
	const [tomado] = await db
		.update(botCobrosBoletas)
		.set({
			estado: "confirmando",
			bancoId,
			confirmandoDesde: new Date(),
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(botCobrosBoletas.id, borrador.id),
				eq(botCobrosBoletas.estado, "leida"),
			),
		)
		.returning({ id: botCobrosBoletas.id });

	if (!tomado) {
		// La perdió: otra petición ya está adentro o ya terminó.
		const [ahora] = await db
			.select({ estado: botCobrosBoletas.estado })
			.from(botCobrosBoletas)
			.where(eq(botCobrosBoletas.id, borrador.id))
			.limit(1);

		if (ahora && YA_REGISTRADOS.includes(ahora.estado)) {
			const pagos = await pagosDeLaBoleta(borrador.id);
			return {
				ok: false,
				codigo: "BOLETA_YA_CONFIRMADA",
				datos: { pagoIds: pagos.map((p) => p.pagoId) },
			};
		}
		return { ok: false, codigo: "CONFIRMACION_EN_CURSO" };
	}

	// 8 · A cartera. Mismo endpoint y mismos campos que el formulario de conta.
	const hoy = hoyGuatemala();

	// Si la cuenta destino leída es una de las nuestras. No bloquea nada —puede
	// ser una cuenta vieja o un número mal leído, y decirle al cliente "pagaste
	// mal" sería peor que el problema—, pero conta tiene que verlo (§13).
	const cuenta = reconocerCuenta(borrador.cuentaDestino);

	const resultado = await carteraBackClient.registrarPago({
		credito_id: resumen.credito_id,
		usuario_id: resumen.usuario_id,
		monto_boleta: Number(borrador.monto),
		fecha_pago: hoy,
		fecha_boleta: borrador.fechaBoleta ?? hoy,
		// El bot NO elige cuota: siempre la más vieja sin pagar.
		cuotaApagar: resumen.cuota_actual.numero,
		url_boletas: [borrador.r2Key],
		banco_id: bancoId,
		...(borrador.numeroAutorizacion
			? { numeroAutorizacion: borrador.numeroAutorizacion }
			: {}),
		origen_pago: "boleta",
		observaciones: armarObservaciones({
			fechaBoleta: borrador.fechaBoleta,
			cuentaDestino: borrador.cuentaDestino,
			cuentaEstado: cuenta.estado,
			numeroAutorizacion: borrador.numeroAutorizacion,
			hoy,
		}),
		otros: 0,
		// El bot nunca abona a capital.
		abono_directo_capital: 0,
		registerBy: REGISTRADO_POR,
	});

	// 9 · Y ahora las tres respuestas posibles, que son tres estados distintos.
	if (!resultado.ok && resultado.motivo === "sin_respuesta") {
		// **El borrador se queda en `confirmando` a propósito.** No se sabe si el
		// pago existe, y devolverlo a `leida` sería habilitar un segundo pago
		// real. Lo resuelve el job de reconciliación preguntándole a cartera por
		// la r2_key.
		return { ok: false, codigo: "CARTERA_NO_DISPONIBLE" };
	}

	if (!resultado.ok) {
		// Cartera dijo que no: el pago NO se registró y se sabe, así que el
		// borrador vuelve a `leida` y el cliente puede reintentar.
		const esDuplicado = resultado.status === 409;

		await db
			.update(botCobrosBoletas)
			.set({
				// Un 409 de cartera no se reintenta: su chequeo es global y tiene
				// falsos positivos conocidos (§9). El borrador muere acá y lo mira
				// una persona.
				estado: esDuplicado ? "fallida" : "leida",
				motivoFallo: resultado.mensaje.slice(0, 500),
				confirmandoDesde: null,
				updatedAt: new Date(),
			})
			.where(eq(botCobrosBoletas.id, borrador.id));

		if (esDuplicado) {
			// ⚠️ Al cliente NO se le dice "tu boleta está duplicada": el chequeo de
			// cartera compara (autorización, banco) en TODO el sistema, sin mirar
			// el crédito, y las referencias de BAC y G&T se repiten entre clientes
			// distintos —79 bloqueos en producción, 27 contra el crédito de otra
			// persona—. El mensaje neutro vive en el controlador.
			//
			// El aviso al asesor es la capa C, junto con el resto del circuito de
			// notificaciones (§14).
			return {
				ok: false,
				codigo: "BOLETA_DUPLICADA",
				datos: { origen: "cartera" },
			};
		}

		return {
			ok: false,
			codigo: "PAGO_NO_REGISTRADO",
			datos: { status: resultado.status },
		};
	}

	// 10 · Se registró. Ahora hay que poder volver a encontrarlo.
	//
	// Los ids salen de buscar la r2_key en cartera —el mismo puente que usa la
	// reconciliación—. `newPayment` no devuelve los ids a propósito: eso habría
	// exigido tocar `insertPayment`, y cartera se toca solo con endpoints
	// nuevos de lectura (D-38).
	let pagos: { pago_id: number; numero_cuota: number | null }[] = [];
	if (borrador.r2Key) {
		const porBoleta = await carteraBackClient.getPagosPorBoleta(borrador.r2Key);
		pagos = (porBoleta?.pagos ?? [])
			.filter((p) => p.payment_false !== true)
			.map((p) => ({ pago_id: p.pago_id, numero_cuota: p.numero_cuota }));
	}
	const pagoIds = pagos.map((p) => p.pago_id);

	// ⚠️ SIN IDS NO SE CIERRA LA BOLETA, aunque el pago se haya registrado bien.
	//
	// `confirmada` es un estado terminal y la reconciliación solo mira los
	// `confirmando`: cerrarla acá dejaría un pago real que el CRM no sabe de
	// quién es **para siempre**. Cuando conta lo valide, el evento llegaría con
	// un `pago_id` huérfano y el cliente nunca se enteraría de que se acreditó.
	//
	// Queda en `confirmando` a propósito, que es exactamente lo que significa:
	// el pago está, el mapeo no. La reconciliación lo recupera en cuanto cartera
	// pueda responder por la r2_key.
	if (pagoIds.length === 0) {
		console.error(
			`[BotCobros] la boleta ${borrador.id} registró el pago pero cartera no devolvió ningún id (¿instancia desactualizada?): queda para la reconciliación`,
		);

		return {
			ok: true,
			boleta: {
				pagoIds: [],
				cuotasCubiertas: [resumen.cuota_actual.numero],
				estado: "en_validacion",
				monto: borrador.monto,
				banco: nombreDeBanco(bancoId),
				fechaBoleta: borrador.fechaBoleta ?? hoy,
				numeroAutorizacion: borrador.numeroAutorizacion,
				mensajes: mensajesPagoRegistrado(borrador.monto),
			},
		};
	}

	// Se amarran los pagos ANTES de dar por confirmada la boleta: si el proceso
	// muere entre las dos escrituras, un borrador en `confirmando` con sus pagos
	// ya guardados lo resuelve la reconciliación, mientras que uno `confirmada`
	// sin pagos sería un pago sin dueño.
	await db
		.insert(botCobrosBoletaPagos)
		.values(
			pagos.map((p) => ({
				boletaId: borrador.id,
				pagoId: p.pago_id,
				numeroCuota: p.numero_cuota,
			})),
		)
		// El unique global por `pago_id` es lo que permite que un evento entrante
		// encuentre su boleta; si un id ya estuviera amarrado, no se pisa nada.
		.onConflictDoNothing();

	const cuotasCubiertas: number[] = [];
	for (const p of pagos) {
		if (
			typeof p.numero_cuota === "number" &&
			!cuotasCubiertas.includes(p.numero_cuota)
		) {
			cuotasCubiertas.push(p.numero_cuota);
		}
	}

	await db
		.update(botCobrosBoletas)
		.set({
			estado: "confirmada",
			confirmandoDesde: null,
			updatedAt: new Date(),
		})
		.where(eq(botCobrosBoletas.id, borrador.id));

	return {
		ok: true,
		boleta: {
			pagoIds,
			cuotasCubiertas: cuotasCubiertas.length
				? cuotasCubiertas
				: [resumen.cuota_actual.numero],
			estado: "en_validacion",
			monto: borrador.monto,
			banco: nombreDeBanco(bancoId),
			fechaBoleta: borrador.fechaBoleta ?? hoy,
			numeroAutorizacion: borrador.numeroAutorizacion,
			mensajes: mensajesPagoRegistrado(borrador.monto),
		},
	};
}
