import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { investorContractBatches } from "../db/schema/investor-contracts";
import { notifications } from "../db/schema/notifications";
import { createNotification } from "../lib/notificaciones";
import { ROLES } from "../lib/roles";

/**
 * Recibe de cartera el aviso de que una compra de cartera fue aceptada, y abre
 * la batería de contratos que le queda pendiente a jurídico.
 *
 * Hasta ahora aceptar la compra sólo mandaba un correo: jurídico se enteraba
 * leyendo el hilo, y no había forma de saber cuáles quedaban sin hacer.
 *
 * Se autentica con un secreto compartido, igual que el relay de WeeTrust: es
 * una llamada máquina a máquina y no tiene sentido hacerla iniciar sesión.
 */
const app = new Hono();

const creditoSchema = z.object({
	creditoId: z.number().int().positive(),
	numeroCreditoSifco: z.string().min(1),
	clienteNombre: z.string().min(1),
	monto: z.string().min(1),
	fechaInicio: z.string().nullish(),
	fechaVencimiento: z.string().nullish(),
	tipoReinversion: z.string().nullish(),
	modalidadFacturacion: z.string().nullish(),
});

const cuerpoSchema = z.object({
	inversionista: z.object({
		id: z.number().int().positive(),
		nombre: z.string().min(1),
		dpi: z.string().nullish(),
		dpiRepLegal: z.string().nullish(),
		email: z.string().nullish(),
		celular: z.string().nullish(),
	}),
	compra: z.object({
		creditos: z.array(creditoSchema).min(1),
		montoTotal: z.string().min(1),
		modalidad: z.string().nullish(),
		facturacion: z.string().nullish(),
		aceptadaEn: z.string().min(1),
		aceptadaPor: z.string().nullish(),
		/** El id de Resend del correo de aceptación: el hilo de la compra. */
		correoId: z.string().nullish(),
	}),
});

/**
 * Quién queda como autor de la notificación.
 *
 * La manda cartera, que no es un usuario del CRM, pero la columna es una FK a
 * `user`. Se usa a alguien de jurídico —que es a quien le toca el trabajo— y si
 * no hay ninguno, un admin. Sin candidato no se crea la notificación, pero la
 * batería igual queda guardada: perder el aviso es molesto, perder el trabajo
 * pendiente es peor.
 */
async function autorDeLaNotificacion() {
	for (const role of [ROLES.JURIDICO, ROLES.ADMIN] as const) {
		const [candidato] = await db
			.select({ id: user.id, role: user.role })
			.from(user)
			.where(eq(user.role, role))
			.limit(1);
		if (candidato) return candidato;
	}
	return undefined;
}

app.post("/", async (c) => {
	const esperado = process.env.CARTERA_RELAY_SECRET;

	if (!esperado) {
		console.error(
			"[cartera-compra-aceptada] CARTERA_RELAY_SECRET no configurado",
		);
		return c.json({ success: false, error: "No configurado" }, 500);
	}

	if (c.req.header("x-cartera-relay-secret") !== esperado) {
		console.warn("[cartera-compra-aceptada] Secreto inválido");
		return c.json({ success: false, error: "No autorizado" }, 401);
	}

	let cuerpo: z.infer<typeof cuerpoSchema>;
	try {
		cuerpo = cuerpoSchema.parse(await c.req.json());
	} catch (error) {
		console.warn("[cartera-compra-aceptada] Body inválido:", error);
		return c.json({ success: false, error: "Body inválido" }, 400);
	}

	const { inversionista, compra } = cuerpo;

	// La llave de la compra: los créditos aceptados, ordenados. Cartera reintenta
	// el aviso si el CRM no contesta, y dos avisos de la misma compra tienen que
	// terminar en una sola batería.
	const purchaseKey = [...compra.creditos]
		.map((credito) => credito.creditoId)
		.sort((a, b) => a - b)
		.join("-");

	const aceptadaEn = new Date(compra.aceptadaEn);
	if (Number.isNaN(aceptadaEn.getTime())) {
		return c.json({ success: false, error: "aceptadaEn inválida" }, 400);
	}

	const [creada] = await db
		.insert(investorContractBatches)
		.values({
			investorId: inversionista.id,
			investorName: inversionista.nombre,
			investorDpi: inversionista.dpi ?? null,
			investorDpiRepLegal: inversionista.dpiRepLegal ?? null,
			investorEmail: inversionista.email ?? null,
			investorPhone: inversionista.celular ?? null,
			purchaseKey,
			creditos: compra.creditos,
			montoTotal: compra.montoTotal,
			modalidad: compra.modalidad ?? null,
			facturacion: compra.facturacion ?? null,
			acceptedAt: aceptadaEn,
			acceptedByEmail: compra.aceptadaPor ?? null,
			emailThreadId: compra.correoId ?? null,
		})
		.onConflictDoNothing({
			target: [
				investorContractBatches.investorId,
				investorContractBatches.purchaseKey,
			],
		})
		.returning({ id: investorContractBatches.id });

	// Sin fila devuelta, ya había una batería para este inversionista y este
	// juego de créditos. Son dos cosas muy distintas y se distinguen por la
	// fecha de aceptación:
	//
	// - **el mismo aviso otra vez** (cartera lo reintenta si el CRM no
	//   contestó): se refresca la foto mientras la batería siga abierta —en el
	//   medio pudieron completar un dato que faltaba— y NO se vuelve a
	//   notificar. Un reintento no puede hacerle sonar la campana a jurídico dos
	//   veces por el mismo trabajo. Una batería ya cerrada no se toca: sus
	//   contratos salieron con lo que había.
	//
	// - **otra compra sobre los mismos créditos**, con fecha posterior: en un
	//   pool pasa cuando el inversionista le mete más capital a lo mismo. Eso es
	//   trabajo nuevo: la batería vuelve a la lista de jurídico con la foto
	//   nueva y se avisa otra vez.
	let batchId = creada?.id;
	let avisar = Boolean(creada);

	if (!creada) {
		const [existente] = await db
			.select({
				id: investorContractBatches.id,
				status: investorContractBatches.status,
				acceptedAt: investorContractBatches.acceptedAt,
				emailThreadId: investorContractBatches.emailThreadId,
			})
			.from(investorContractBatches)
			.where(
				and(
					eq(investorContractBatches.investorId, inversionista.id),
					eq(investorContractBatches.purchaseKey, purchaseKey),
				),
			)
			.limit(1);

		if (!existente) {
			// La fila desapareció entre el insert y esta consulta: alguien la
			// borró a mano. Que cartera lo reintente.
			return c.json(
				{ success: false, error: "La batería ya no existe. Reintentar." },
				409,
			);
		}

		batchId = existente.id;
		const otraCompra = aceptadaEn.getTime() > existente.acceptedAt.getTime();
		const abierta =
			existente.status === "pendiente" || existente.status === "en_proceso";

		if (otraCompra || abierta) {
			// La batería vuelve a ser trabajo sólo si esto es otra compra: si es
			// el mismo aviso, la que estaba abierta sigue abierta y la cerrada
			// sigue cerrada.
			await db
				.update(investorContractBatches)
				.set({
					investorName: inversionista.nombre,
					investorDpi: inversionista.dpi ?? null,
					investorDpiRepLegal: inversionista.dpiRepLegal ?? null,
					investorEmail: inversionista.email ?? null,
					investorPhone: inversionista.celular ?? null,
					creditos: compra.creditos,
					montoTotal: compra.montoTotal,
					modalidad: compra.modalidad ?? null,
					facturacion: compra.facturacion ?? null,
					updatedAt: new Date(),
					...(otraCompra
						? {
								acceptedAt: aceptadaEn,
								acceptedByEmail: compra.aceptadaPor ?? null,
								// Otra compra es otro correo: los contratos de ésta se
								// contestan en su hilo, no en el de la anterior. Y vuelve a
								// ser trabajo de jurídico hasta que le dé "Listo".
								emailThreadId: compra.correoId ?? null,
								status: "pendiente",
								startedAt: null,
								startedBy: null,
								completedAt: null,
								completedBy: null,
							}
						: // El mismo aviso repetido no cambia de hilo; sólo lo completa si
							// la primera vez llegó sin él.
							!existente.emailThreadId && compra.correoId
							? { emailThreadId: compra.correoId }
							: {}),
				})
				.where(eq(investorContractBatches.id, existente.id));
		}

		avisar = otraCompra;
		console.log(
			`[cartera-compra-aceptada] ${otraCompra ? "otra compra sobre los mismos créditos" : "aviso repetido"} para ${inversionista.nombre} (${purchaseKey})`,
		);

		if (!otraCompra) {
			// Un reintento de cartera puede venir justo de la vez en que la batería
			// se guardó pero el aviso a jurídico no llegó a crearse (se cayó el
			// proceso, falló la notificación). Si sigue abierta y no tiene aviso,
			// se crea ahora; si no, jurídico tenía una batería que nadie le dijo.
			const [yaAvisada] = abierta
				? await db
						.select({ id: notifications.id })
						.from(notifications)
						.where(
							and(
								eq(notifications.relatedEntityId, existente.id),
								eq(notifications.redirectPage, "investor_contracts"),
							),
						)
						.limit(1)
				: [];
			if (!abierta || yaAvisada) {
				return c.json({ success: true, batchId, repetida: true });
			}
			avisar = true;
		}
	}

	const autor = avisar ? await autorDeLaNotificacion() : undefined;
	if (autor) {
		await createNotification({
			titulo: `Contratos pendientes: ${inversionista.nombre}`,
			descripcion:
				`Se aceptó la compra de cartera por Q${compra.montoTotal} ` +
				`(${compra.creditos.length} crédito(s)). Falta emitir sus contratos.`,
			type: "action_required",
			createdBy: autor.id,
			createdByRole: autor.role,
			assignedToRole: ROLES.JURIDICO,
			redirectPage: "investor_contracts",
			// Con esto la notificación trae el botón que lleva directo a la
			// batería; sin `relatedEntityId` la pantalla no arma el enlace y el
			// aviso queda siendo sólo un texto.
			//
			// El enum de entidades no tiene una para la batería. Se usa la más
			// cercana: lo que queda pendiente son contratos. Nadie filtra por ella
			// fuera de contabilidad, que mira las de oportunidades.
			relatedEntityType: "contract",
			relatedEntityId: batchId as string,
		});
	} else {
		console.warn(
			"[cartera-compra-aceptada] no hay usuario de jurídico ni admin: la batería queda sin notificación",
		);
	}

	console.log(
		`[cartera-compra-aceptada] batería ${batchId} para ${inversionista.nombre} (${compra.creditos.length} crédito(s))`,
	);

	return c.json({ success: true, batchId, repetida: !creada });
});

export default app;
