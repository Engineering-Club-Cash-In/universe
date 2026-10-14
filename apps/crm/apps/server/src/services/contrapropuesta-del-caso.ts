/**
 * M4 · La contrapropuesta que espera respuesta, vista desde el CASO.
 *
 * La Ficha 360 y el Workspace no conocen el id del convenio pendiente: conocen
 * el caso. Esta lectura busca la contrapropuesta `pendiente` del crédito del
 * caso y la devuelve con el plan original (el que armó el asesor) y el
 * propuesto (el del supervisor), para que el asesor la compare y responda con
 * `responderContrapropuesta`. Sin pendiente devuelve `null`.
 *
 * El acceso lo decide el router (`assertAccesoCasoCobro`, el mismo gate de la
 * ficha). Aquí solo se calcula qué puede hacer quien mira:
 *  · aceptar: solo el asesor que lleva el crédito AHORA (por correo, igual que
 *    `puedeResponderContrapropuesta`);
 *  · descartar: ese asesor o un supervisor (para el supervisor es «retirar»).
 * Las dos reglas las vuelve a aplicar `responderContrapropuesta` bajo el
 * candado del convenio; aquí son para no ofrecer un botón que va a fallar.
 */

import { and, desc, eq, or } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth";
import {
	casosCobros,
	contrapropuestasConvenioCobros,
} from "../db/schema/cobros";
import { puedeResponderContrapropuesta } from "../lib/contrapropuesta-convenio";
import { carteraBackClient } from "./cartera-back-client";

export type PlanContrapropuesta = {
	numeroMeses: number;
	cuotaMensual: number;
	/** `YYYY-MM-DD`; el original puede no tenerlo (convenios viejos). */
	primerPago: string | null;
};

export type ContrapropuestaPendienteDelCaso = {
	id: string;
	convenioId: number;
	numeroCreditoSifco: string;
	/** El total del convenio: la contrapropuesta no lo cambia. */
	montoTotal: number;
	/** Lo que propuso el asesor. */
	original: PlanContrapropuesta;
	/** Lo que propone el supervisor. */
	propuesta: PlanContrapropuesta & { primerPago: string };
	/** La nota del supervisor (por qué propone otro plan). */
	nota: string;
	creadaEn: Date;
	/** Nombre del supervisor que la hizo (null si ya no existe el usuario). */
	creadaPor: string | null;
	/**
	 * ¿Quien mira es el asesor que lleva el crédito? `null` si cartera no
	 * respondió: la UI ofrece las acciones y decide el servidor al responder.
	 */
	puedeAceptar: boolean | null;
	/** Ese asesor o un supervisor (para el supervisor es «retirar»). */
	puedeDescartar: boolean | null;
	/** Quien mira es supervisor o admin de cobros: su acción es «retirar». */
	esSupervisor: boolean;
};

export async function contrapropuestaPendienteDelCaso(params: {
	casoCobroId: string;
	emailSesion: string | null | undefined;
	esSupervisor: boolean;
}): Promise<ContrapropuestaPendienteDelCaso | null> {
	const [caso] = await db
		.select({ numeroCreditoSifco: casosCobros.numeroCreditoSifco })
		.from(casosCobros)
		.where(eq(casosCobros.id, params.casoCobroId))
		.limit(1);
	if (!caso) return null;

	// La contrapropuesta guarda el caso VIGENTE al crearse; un SIFCO puede
	// tener casos viejos inactivos. El convenio es del crédito, así que se
	// busca por SIFCO (un SIFCO es un solo crédito) además de por caso.
	const sifco = caso.numeroCreditoSifco?.trim() || null;
	const delCaso = sifco
		? or(
				eq(contrapropuestasConvenioCobros.casoCobroId, params.casoCobroId),
				eq(contrapropuestasConvenioCobros.numeroCreditoSifco, sifco),
			)
		: eq(contrapropuestasConvenioCobros.casoCobroId, params.casoCobroId);

	const [fila] = await db
		.select({
			c: contrapropuestasConvenioCobros,
			creadaPor: user.name,
		})
		.from(contrapropuestasConvenioCobros)
		.leftJoin(user, eq(user.id, contrapropuestasConvenioCobros.creadaPor))
		.where(and(delCaso, eq(contrapropuestasConvenioCobros.estado, "pendiente")))
		.orderBy(desc(contrapropuestasConvenioCobros.creadaEn))
		.limit(1);
	if (!fila) return null;
	const c = fila.c;

	// Quién lleva el crédito AHORA (por correo, como `responderContrapropuesta`).
	// Con caché: la respuesta la vuelve a validar el servidor bajo el candado.
	let emailAsesor: string | null | undefined;
	try {
		const credito = await carteraBackClient.getCredito(
			c.numeroCreditoSifco,
			true,
			false,
		);
		emailAsesor = credito?.asesor?.emailCashIn ?? null;
	} catch (error) {
		console.warn(
			"[contrapropuesta-del-caso] No se pudo leer el asesor del crédito:",
			error instanceof Error ? error.message : error,
		);
		emailAsesor = undefined;
	}
	const conocido = emailAsesor !== undefined;
	const puede = (accion: "aceptar" | "descartar") =>
		puedeResponderContrapropuesta({
			accion,
			esSupervisor: params.esSupervisor,
			emailSesion: params.emailSesion,
			emailAsesorDelCredito: emailAsesor ?? null,
		});

	return {
		id: c.id,
		convenioId: c.convenioId,
		numeroCreditoSifco: c.numeroCreditoSifco,
		montoTotal: Number(c.montoTotal),
		original: {
			numeroMeses: c.numeroMesesOriginal,
			cuotaMensual: Number(c.cuotaMensualOriginal),
			primerPago: c.primerPagoOriginal,
		},
		propuesta: {
			numeroMeses: c.numeroMeses,
			cuotaMensual: Number(c.cuotaMensual),
			primerPago: c.primerPago,
		},
		nota: c.nota,
		creadaEn: c.creadaEn,
		creadaPor: fila.creadaPor ?? null,
		// Sin el asesor de cartera solo se sabe lo del rol: el supervisor puede
		// retirarla; lo demás queda en null y lo decide el servidor al responder.
		puedeAceptar: conocido ? puede("aceptar") : null,
		puedeDescartar: conocido
			? puede("descartar")
			: params.esSupervisor
				? true
				: null,
		esSupervisor: params.esSupervisor,
	};
}
