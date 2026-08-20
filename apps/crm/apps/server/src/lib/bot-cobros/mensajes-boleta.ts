/**
 * Los mensajes de la boleta, ya escritos para el chat.
 *
 * Mismo criterio que `mensajes-credito.ts`: el bot no arma párrafos, los pega.
 * Y misma advertencia — **el texto es borrador de IT**; marketing lo corrige
 * tocando solo este archivo.
 *
 * La negrita de WhatsApp es UN asterisco. Con dos se ven los asteriscos.
 */

import { fechaLegible, quetzales } from "./mensajes-credito";

export type MensajesBoleta = {
	titulo: string;
	resumen: string;
	completo: string;
};

export type DatosMensajeBoleta = {
	monto: string;
	banco: string | null;
	fechaBoleta: string;
	numeroAutorizacion: string | null;
	cuotaNumero: number | null;
	cuotaDe: number | null;
	saldoCuota: string | null;
	mora: string | null;
	cubreCuota: boolean;
	camposFaltantes: string[];
};

/**
 * "Esto entendimos de tu boleta, ¿está bien?"
 *
 * El cliente tiene que poder desmentirlo de un vistazo, así que los datos van
 * primero y el pedido de confirmación al final.
 */
export function armarMensajesBoleta(datos: DatosMensajeBoleta): MensajesBoleta {
	const monto = quetzales(datos.monto);

	const titulo = `🧾 *Boleta recibida · ${monto}*`;

	const lineas: string[] = [`💵 Monto: *${monto}*`];

	if (datos.banco) lineas.push(`🏦 Banco: ${datos.banco}`);
	lineas.push(`📅 Fecha: ${fechaLegible(datos.fechaBoleta)}`);
	if (datos.numeroAutorizacion) {
		lineas.push(`🔢 No. de autorización: ${datos.numeroAutorizacion}`);
	}

	const resumen = [titulo, "", ...lineas, "", "¿Está correcto?"].join("\n");

	const detalle: string[] = [titulo, "", ...lineas];

	if (datos.cuotaNumero && datos.cuotaDe) {
		detalle.push("", "📄 *Cómo se va a aplicar*");
		if (datos.mora) {
			detalle.push(`   1. A tu mora de ${quetzales(datos.mora)}`);
			detalle.push(`   2. A tu cuota ${datos.cuotaNumero} de ${datos.cuotaDe}`);
		} else {
			detalle.push(`   A tu cuota ${datos.cuotaNumero} de ${datos.cuotaDe}`);
		}

		if (datos.saldoCuota) {
			detalle.push(
				datos.cubreCuota
					? "   ✅ Cubre la cuota completa"
					: `   Falta de esa cuota: ${quetzales(datos.saldoCuota)}`,
			);
		}
	}

	// Se avisa una sola vez y sin tecnicismos: al cliente no le sirve saber que
	// el campo se llama `numeroAutorizacion`.
	if (datos.camposFaltantes.length > 0) {
		detalle.push(
			"",
			"⚠️ No pudimos leer todo de tu boleta. Revisá que los datos de arriba estén correctos.",
		);
	}

	detalle.push("", "¿Está correcto?");

	return { titulo, resumen, completo: detalle.join("\n") };
}

/** "Ya la recibimos, ahora la revisa contabilidad." */
export function mensajesPagoRegistrado(monto: string): MensajesBoleta {
	const titulo = `✅ *Pago recibido · ${quetzales(monto)}*`;

	const cuerpo = [
		titulo,
		"",
		"Ya registramos tu pago. Nuestro equipo de contabilidad tiene que validar los fondos.",
		"",
		"📲 Te avisamos por este mismo medio cuando quede acreditado.",
	];

	return {
		titulo,
		resumen: [
			titulo,
			"",
			"Está en validación. Te avisamos cuando se acredite.",
		].join("\n"),
		completo: cuerpo.join("\n"),
	};
}
