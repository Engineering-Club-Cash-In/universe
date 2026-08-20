/**
 * Leer una boleta de pago con IA.
 *
 * Mismo motor que el análisis de estados de cuenta (`routers/bank-analysis.ts`):
 * Gemini vía `@ai-sdk/google` + `generateObject`, que valida la salida contra el
 * schema en el borde en vez de a mitad del insert. Sin dependencia ni cuenta
 * nueva (D-25).
 *
 * Parámetros distintos a los del análisis bancario, porque el problema es otro:
 * acá es UNA imagen, no nueve PDF. 30 s de timeout y **cero reintentos**: si la
 * foto salió mal, reintentar con la misma foto solo duplica el costo. El
 * reintento lo hace el cliente mandando otra (D-27).
 *
 * Contrato: docs/features/bot-whatsapp-cobros/04-validacion-de-boleta.md (§8)
 */

import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";

const MODELO = "gemini-3-flash-preview";
const TIMEOUT_MS = 30_000;

export const boletaPagoSchema = z.object({
	banco: z
		.string()
		.optional()
		.describe("Banco emisor, tal como aparece impreso en el comprobante"),
	monto: z
		.string()
		.optional()
		.describe(
			"Monto total en quetzales. Solo dígitos y punto decimal, sin Q ni comas",
		),
	fechaBoleta: z
		.string()
		.optional()
		.describe("Fecha de la operación en formato YYYY-MM-DD"),
	numeroAutorizacion: z
		.string()
		.optional()
		.describe(
			"Número de autorización, de depósito, de documento o de referencia de la operación",
		),
	cuentaDestino: z
		.string()
		.optional()
		.describe(
			"Número COMPLETO de la cuenta que recibe el dinero, solo dígitos",
		),
	nombreCuentaDestino: z
		.string()
		.optional()
		.describe("A nombre de quién está la cuenta que recibe el dinero"),
	tipoOperacion: z
		.string()
		.optional()
		.describe("depósito monetario, transferencia, cheque, pago de servicios…"),
	observaciones: z
		.string()
		.optional()
		.describe("Concepto o descripción de la operación, si aparece"),
	esBoletaDePago: z
		.boolean()
		.describe("false si la imagen no es un comprobante bancario"),
	extraccionExitosa: z.boolean(),
	camposNoLeidos: z.array(z.string()),
});

export type BoletaLeida = z.infer<typeof boletaPagoSchema>;

/**
 * Las tres trampas del prompt salieron de mirar boletas reales.
 *
 * 1. Una boleta de Banrural tiene CUATRO números que se parecen —depósito,
 *    cuenta, oficina y usuario— y solo uno es la autorización.
 * 2. Las fechas son DD/MM: `4/5/2026` es 4 de mayo. Sin decirlo, el modelo
 *    asume formato gringo la mitad de las veces.
 * 3. El banco puede aparecer con dos nombres EN LA MISMA HOJA: `BANRURAL` en el
 *    logo y `Banco de Desarrollo Rural, S.A.` en el pie.
 */
const PROMPT = `Eres un especialista en leer comprobantes de pago bancarios de Guatemala: boletas de depósito monetario, transferencias, cheques y comprobantes de agentes bancarios.

Extrae únicamente lo que está impreso en la imagen. NO inventes ningún dato: si un campo no se lee con claridad, déjalo vacío y agrégalo a camposNoLeidos.

REGLAS QUE IMPORTAN:

1. NÚMERO DE AUTORIZACIÓN. Es el que identifica la OPERACIÓN: viene rotulado como "No. de autorización", "Número de depósito", "No. de documento", "Referencia" o "No. de transacción". NO uses el número de cuenta, ni el de oficina, ni el de usuario, ni el NIT: en una misma boleta hay varios números parecidos y solo uno sirve.

2. FECHAS. En Guatemala se escriben DÍA/MES/AÑO. "4/5/2026" es el 4 de mayo de 2026, NO el 5 de abril. Devuélvela siempre como YYYY-MM-DD. Si la boleta trae fecha y hora, toma solo la fecha.

3. BANCO. Puede aparecer con más de un nombre en la misma hoja: el comercial en el logo ("BANRURAL") y el razón social en la letra pequeña ("Banco de Desarrollo Rural, S.A."). Devuelve el del logo o encabezado, que es el más confiable.

4. MONTO. Solo dígitos y punto decimal: "1500.00", nunca "Q1,500.00". Si hay varios montos, toma el TOTAL de la operación.

5. CUENTA DESTINO. El número COMPLETO de la cuenta que RECIBE el dinero, con todos sus dígitos y sin enmascarar. Si la boleta también dice a nombre de quién está, ponlo en nombreCuentaDestino.

6. SI LA IMAGEN NO ES UN COMPROBANTE BANCARIO —una selfie, una foto de una pantalla, un documento cualquiera— pon esBoletaDePago en false y no inventes campos.

extraccionExitosa es true solo si pudiste leer al menos el monto.`;

export type ResultadoLectura =
	| { ok: true; lectura: BoletaLeida }
	| { ok: false; codigo: "LECTOR_NO_DISPONIBLE" };

/**
 * Al modelo se le manda la imagen y **nada más**.
 *
 * Nunca el monto esperado, el nombre del cliente ni el saldo: si le decimos qué
 * esperamos encontrar, lo encuentra. El cruce contra el crédito se hace después,
 * con la respuesta ya en la mano.
 */
export async function leerBoletaConIA(archivo: {
	buffer: Buffer;
	tipo: string;
}): Promise<ResultadoLectura> {
	try {
		const esPDF = archivo.tipo === "application/pdf";

		const { object } = await generateObject({
			model: google(MODELO),
			schema: boletaPagoSchema,
			abortSignal: AbortSignal.timeout(TIMEOUT_MS),
			messages: [
				{ role: "system", content: PROMPT },
				{
					role: "user",
					content: [
						{ type: "text", text: "Lee este comprobante de pago:" },
						esPDF
							? {
									type: "file" as const,
									data: archivo.buffer,
									mediaType: "application/pdf" as const,
									filename: "boleta.pdf",
								}
							: {
									type: "image" as const,
									image: archivo.buffer,
									mediaType: archivo.tipo,
								},
					],
				},
			],
		});

		return { ok: true, lectura: object };
	} catch (error) {
		// Timeout, cuota, modelo caído: todo es lo mismo para el cliente, y NO le
		// gasta un intento (D-27). El detalle queda en el log.
		console.error("[BotCobros] lectura de boleta:", error);
		return { ok: false, codigo: "LECTOR_NO_DISPONIBLE" };
	}
}

/**
 * ¿Qué tan completa quedó la lectura?
 *
 * Es para que el bot module el texto, no para ramificar: `baja` significa que
 * falta algo que el cliente va a tener que confirmar con más cuidado.
 */
export function calcularConfianza(
	lectura: BoletaLeida,
	bancoReconocido: boolean,
): "alta" | "media" | "baja" {
	if (!bancoReconocido || !lectura.fechaBoleta) return "baja";
	if (!lectura.numeroAutorizacion || !lectura.cuentaDestino) return "media";
	return "alta";
}

/**
 * Normaliza el monto leído a un número.
 *
 * El prompt pide dígitos y punto, pero los modelos igual devuelven "Q1,500.00"
 * de vez en cuando; limpiarlo acá es más barato que un reintento.
 */
export function montoALimpio(monto: string | undefined): number | null {
	if (!monto) return null;

	const limpio = monto.replace(/[^\d.,]/g, "").replace(/,/g, "");
	const numero = Number(limpio);

	if (!Number.isFinite(numero) || numero <= 0) return null;

	return Math.round(numero * 100) / 100;
}

/**
 * Valida la fecha leída y la acota.
 *
 * Una boleta no puede ser de mañana: si viene futura, se usa hoy — el cliente
 * no tiene la culpa de que el modelo leyera mal, y conta lo va a ver igual.
 */
export function fechaBoletaValida(
	fecha: string | undefined,
	hoy: string,
): { fecha: string; corregida: boolean } {
	if (!fecha || !esFechaDeCalendario(fecha)) {
		return { fecha: hoy, corregida: true };
	}
	if (fecha > hoy) return { fecha: hoy, corregida: true };

	return { fecha, corregida: false };
}

/**
 * ¿Existe ese día en el calendario?
 *
 * Con solo mirar la forma (`\d{4}-\d{2}-\d{2}`), un `2026-02-31` del modelo
 * pasaría el filtro, ordenaría antes que hoy y llegaría hasta el `INSERT` — donde
 * Postgres lo rechaza y convierte una lectura recuperable en un 500, con la
 * imagen ya subida a R2 y sin borrador que la referencie.
 *
 * Se compara ida y vuelta: `new Date("2026-02-31")` da el 3 de marzo, así que al
 * volver a serializarlo no coincide y se descarta.
 */
export function esFechaDeCalendario(fecha: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;

	const parsed = new Date(`${fecha}T00:00:00Z`);
	if (Number.isNaN(parsed.getTime())) return false;

	return parsed.toISOString().slice(0, 10) === fecha;
}
