/**
 * Paso 4 · Leer la boleta que sube el cliente.
 *
 * Contrato: docs/features/bot-whatsapp-cobros/04-validacion-de-boleta.md
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EL ORDEN DE ESTE ARCHIVO ES EL CONTRATO, NO UNA PREFERENCIA:
 *
 *   verificar acceso → contar intentos → descargar → ¿duplicada? → LEER CON IA
 *   → subir a R2 → cruzar con el crédito → guardar borrador
 *
 * Dos cosas que parecen detalles y no lo son:
 *   · La IA corre ANTES de subir a R2. Si el modelo dice que la foto no es un
 *     comprobante, no se sube nada y el bucket no se llena de selfies.
 *   · La imagen se copia a NUESTRO R2 acá, al leer, y no al confirmar. Las URLs
 *     de medios de WhatsApp caducan a los pocos minutos, y entre la lectura y
 *     la confirmación pasa justamente eso: minutos (D-31).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "../../db";
import { botCobrosBoletas } from "../../db/schema/bot-cobros-boletas";
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
import { verificarAcceso } from "./menu-credito";

/** Tope de lecturas por sesión (D-27). Al cuarto, con su asesor. */
const MAXIMO_INTENTOS = 3;

/** Lo que dura el borrador: lo que tarda un "¿está bien?" contestado con calma. */
const VIGENCIA_BORRADOR_MINUTOS = 15;

/** Arriba de esto no se registra: es un error de lectura mucho más probable. */
const MONTO_MAXIMO = 1_000_000;

/** Estados de crédito donde no tiene sentido recibir una boleta. */
const ESTADOS_QUE_NO_ACEPTAN = new Set([
	"CANCELADO",
	"INCOBRABLE",
	"PENDIENTE_CANCELACION",
]);

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
		cubreCuota: boolean;
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
 * Cuántas lecturas lleva esta sesión.
 *
 * Se cuenta sobre los borradores del mismo OTP, que es dato nuestro: si el
 * número de intento viniera del bot, mandar siempre `intento: 1` anularía el
 * tope.
 */
async function contarIntentos(otpId: string): Promise<number> {
	const [fila] = await db
		.select({ total: sql<number>`count(*)::int` })
		.from(botCobrosBoletas)
		.where(eq(botCobrosBoletas.otpId, otpId));

	return fila?.total ?? 0;
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

	if (ESTADOS_QUE_NO_ACEPTAN.has(resumen.status_credito)) {
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

	// 6 · Leer. Un solo intento: si falla, el cliente manda otra foto (D-25).
	const lectura = await leerBoletaConIA(descarga);
	if (!lectura.ok) return { ok: false, codigo: lectura.codigo };

	const leida = lectura.lectura;

	// Sin monto no hay pago, y una imagen que no es un comprobante tampoco.
	const monto = montoALimpio(leida.monto);
	if (!leida.esBoletaDePago || monto === null) {
		return { ok: false, codigo: "BOLETA_ILEGIBLE" };
	}
	if (monto > MONTO_MAXIMO) {
		return {
			ok: false,
			codigo: "BOLETA_ILEGIBLE",
			datos: { montoLeido: monto },
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

	const cubreCuota = saldoCuota !== null && monto >= Number(saldoCuota);

	// 9 · Guardar el borrador. Lo que el bot recibe es su id, no los datos:
	// para confirmar solo va a poder mandar ese id (D-26).
	const expiraEn = new Date(Date.now() + VIGENCIA_BORRADOR_MINUTOS * 60_000);

	const [fila] = await db
		.insert(botCobrosBoletas)
		.values({
			otpId: identidad.otpId,
			leadId: identidad.leadId,
			coDebtorId: identidad.coDebtorId,
			numeroSifco: input.numeroSifco,
			creditoId: resumen.credito_id,
			intento: intentosPrevios + 1,
			imagenOrigenUrl: input.imagenUrl,
			r2Key,
			hashImagen: descarga.hash,
			lectura: leida,
			bancoId: banco?.id ?? null,
			monto: monto.toFixed(2),
			fechaBoleta: fecha.fecha,
			numeroAutorizacion: leida.numeroAutorizacion ?? null,
			cuentaDestino: leida.cuentaDestino ?? null,
			confianza: calcularConfianza(leida, banco !== null),
			estado: "leida",
			expiraEn,
		})
		.returning({ id: botCobrosBoletas.id });

	const mensajes = armarMensajesBoleta({
		monto: monto.toFixed(2),
		banco: banco?.nombre ?? null,
		fechaBoleta: fecha.fecha,
		numeroAutorizacion: leida.numeroAutorizacion ?? null,
		cuotaNumero: resumen.cuota_actual.numero,
		cuotaDe: resumen.cuota_actual.de,
		saldoCuota,
		mora: resumen.mora?.monto ?? null,
		cubreCuota,
		camposFaltantes,
	});

	return {
		ok: true,
		boleta: {
			boletaId: fila.id,
			intento: intentosPrevios + 1,
			intentosRestantes: MAXIMO_INTENTOS - (intentosPrevios + 1),
			expiraEn: expiraEn.toISOString(),
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
				estimado: true,
				cuota: {
					numero: resumen.cuota_actual.numero,
					de: resumen.cuota_actual.de,
					fechaVencimiento: resumen.cuota_actual.fecha_vencimiento,
				},
				saldoCuota,
				mora: resumen.mora?.monto ?? null,
				cubreCuota,
			},
			mensajes,
		},
	};
}
