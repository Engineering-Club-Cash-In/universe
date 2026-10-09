import type { Aseguradora } from "./factura-seguro";

export interface DatosCorreoFacturaSeguro {
	referencia: string;
	cliente: string;
	vehiculo: string | null;
	vin: string | null;
	tipoVehiculo: string | null;
	montoAsegurado: number | null;
	cuotaMensual: number | null;
	aseguradora: Aseguradora;
}

function escapar(texto: string): string {
	return texto
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function quetzales(monto: number | null): string {
	if (monto === null) return "—";
	return `Q ${monto.toLocaleString("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;
}

function saludo(ahora: Date): string {
	const hora = Number(
		new Intl.DateTimeFormat("en-US", {
			hour: "numeric",
			hourCycle: "h23",
			timeZone: "America/Guatemala",
		}).format(ahora),
	);
	if (hora < 12) return "buenos días";
	if (hora < 19) return "buenas tardes";
	return "buenas noches";
}

// Basado en el correo que hoy se manda a mano a la aseguradora; la factura del
// seguro viaja adjunta.
export function armarCorreoFacturaSeguro(
	d: DatosCorreoFacturaSeguro,
	ahora: Date = new Date(),
): { asunto: string; html: string } {
	const cliente = escapar(d.cliente);
	const vehiculo = [d.vehiculo, d.vin ? `VIN ${d.vin}` : null]
		.filter(Boolean)
		.join(" · ");

	const lineas = [
		`<p>Estimados, ${saludo(ahora)}:</p>`,
		`<p>Hemos autorizado un nuevo crédito donde la garantía va al Cliente ${cliente}, por favor encuentren adjunta la factura del seguro.</p>`,
		vehiculo ? `<p>Vehículo: ${escapar(vehiculo)}</p>` : "",
		`<p>TIPO: ${escapar(d.tipoVehiculo ?? "—")}</p>`,
		`<p>Monto por el que se asegura ${quetzales(d.montoAsegurado)}<br>Cuota Mensual ${quetzales(d.cuotaMensual)}</p>`,
		"<p>Tomar en cuenta que ahora se realizará endoso a Cube Investments, S.A.</p>",
		"<p>Quedamos a la orden por cualquier consulta.</p>",
		"<p>Saludos cordiales,<br>Club Cash In</p>",
	];

	return {
		asunto: `Nuevo crédito autorizado: ${d.cliente} (${d.referencia})`,
		html: lineas.filter(Boolean).join("\n"),
	};
}

/**
 * Qué significa un envío que no confirmó:
 * - `rechazado`: no salió (Resend respondió 4xx, o falló antes de llamarlo).
 *   Un reenvío puede usar otro intento.
 * - `incierto`: pudo haber salido (red caída, 5xx, llave usada con otro
 *   contenido). Se conserva el intento: reintentarlo con la misma llave no
 *   duplica si Resend ya lo aceptó, mientras la llave siga vigente (24 h).
 * - `en_curso`: la misma llave se está procesando en Resend.
 */
export type ResultadoEnvio =
	| { ok: true }
	| {
			ok: false;
			error: string;
			resultado: "rechazado" | "incierto" | "en_curso";
	  };

export function clasificarErrorResend(
	error: unknown,
): "rechazado" | "incierto" | "en_curso" {
	const e = (error && typeof error === "object" ? error : {}) as {
		statusCode?: unknown;
		name?: unknown;
	};
	if (e.name === "concurrent_idempotent_requests") return "en_curso";
	const codigo = typeof e.statusCode === "number" ? e.statusCode : null;
	// 409 incluye invalid_idempotent_request: la llave ya se usó y ese correo
	// pudo haber salido.
	if (codigo !== null && codigo >= 400 && codigo < 500 && codigo !== 409) {
		return "rechazado";
	}
	return "incierto";
}

function mensaje(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (error && typeof error === "object") return JSON.stringify(error);
	return String(error ?? "Error de envío");
}

/**
 * No lanza: el resultado queda registrado en insurance_invoice_submissions.
 * `correo` es el guardado para este intento: con la misma `idempotencyKey`
 * Resend no reenvía un correo ya aceptado, pero exige el mismo contenido.
 */
export async function enviarCorreoFacturaSeguro(params: {
	destinatarios: string[];
	correo: { asunto: string; html: string };
	archivo: { key: string; nombre: string };
	idempotencyKey: string;
}): Promise<ResultadoEnvio> {
	// Imports diferidos: el paquete de correo exige RESEND_API_KEY al
	// cargarse, y el router del tracker no debería depender de eso (ni de
	// los mocks parciales de storage de otros tests) para cargar.
	let contenido: Buffer;
	let sendPlainEmail: typeof import("@cci/email").sendPlainEmail;
	try {
		({ sendPlainEmail } = await import("@cci/email"));
		const { getFileBuffer } = await import("./storage");
		contenido = await getFileBuffer(params.archivo.key);
	} catch (error) {
		// Todavía no se llamó a Resend: no salió nada.
		return { ok: false, resultado: "rechazado", error: mensaje(error) };
	}

	try {
		const resultado = await sendPlainEmail(
			params.destinatarios,
			params.correo.asunto,
			params.correo.html,
			undefined,
			{
				attachments: [{ filename: params.archivo.nombre, content: contenido }],
				idempotencyKey: params.idempotencyKey,
			},
		);
		if (resultado.success) return { ok: true };
		return {
			ok: false,
			resultado: clasificarErrorResend(resultado.error),
			error: mensaje(resultado.error),
		};
	} catch (error) {
		// sendPlainEmail valida los destinatarios antes de llamar a Resend.
		const antesDeEnviar = error instanceof Error && error.name === "ZodError";
		return {
			ok: false,
			resultado: antesDeEnviar ? "rechazado" : "incierto",
			error: mensaje(error),
		};
	}
}
