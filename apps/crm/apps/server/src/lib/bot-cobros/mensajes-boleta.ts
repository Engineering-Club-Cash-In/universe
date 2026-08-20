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
	/** true = hay mora pero no se sabe cuánta; no se promete nada de la cuota. */
	moraPorConfirmar: boolean;
	/** Lo que le llega a la cuota después de la mora. `null` si no se sabe. */
	paraCuota: string | null;
	/** Si la boleta ni alcanza para la mora, a la cuota no le llega nada. */
	cubreMora: boolean;
	cubreCuota: boolean;
	camposFaltantes: string[];
};

/**
 * La línea final sobre la cuota: si queda cubierta, o cuánto falta después.
 *
 * El faltante se calcula **después** de aplicar este pago. Mostrar el saldo
 * previo —"faltan Q6,000"— justo cuando el cliente acaba de abonar Q3,000 se
 * lee como que su pago no sirvió de nada.
 */
function cierreDeCuota(datos: DatosMensajeBoleta): string[] {
	if (datos.cubreCuota) return ["   ✅ Cubre la cuota completa"];

	if (!datos.saldoCuota || !datos.paraCuota) return [];

	const falta = Math.max(0, Number(datos.saldoCuota) - Number(datos.paraCuota));

	return [`   Después de este pago te faltarán: ${quetzales(falta)}`];
}

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

	// ── A dónde va el dinero ──────────────────────────────────────────────────
	// Son TRES casos que se excluyen entre sí, y por eso van en un solo `if`.
	// Cuando el orden y el detalle se decidían en dos bloques separados, una
	// mora sin monto confirmado —`mora` en null pero `moraPorConfirmar` en
	// true— caía en el "no tiene mora" del primero y contradecía al segundo:
	// le decía al cliente que su pago va a la cuota y, dos líneas después, que
	// primero se cubre la mora.
	if (datos.cuotaNumero && datos.cuotaDe) {
		const aLaCuota = `A tu cuota ${datos.cuotaNumero} de ${datos.cuotaDe}`;

		detalle.push("", "📄 *Cómo se va a aplicar*");

		if (datos.moraPorConfirmar) {
			// Hay mora, pero cartera no puede decir cuánta ahora mismo: se dice el
			// orden, que sí lo sabemos, y nada sobre si la cuota queda cubierta.
			detalle.push("   1. A tu mora pendiente");
			detalle.push(`   2. ${aLaCuota}`);
			detalle.push("   Tu asesor te confirma el monto exacto de tu mora.");
		} else if (datos.mora) {
			detalle.push(`   1. A tu mora de ${quetzales(datos.mora)}`);
			detalle.push(`   2. ${aLaCuota}`);

			// Si ni siquiera alcanza para la mora, hablar de la cuota sería
			// engañoso: a la cuota no le llega nada.
			if (!datos.cubreMora) {
				detalle.push("   Este pago se aplica todo a tu mora.");
			} else {
				detalle.push(...cierreDeCuota(datos));
			}
		} else {
			detalle.push(`   ${aLaCuota}`);
			detalle.push(...cierreDeCuota(datos));
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

/**
 * "Ya está acreditado."
 *
 * Es el mensaje que justifica todo el circuito de vuelta: un pago validado del
 * que el cliente nunca se entera es peor que no tener circuito.
 */
export function mensajesPagoValidado(datos: {
	monto: string;
	cuotas: number[];
}): MensajesBoleta {
	const titulo = `✅ *Pago acreditado · ${quetzales(datos.monto)}*`;

	const cuerpo = [titulo, ""];

	if (datos.cuotas.length === 1) {
		cuerpo.push(`Tu pago ya se aplicó a tu cuota ${datos.cuotas[0]}.`);
	} else if (datos.cuotas.length > 1) {
		const lista = datos.cuotas.join(", ");
		cuerpo.push(`Tu pago ya se aplicó a tus cuotas ${lista}.`);
	} else {
		cuerpo.push("Tu pago ya quedó aplicado a tu crédito.");
	}

	cuerpo.push("", "¡Gracias por tu pago! 🙌");

	return {
		titulo,
		resumen: [titulo, "", "Tu pago ya quedó aplicado."].join("\n"),
		completo: cuerpo.join("\n"),
	};
}

/**
 * "No pudimos acreditarlo."
 *
 * **Sin detalle técnico y sin culpar al cliente.** Puede ser una boleta que no
 * cuadró, un depósito que no llegó, o un error nuestro: el cliente no puede
 * hacer nada con esa distinción, y arriesgarse a decirle "tu boleta era falsa"
 * cuando fue un problema de conciliación es un daño que no se repara. La salida
 * es siempre la misma: su asesor.
 */
export function mensajesPagoRechazado(monto: string): MensajesBoleta {
	const titulo = `⚠️ *No pudimos acreditar tu pago de ${quetzales(monto)}*`;

	const cuerpo = [
		titulo,
		"",
		"Tu pago necesita una revisión antes de aplicarse a tu crédito.",
		"",
		"📞 Tu asesor se va a comunicar con vos para resolverlo.",
	];

	return {
		titulo,
		resumen: [titulo, "", "Tu asesor te va a contactar."].join("\n"),
		completo: cuerpo.join("\n"),
	};
}

/**
 * "Lo estamos revisando otra vez."
 *
 * Solo se manda si al cliente YA se le había dicho que estaba acreditado.
 * Callarse ahí lo dejaría creyendo algo que dejó de ser cierto; si nunca se le
 * dijo nada, para él no cambió nada y no hay por qué preocuparlo.
 */
export function mensajesPagoEnRevision(monto: string): MensajesBoleta {
	const titulo = `🔎 *Estamos revisando de nuevo tu pago de ${quetzales(monto)}*`;

	const cuerpo = [
		titulo,
		"",
		"Tu pago volvió a revisión de nuestro equipo de contabilidad.",
		"",
		"📲 Te avisamos por este mismo medio en cuanto quede resuelto.",
	];

	return {
		titulo,
		resumen: [titulo, "", "Te avisamos cuando quede resuelto."].join("\n"),
		completo: cuerpo.join("\n"),
	};
}
