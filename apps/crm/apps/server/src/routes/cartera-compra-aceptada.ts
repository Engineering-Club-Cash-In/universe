import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { investorContractBatches } from "../db/schema/investor-contracts";
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
		})
		.onConflictDoNothing({
			target: [
				investorContractBatches.investorId,
				investorContractBatches.purchaseKey,
			],
		})
		.returning({ id: investorContractBatches.id });

	// Sin fila devuelta, el aviso ya había entrado: se contesta con la batería
	// que ya existe y no se vuelve a notificar. Un reintento no puede hacerle
	// sonar la campana a jurídico dos veces por el mismo trabajo.
	if (!creada) {
		const [existente] = await db
			.select({ id: investorContractBatches.id })
			.from(investorContractBatches)
			.where(
				and(
					eq(investorContractBatches.investorId, inversionista.id),
					eq(investorContractBatches.purchaseKey, purchaseKey),
				),
			)
			.limit(1);

		console.log(
			`[cartera-compra-aceptada] batería repetida para ${inversionista.nombre} (${purchaseKey})`,
		);
		return c.json({ success: true, batchId: existente?.id, repetida: true });
	}

	const autor = await autorDeLaNotificacion();
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
		});
	} else {
		console.warn(
			"[cartera-compra-aceptada] no hay usuario de jurídico ni admin: la batería queda sin notificación",
		);
	}

	console.log(
		`[cartera-compra-aceptada] batería ${creada.id} para ${inversionista.nombre} (${compra.creditos.length} crédito(s))`,
	);

	return c.json({ success: true, batchId: creada.id, repetida: false });
});

export default app;
