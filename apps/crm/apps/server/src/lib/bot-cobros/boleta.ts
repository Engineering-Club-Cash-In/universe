/**
 * Paso 4 · Leer la boleta que sube el cliente.
 *
 * Contrato: docs/features/bot-whatsapp-cobros/04-validacion-de-boleta.md
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EL ORDEN DE ESTE ARCHIVO ES EL CONTRATO, NO UNA PREFERENCIA:
 *
 *   verificar acceso → descargar → ¿duplicada? → APARTAR EL INTENTO
 *   → leer con IA → subir a R2 → cruzar con el crédito → completar el borrador
 *
 * Tres cosas que parecen detalles y no lo son:
 *   · El intento se aparta ANTES de llamar al modelo, con la fila del OTP
 *     bloqueada. Así una lectura ilegible también gasta su intento, y cuatro
 *     peticiones simultáneas no se saltan el tope (ver `reservarIntento`).
 *   · La IA corre ANTES de subir a R2. Si el modelo dice que la foto no es un
 *     comprobante, no se sube nada y el bucket no se llena de selfies.
 *   · La imagen se copia a NUESTRO R2 acá, al leer, y no al confirmar. Las URLs
 *     de medios de WhatsApp caducan a los pocos minutos, y entre la lectura y
 *     la confirmación pasa justamente eso: minutos (D-31).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { and, eq, gt, not, sql } from "drizzle-orm";
import { db } from "../../db";
import { botCobrosBoletas } from "../../db/schema/bot-cobros-boletas";
import { otps } from "../../db/schema/otp";
import { carteraBackClient } from "../../services/cartera-back-client";
import { reconocerCuenta } from "../cuentas-pago";
import { bancosSugeridos, reconocerBanco } from "./bancos-boleta";
import { descargarBoleta } from "./descarga-imagen";
import {
	calcularConfianza,
	fechaBoletaValida,
	leerBoletaConIA,
	montoALimpio,
} from "./lectura-boleta";
import { armarMensajesBoleta, type MensajesBoleta } from "./mensajes-boleta";
import { type IdentidadSesion, verificarAcceso } from "./menu-credito";

/** Tope de lecturas por sesión (D-27). Al cuarto, con su asesor. */
const MAXIMO_INTENTOS = 3;

/** Lo que dura el borrador: lo que tarda un "¿está bien?" contestado con calma. */
const VIGENCIA_BORRADOR_MINUTOS = 15;

/** Arriba de esto no se registra: es un error de lectura mucho más probable. */
const MONTO_MAXIMO = 1_000_000;

/**
 * Cuánto puede durar una lectura antes de darla por muerta.
 *
 * Una reserva queda en `leyendo` mientras corre Gemini (30 s de tope) y la
 * subida a R2. Si el proceso muere en el medio —un deploy, un OOM— esa fila no
 * la limpia nadie: se quedaría contando contra el tope de tres y bloqueando por
 * hash la misma foto para siempre. El cliente terminaría sin poder subir nada
 * por una caída **nuestra**.
 *
 * Dos minutos es holgado para lo que la operación tarda y corto para lo que el
 * cliente espera.
 */
const VENTANA_LECTURA_MINUTOS = 2;

/**
 * Borradores que ya no sirven para nada y por eso NO deben bloquear por hash.
 *
 * El borrador vive 15 minutos y la sesión 30: si el cliente se toma su tiempo y
 * el borrador vence, lo que se espera es que mande su boleta otra vez. Pero el
 * control de duplicados mira 24 horas hacia atrás, así que reenviar **la misma
 * boleta** —la única que tiene— chocaba contra un `BOLETA_DUPLICADA` del que no
 * había forma de salir.
 *
 * Solo se excluyen los `leida` vencidos: un borrador confirmado, o en camino de
 * serlo, sigue bloqueando su imagen — ahí el duplicado es de verdad.
 */
const BORRADOR_VENCIDO = sql`(
	${botCobrosBoletas.estado} = 'leida'
	AND ${botCobrosBoletas.expiraEn} < now()
)`;

/**
 * Filas que no deben contar: reservas de lecturas que quedaron colgadas.
 *
 * Se usa en los dos lugares que miran el pasado de la sesión —el conteo de
 * intentos y el control de duplicados— porque un fantasma en cualquiera de los
 * dos deja al cliente igual de trabado.
 */
const LECTURA_COLGADA = sql`(
	${botCobrosBoletas.estado} = 'leyendo'
	AND ${botCobrosBoletas.createdAt} < now() - interval '${sql.raw(String(VENTANA_LECTURA_MINUTOS))} minutes'
)`;

/**
 * Estados de crédito a los que se les acepta una boleta.
 *
 * Es lista **blanca**, no negra, y por dos razones que se suman:
 *
 *   · `registerPayment` de cartera solo admite `ACTIVO`, `MOROSO`, `EN_CONVENIO`
 *     e `INCOBRABLE`; cualquier otro le devuelve 404. Con una lista negra, un
 *     estado que no estuviera enumerado —`CAIDO`, por ejemplo— pasaba nuestro
 *     filtro, el cliente subía su boleta, confirmaba, y recién ahí cartera la
 *     rechazaba.
 *   · Un estado nuevo mañana falla **cerrado**: se manda al cliente con su
 *     asesor en vez de dejarlo avanzar hasta un error.
 *
 * `INCOBRABLE` cartera sí lo acepta, pero acá no: es decisión del contrato
 * (§13) mandar esos casos con un asesor.
 */
const ESTADOS_QUE_ACEPTAN = new Set(["ACTIVO", "MOROSO", "EN_CONVENIO"]);

/** ¿A este crédito se le puede registrar una boleta desde el bot? */
export function creditoAceptaBoleta(estado: string): boolean {
	return ESTADOS_QUE_ACEPTAN.has(estado);
}

export type CodigoLeerBoleta =
	| "REFERENCIA_INVALIDA"
	| "SESION_VENCIDA"
	| "CREDITO_NO_ES_DEL_CLIENTE"
	| "CREDITO_SIN_DATOS"
	| "CREDITO_NO_ACEPTA_BOLETA"
	| "DEMASIADOS_INTENTOS"
	| "URL_NO_PERMITIDA"
	| "IMAGEN_NO_DESCARGABLE"
	| "ARCHIVO_MUY_GRANDE"
	| "ARCHIVO_NO_SOPORTADO"
	| "BOLETA_ILEGIBLE"
	| "BOLETA_DUPLICADA"
	| "LECTOR_NO_DISPONIBLE"
	| "ALMACENAMIENTO_NO_DISPONIBLE";

export type BoletaLeidaBot = {
	boletaId: string;
	intento: number;
	intentosRestantes: number;
	expiraEn: string;
	lectura: {
		banco: { id: number; nombre: string; leido: string | null } | null;
		monto: string;
		fechaBoleta: string;
		numeroAutorizacion: string | null;
		cuentaDestino: string | null;
		cuentaReconocida: {
			banco: string;
			bancoId: number;
			titular: string;
		} | null;
		observaciones: string | null;
	};
	bancosSugeridos?: { id: number; nombre: string }[];
	camposFaltantes: string[];
	confianza: "alta" | "media" | "baja";
	aplicacion: {
		estimado: true;
		cuota: { numero: number; de: number; fechaVencimiento: string } | null;
		saldoCuota: string | null;
		mora: string | null;
		/** En qué orden lo va a aplicar cartera: la mora primero, si la hay. */
		orden: string[];
		/** true = hay mora pero su monto no se puede citar; no se estima nada. */
		moraPorConfirmar: boolean;
		/** Lo que le queda a la cuota DESPUÉS de la mora. `null` si no se sabe. */
		paraCuota: string | null;
		cubreMora: boolean;
		cubreCuota: boolean;
		excedente: string;
	};
	mensajes: MensajesBoleta;
};

export type ResultadoLeerBoleta =
	| { ok: true; boleta: BoletaLeidaBot }
	| { ok: false; codigo: CodigoLeerBoleta; datos?: Record<string, unknown> };

/** Hoy en Guatemala, como `YYYY-MM-DD`. */
export function hoyGuatemala(ahora: Date = new Date()): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: "America/Guatemala",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(ahora);
}

/**
 * Aparta un intento de esta sesión, o dice que ya no quedan.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO ES "CONTAR Y DESPUÉS INSERTAR": ESO NO FRENA NADA.
 *
 * Entre el `count` y el `insert` hay una ventana, y cuatro peticiones
 * simultáneas —un reintento del bot, un doble toque del cliente— leerían las
 * cuatro un contador en 0, harían cuatro llamadas a Gemini y recién después
 * insertarían. El tope de tres existe justamente para acotar ese costo.
 *
 * Por eso se cuenta y se inserta **dentro de una transacción con la fila del OTP
 * bloqueada**: la segunda petición espera a que la primera termine y ve el
 * contador ya movido. Es el mismo candado que usa la validación del código.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * La fila se crea ANTES de llamar al modelo, así que una lectura ilegible
 * también gasta su intento — que es el punto: si no, un cliente puede mandar
 * treinta selfies y hacernos pagar treinta lecturas sin llegar nunca al tope.
 */
async function reservarIntento(
	identidad: IdentidadSesion,
	datos: {
		numeroSifco: string;
		creditoId: number;
		imagenUrl: string;
		hash: string;
	},
): Promise<
	| { ok: true; boletaId: string; intento: number }
	| { ok: false; motivo: "sin_intentos" | "repetida"; boletaId?: string }
> {
	return db.transaction(async (tx) => {
		await tx
			.select({ id: otps.id })
			.from(otps)
			.where(eq(otps.id, identidad.otpId))
			.for("update");

		// Con la fila del OTP ya bloqueada, se barren las lecturas que quedaron
		// colgadas. Se borran en vez de marcarlas: es el mismo criterio que con
		// el lector o R2 caídos — un fallo nuestro no le gasta un intento a
		// nadie, y una fila fantasma tampoco puede bloquear su foto por hash.
		await tx
			.delete(botCobrosBoletas)
			.where(and(eq(botCobrosBoletas.otpId, identidad.otpId), LECTURA_COLGADA));

		const [conteo] = await tx
			.select({ total: sql<number>`count(*)::int` })
			.from(botCobrosBoletas)
			.where(eq(botCobrosBoletas.otpId, identidad.otpId));

		const previos = conteo?.total ?? 0;
		if (previos >= MAXIMO_INTENTOS) {
			return { ok: false as const, motivo: "sin_intentos" as const };
		}

		// El chequeo de duplicado de más arriba corre sin candado: dos entregas
		// simultáneas de la MISMA imagen lo pasan las dos y terminan gastando dos
		// intentos y dos lecturas de Gemini por el mismo archivo. Repetirlo acá
		// —ya con la fila del OTP bloqueada— es lo que lo serializa de verdad.
		const [gemela] = await tx
			.select({ id: botCobrosBoletas.id })
			.from(botCobrosBoletas)
			.where(
				and(
					eq(botCobrosBoletas.otpId, identidad.otpId),
					eq(botCobrosBoletas.hashImagen, datos.hash),
					gt(botCobrosBoletas.createdAt, sql`now() - interval '24 hours'`),
					not(BORRADOR_VENCIDO),
				),
			)
			.limit(1);

		if (gemela) {
			return {
				ok: false as const,
				motivo: "repetida" as const,
				boletaId: gemela.id,
			};
		}

		const [fila] = await tx
			.insert(botCobrosBoletas)
			.values({
				otpId: identidad.otpId,
				leadId: identidad.leadId,
				coDebtorId: identidad.coDebtorId,
				numeroSifco: datos.numeroSifco,
				creditoId: datos.creditoId,
				intento: previos + 1,
				imagenOrigenUrl: datos.imagenUrl,
				hashImagen: datos.hash,
				// Todavía no hay nada leído; se llena al terminar.
				lectura: {},
				estado: "leyendo",
				expiraEn: new Date(Date.now() + VIGENCIA_BORRADOR_MINUTOS * 60_000),
			})
			.returning({ id: botCobrosBoletas.id });

		return { ok: true as const, boletaId: fila.id, intento: previos + 1 };
	});
}

/** Cuántas lecturas lleva la sesión. Solo para no bajar una foto de gusto. */
async function contarIntentos(otpId: string): Promise<number> {
	const [fila] = await db
		.select({ total: sql<number>`count(*)::int` })
		.from(botCobrosBoletas)
		.where(and(eq(botCobrosBoletas.otpId, otpId), not(LECTURA_COLGADA)));

	return fila?.total ?? 0;
}

/**
 * Estima a dónde va a ir el dinero, en el orden en que cartera lo aplica.
 *
 * **La mora va primero, siempre.** Sin descontarla, una boleta de Q6,000 con
 * Q1,000 de mora y una cuota de Q5,500 se anunciaría como "cubre tu cuota"
 * cuando a la cuota solo le llegan Q5,000. Es una promesa de plata al cliente:
 * no puede salir de una resta que no se hizo.
 *
 * Es una **estimación** y viaja marcada como tal: la aplicación de verdad la
 * hace cartera cuando contabilidad valida el pago.
 */
export function estimarAplicacion(entrada: {
	monto: number;
	mora: string | null;
	/**
	 * true = tiene mora activa pero cartera NO puede citar el monto ahora.
	 *
	 * Es distinto de no tener mora, y confundirlos es caro: con la bandera
	 * levantada `mora` viene en `null`, y tratarlo como cero haría que el bot
	 * anuncie que todo el dinero va a la cuota cuando cartera va a descontar
	 * antes una cantidad que ni nosotros conocemos.
	 */
	moraPorConfirmar: boolean;
	saldoCuota: string | null;
	numeroCuota: number;
}) {
	// No se estima lo que no se puede sostener: se dice que hay mora, que no se
	// sabe cuánta, y no se afirma que la cuota quede cubierta.
	if (entrada.moraPorConfirmar) {
		return {
			estimado: true as const,
			moraPorConfirmar: true,
			orden: ["mora", `cuota_${entrada.numeroCuota}`],
			paraCuota: null,
			cubreMora: false,
			cubreCuota: false,
			excedente: "0.00",
		};
	}

	const mora = entrada.mora === null ? 0 : Number(entrada.mora);
	const saldoCuota =
		entrada.saldoCuota === null ? null : Number(entrada.saldoCuota);

	const aMora = Math.min(entrada.monto, Math.max(mora, 0));
	const cubreMora = mora <= 0 || entrada.monto >= mora;

	const paraCuota = Math.round((entrada.monto - aMora) * 100) / 100;
	const cubreCuota = saldoCuota !== null && paraCuota >= saldoCuota;

	const excedente =
		saldoCuota !== null && cubreCuota
			? Math.round((paraCuota - saldoCuota) * 100) / 100
			: 0;

	const orden = [...(mora > 0 ? ["mora"] : []), `cuota_${entrada.numeroCuota}`];

	return {
		estimado: true as const,
		moraPorConfirmar: false,
		orden,
		paraCuota: paraCuota.toFixed(2),
		cubreMora,
		cubreCuota,
		excedente: excedente.toFixed(2),
	};
}

/**
 * ¿Ya subió esta misma foto?
 *
 * Por hash, que es la única señal sin falso positivo posible: la misma imagen
 * es el mismo archivo. La comparación por banco+monto+autorización vive en
 * `/boleta/confirmar` y solo corre cuando hay autorización (§9).
 */
async function boletaRepetida(
	otpId: string,
	hash: string,
): Promise<{ id: string } | null> {
	const [fila] = await db
		.select({ id: botCobrosBoletas.id })
		.from(botCobrosBoletas)
		.where(
			and(
				eq(botCobrosBoletas.otpId, otpId),
				eq(botCobrosBoletas.hashImagen, hash),
				gt(botCobrosBoletas.createdAt, sql`now() - interval '24 hours'`),
				not(LECTURA_COLGADA),
				not(BORRADOR_VENCIDO),
			),
		)
		.limit(1);

	return fila ?? null;
}

export async function leerBoleta(input: {
	referencia: string;
	numeroSifco: string;
	imagenUrl: string;
}): Promise<ResultadoLeerBoleta> {
	// 1 · Que quien pregunta sea el dueño del crédito (D-24).
	const acceso = await verificarAcceso(input.referencia, input.numeroSifco);
	if (!acceso.ok) return { ok: false, codigo: acceso.codigo };

	const { identidad } = acceso;

	// 2 · El tope, antes de gastar un centavo en IA.
	const intentosPrevios = await contarIntentos(identidad.otpId);
	if (intentosPrevios >= MAXIMO_INTENTOS) {
		return { ok: false, codigo: "DEMASIADOS_INTENTOS" };
	}

	// 3 · El crédito, que además dice si tiene sentido recibir una boleta.
	const resumen = await carteraBackClient.getResumenCredito(input.numeroSifco);
	if (!resumen) return { ok: false, codigo: "CREDITO_SIN_DATOS" };

	if (!creditoAceptaBoleta(resumen.status_credito)) {
		return {
			ok: false,
			codigo: "CREDITO_NO_ACEPTA_BOLETA",
			datos: { estado: resumen.status_credito },
		};
	}
	// Sin cuota abierta no hay a qué aplicar el pago: el bot nunca elige cuota,
	// siempre usa la más vieja sin pagar, y `/boleta/confirmar` manda ese número
	// a cartera.
	//
	// ⚠️ LIMITACIÓN CONOCIDA, NO UN DESCUIDO: esto también rechaza al crédito
	// EN_CONVENIO cuyas cuotas ordinarias están todas cerradas, aunque el estado
	// esté permitido arriba y cartera sí sepa registrar ese pago —tiene una
	// rama que crea la fila del pago contra el convenio cuando no hay cuotas
	// abiertas—. Para usarla habría que mandarle un `cuotaApagar` que el bot no
	// tiene de dónde sacar, y elegirlo a ojo en el camino que mueve dinero no es
	// una decisión de este PR. Esos clientes salen por el asesor.
	if (!resumen.cuota_actual) {
		return {
			ok: false,
			codigo: "CREDITO_NO_ACEPTA_BOLETA",
			datos: { estado: "SIN_CUOTA_PENDIENTE" },
		};
	}

	// 4 · Bajar la foto. Única salida a la nube de SimpleTech (D-29, D-31).
	const descarga = await descargarBoleta(input.imagenUrl);
	if (!descarga.ok) return { ok: false, codigo: descarga.codigo };

	// 5 · ¿Es la misma foto de hace un rato?
	const repetida = await boletaRepetida(identidad.otpId, descarga.hash);
	if (repetida) {
		return {
			ok: false,
			codigo: "BOLETA_DUPLICADA",
			datos: { boletaId: repetida.id },
		};
	}

	// 6 · Apartar el intento ANTES de gastar la llamada al modelo. Acá el tope
	// es de verdad: la fila queda escrita pase lo que pase después.
	const reserva = await reservarIntento(identidad, {
		numeroSifco: input.numeroSifco,
		creditoId: resumen.credito_id,
		imagenUrl: input.imagenUrl,
		hash: descarga.hash,
	});
	if (!reserva.ok) {
		return reserva.motivo === "repetida"
			? {
					ok: false,
					codigo: "BOLETA_DUPLICADA",
					datos: { boletaId: reserva.boletaId },
				}
			: { ok: false, codigo: "DEMASIADOS_INTENTOS" };
	}

	// 7 · Leer. Un solo intento: si falla, el cliente manda otra foto (D-25).
	const lectura = await leerBoletaConIA(descarga);

	if (!lectura.ok) {
		// El modelo no respondió: es problema NUESTRO, así que se devuelve el
		// intento borrando la reserva. El cliente no tiene por qué pagar nuestra
		// caída con uno de sus tres tiros (D-27).
		await db
			.delete(botCobrosBoletas)
			.where(eq(botCobrosBoletas.id, reserva.boletaId));
		return { ok: false, codigo: lectura.codigo };
	}

	const leida = lectura.lectura;

	// Sin monto no hay pago, y una imagen que no es un comprobante tampoco.
	// Esto SÍ gasta el intento: el modelo respondió y la lectura se pagó.
	const monto = montoALimpio(leida.monto);
	const fueraDeRango = monto !== null && monto > MONTO_MAXIMO;

	if (!leida.esBoletaDePago || monto === null || fueraDeRango) {
		await db
			.update(botCobrosBoletas)
			.set({
				lectura: leida,
				estado: "fallida",
				motivoFallo: fueraDeRango ? "monto fuera de rango" : "no se pudo leer",
				updatedAt: new Date(),
			})
			.where(eq(botCobrosBoletas.id, reserva.boletaId));

		return {
			ok: false,
			codigo: "BOLETA_ILEGIBLE",
			datos: {
				intento: reserva.intento,
				intentosRestantes: MAXIMO_INTENTOS - reserva.intento,
				...(fueraDeRango ? { montoLeido: monto } : {}),
			},
		};
	}

	// 7 · Recién ahora sube a NUESTRO R2: ya sabemos que es un comprobante.
	let r2Key: string;
	try {
		const archivo = new Blob([new Uint8Array(descarga.buffer)], {
			type: descarga.tipo,
		});
		const subida = await carteraBackClient.uploadFile(
			archivo,
			`boleta-bot-${Date.now()}.${descarga.extension}`,
		);
		r2Key = subida.filename ?? subida.url;
	} catch (error) {
		console.error("[BotCobros] subida de boleta a R2:", error);
		// Igual que con el lector: es problema NUESTRO, así que se devuelve el
		// intento. Si la reserva quedara viva, reintentar con la MISMA foto
		// chocaría contra el control de duplicados y el cliente quedaría trabado
		// entre un 503 que le dice "probá de nuevo" y un 409 que se lo impide.
		await db
			.delete(botCobrosBoletas)
			.where(eq(botCobrosBoletas.id, reserva.boletaId));
		return { ok: false, codigo: "ALMACENAMIENTO_NO_DISPONIBLE" };
	}

	// 8 · Cruzar lo leído con lo nuestro.
	const banco = reconocerBanco(leida.banco);
	const cuenta = reconocerCuenta(leida.cuentaDestino);
	const hoy = hoyGuatemala();
	const fecha = fechaBoletaValida(leida.fechaBoleta, hoy);

	const camposFaltantes: string[] = [];
	if (!banco) camposFaltantes.push("banco");
	if (fecha.corregida) camposFaltantes.push("fechaBoleta");
	if (!leida.numeroAutorizacion) camposFaltantes.push("numeroAutorizacion");

	const saldoCuota = await carteraBackClient.getSaldoCuota(
		input.numeroSifco,
		resumen.cuota_actual.numero,
	);

	// La mora se aplica ANTES que la cuota: la estimación tiene que restarla o
	// le prometeríamos al cliente algo que no va a pasar.
	const aplicacion = estimarAplicacion({
		monto,
		mora: resumen.mora?.monto ?? null,
		moraPorConfirmar: resumen.mora_por_confirmar,
		saldoCuota,
		numeroCuota: resumen.cuota_actual.numero,
	});

	// 9 · Completar el borrador que se reservó en el paso 6. Lo que el bot
	// recibe es su id, no los datos: para confirmar solo va a poder mandar ese
	// id (D-26).
	let fila: { id: string; expiraEn: Date } | undefined;
	try {
		[fila] = await db
			.update(botCobrosBoletas)
			.set({
				r2Key,
				lectura: leida,
				bancoId: banco?.id ?? null,
				monto: monto.toFixed(2),
				fechaBoleta: fecha.fecha,
				numeroAutorizacion: leida.numeroAutorizacion ?? null,
				cuentaDestino: leida.cuentaDestino ?? null,
				confianza: calcularConfianza(leida, banco !== null),
				estado: "leida",
				updatedAt: new Date(),
			})
			.where(eq(botCobrosBoletas.id, reserva.boletaId))
			.returning({
				id: botCobrosBoletas.id,
				expiraEn: botCobrosBoletas.expiraEn,
			});
	} catch (error) {
		// La imagen ya subió pero `r2Key` no llegó a ninguna fila: la purga
		// busca por lo que dice la tabla, no listando R2, así que sin este
		// borrado el comprobante (PII del cliente) quedaría huérfano para
		// siempre. Mejor esfuerzo; el error original se propaga igual.
		await carteraBackClient.deleteArchivoBoletaHuerfano(r2Key);
		throw error;
	}

	// La reserva ya no está: la barrió una lectura posterior porque esta tardó
	// más que la ventana. No se puede devolver un `boletaId` que no existe —el
	// bot lo usaría para confirmar y no encontraría nada—, así que se responde
	// como cualquier otro problema nuestro: reintentable y sin gastar intento.
	// Mismo huérfano que arriba: nada referencia `r2Key`, se borra ya.
	if (!fila) {
		console.error(
			`[BotCobros] la reserva ${reserva.boletaId} desapareció durante la lectura`,
		);
		await carteraBackClient.deleteArchivoBoletaHuerfano(r2Key);
		return { ok: false, codigo: "LECTOR_NO_DISPONIBLE" };
	}

	const mensajes = armarMensajesBoleta({
		monto: monto.toFixed(2),
		banco: banco?.nombre ?? null,
		fechaBoleta: fecha.fecha,
		numeroAutorizacion: leida.numeroAutorizacion ?? null,
		cuotaNumero: resumen.cuota_actual.numero,
		cuotaDe: resumen.cuota_actual.de,
		saldoCuota,
		mora: resumen.mora?.monto ?? null,
		moraPorConfirmar: aplicacion.moraPorConfirmar,
		paraCuota: aplicacion.paraCuota,
		cubreMora: aplicacion.cubreMora,
		cubreCuota: aplicacion.cubreCuota,
		camposFaltantes,
	});

	return {
		ok: true,
		boleta: {
			boletaId: fila.id,
			intento: reserva.intento,
			intentosRestantes: MAXIMO_INTENTOS - reserva.intento,
			expiraEn: fila.expiraEn.toISOString(),
			lectura: {
				banco: banco
					? { id: banco.id, nombre: banco.nombre, leido: leida.banco ?? null }
					: null,
				monto: monto.toFixed(2),
				fechaBoleta: fecha.fecha,
				numeroAutorizacion: leida.numeroAutorizacion ?? null,
				cuentaDestino: leida.cuentaDestino ?? null,
				cuentaReconocida:
					cuenta.estado === "reconocida"
						? {
								banco: cuenta.cuenta.banco,
								bancoId: cuenta.cuenta.bancoId,
								titular: cuenta.cuenta.titular,
							}
						: null,
				observaciones: leida.observaciones ?? null,
			},
			// Solo cuando hace falta elegir: mandar 15 bancos en cada lectura es
			// ruido para el bot.
			...(banco ? {} : { bancosSugeridos: bancosSugeridos() }),
			camposFaltantes,
			confianza: calcularConfianza(leida, banco !== null),
			aplicacion: {
				...aplicacion,
				cuota: {
					numero: resumen.cuota_actual.numero,
					de: resumen.cuota_actual.de,
					fechaVencimiento: resumen.cuota_actual.fecha_vencimiento,
				},
				saldoCuota,
				mora: resumen.mora?.monto ?? null,
			},
			mensajes,
		},
	};
}
