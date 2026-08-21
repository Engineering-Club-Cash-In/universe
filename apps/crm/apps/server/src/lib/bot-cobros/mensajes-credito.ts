/**
 * Los mensajes ya armados que el bot le muestra al cliente.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EL TEXTO SE ARMA ACÁ Y NO EN SIMPLETECH
 *
 * Lo pidió el integrador: armar el párrafo del lado del bot obliga a iterar el
 * JSON y concatenar variables en una herramienta que no tiene un lenguaje
 * decente para eso. Devolverlo hecho le quita ese trabajo.
 *
 * Y nos conviene: si Cobros o marketing quieren cambiar el texto, se cambia
 * acá y se despliega, sin depender de que el integrador toque su flujo.
 *
 * **Los campos estructurados NO desaparecen.** Estos mensajes son un extra: el
 * bot sigue recibiendo `cuotasAtrasadas`, `mora`, etc. para lo que necesite
 * ramificar.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ EL TEXTO ES BORRADOR. Lo escribió IT para desbloquear la integración;
 * **marketing tiene que corregirlo** antes de que esto le hable a un cliente
 * real. Cambiar los textos de acá no requiere tocar nada más.
 *
 * Formato: WhatsApp usa `*negrita*` con UN asterisco, no dos.
 */

import type { InfoCreditoBot } from "./menu-credito";

/** Los tres formatos, para que el bot use el que le sirva en cada pantalla. */
export type MensajesCredito = {
	/** Una línea. Para encabezar una lista o un menú. */
	titulo: string;
	/** Lo mínimo accionable: qué debe y para cuándo. */
	resumen: string;
	/** Todo lo que sabemos del crédito, listo para pegar en el chat. */
	completo: string;
};

const MESES = [
	"enero",
	"febrero",
	"marzo",
	"abril",
	"mayo",
	"junio",
	"julio",
	"agosto",
	"septiembre",
	"octubre",
	"noviembre",
	"diciembre",
];

/**
 * `2026-08-30` → `30 de agosto de 2026`.
 *
 * Se parte el string a mano en vez de usar `new Date(...)`: la fecha viene como
 * día calendario y construir un Date la interpreta en UTC, así que en Guatemala
 * (UTC-6) mostraría el día anterior.
 */
export function fechaLegible(fecha: string): string {
	const [anio, mes, dia] = fecha.split("-").map(Number);

	if (!anio || !mes || !dia) return fecha;

	return `${dia} de ${MESES[mes - 1]} de ${anio}`;
}

/** `2464.63` → `Q2,464.63`. Los montos llegan como string decimal. */
export function quetzales(monto: string | number): string {
	const numero = Number(monto);

	if (!Number.isFinite(numero)) return `Q${monto}`;

	const [entero, decimales] = numero.toFixed(2).split(".");
	const conSeparador = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

	return `Q${conSeparador}.${decimales}`;
}

/** "3 cuotas atrasadas" / "1 cuota atrasada" — sin el "1 cuotas" de siempre. */
function pluralCuotas(cantidad: number): string {
	return cantidad === 1 ? "1 cuota" : `${cantidad} cuotas`;
}

export function armarMensajes(info: InfoCreditoBot): MensajesCredito {
	const atrasado = info.cuotasAtrasadas > 0;

	// El vehículo es lo que el cliente reconoce como "su crédito"; si no lo hay,
	// `etiqueta` ya trae el nombre del titular como alternativa (paso 1).
	const titulo = `*${info.etiqueta}*`;

	// ── Resumen ────────────────────────────────────────────────────────────────
	const lineasResumen = [titulo];

	if (info.cuotaActual) {
		lineasResumen.push(
			`Cuota ${info.cuotaActual.numero} de ${info.cuotaActual.de} · ${quetzales(info.cuotaMensual)}`,
		);
	}

	if (atrasado) {
		lineasResumen.push(
			`Tenés ${pluralCuotas(info.cuotasAtrasadas)} atrasada${info.cuotasAtrasadas === 1 ? "" : "s"}`,
		);
	}

	if (info.mora) {
		lineasResumen.push(`Mora: ${quetzales(info.mora.monto)}`);
	}

	if (info.proximaFechaPago) {
		lineasResumen.push(
			`Próximo pago: ${fechaLegible(info.proximaFechaPago)}`,
		);
	} else if (info.cuotaActual?.vencida) {
		// Todas las cuotas vencidas y ninguna futura: no hay próxima fecha que
		// ofrecer, pero callarlo dejaría el mensaje sin cierre.
		lineasResumen.push(
			`Tu cuota venció el ${fechaLegible(info.cuotaActual.fechaVencimiento)}`,
		);
	}

	// ── Completo ───────────────────────────────────────────────────────────────
	const lineas = [titulo, ""];

	lineas.push(`Monto del crédito: ${quetzales(info.capitalActivo)}`);
	lineas.push(`Cuota mensual: ${quetzales(info.cuotaMensual)}`);

	if (info.cuotaActual) {
		lineas.push(
			`Vas en la cuota ${info.cuotaActual.numero} de ${info.cuotaActual.de}`,
		);
	}

	if (atrasado) {
		lineas.push(
			`Tenés *${pluralCuotas(info.cuotasAtrasadas)} atrasada${info.cuotasAtrasadas === 1 ? "" : "s"}*`,
		);
	} else {
		lineas.push("Estás al día con tus cuotas");
	}

	if (info.mora) {
		lineas.push(`Monto en mora: *${quetzales(info.mora.monto)}*`);
	} else if (info.moraPorConfirmar) {
		// La foto de la mora quedó vieja: antes que decir un monto equivocado, se
		// lo manda con su asesor.
		lineas.push(
			"Tenés un cargo por mora pendiente de confirmar; tu asesor te lo puede detallar",
		);
	}

	if (info.proximaFechaPago) {
		lineas.push(
			`Próxima fecha de pago: ${fechaLegible(info.proximaFechaPago)}`,
		);
	} else if (info.cuotaActual?.vencida) {
		lineas.push(
			`Tu cuota venció el ${fechaLegible(info.cuotaActual.fechaVencimiento)}`,
		);
	}

	if (info.convenio) {
		lineas.push("");
		lineas.push("*Tu convenio de pago*");
		lineas.push(
			`   Cuota del convenio: ${quetzales(info.convenio.cuotaMensual)}`,
		);
		lineas.push(
			`   Llevás ${info.convenio.pagosRealizados} de ${info.convenio.numeroMeses} pagos`,
		);
		lineas.push(`   Te falta: ${quetzales(info.convenio.montoPendiente)}`);
	}

	if (info.vehiculo) {
		lineas.push("");
		lineas.push(
			`Vehículo: ${info.vehiculo.marca} ${info.vehiculo.modelo} ${info.vehiculo.anio}`.replace(
				/\s+/g,
				" ",
			),
		);

		if (info.vehiculo.placa) {
			lineas.push(`   Placa: ${info.vehiculo.placa}`);
		}
	}

	if (info.asesor) {
		lineas.push("");
		lineas.push(`Tu asesor: ${info.asesor.nombre}`);

		if (info.asesor.telefono) {
			lineas.push(`   Tel. ${info.asesor.telefono}`);
		}
	}

	return {
		titulo,
		resumen: lineasResumen.join("\n"),
		completo: lineas.join("\n"),
	};
}
