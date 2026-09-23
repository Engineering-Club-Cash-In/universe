import { Hono } from "hono";
import {
	contratoPorDocumentID,
	sincronizarEstadoDeFirma,
} from "../lib/contrato-estado-firma";
import type { EstadoDocumentoFirma } from "../services/legal-docs-api";

/**
 * Recibe del generador el estado de firma que WeeTrust le avisó por webhook.
 *
 * El webhook de WeeTrust le pega al generador (es el que tiene las credenciales
 * y la URL pública), pero la base es de acá, así que el generador nos relaya lo
 * que aprendió. Sin esto el estado sólo se movía cuando alguien apretaba
 * "Actualizar estado" a mano.
 *
 * Se autentica con un secreto compartido en vez de la cuenta de servicio: es
 * una llamada máquina a máquina que puede llegar en cualquier momento, y no
 * tiene sentido hacerla iniciar sesión para escribir un estado.
 */
const app = new Hono();

app.post("/", async (c) => {
	const esperado = process.env.WEETRUST_RELAY_SECRET;

	if (!esperado) {
		console.error("[weetrust-status] WEETRUST_RELAY_SECRET no configurado");
		return c.json({ success: false, error: "No configurado" }, 500);
	}

	if (c.req.header("x-weetrust-relay-secret") !== esperado) {
		console.warn("[weetrust-status] Secreto inválido");
		return c.json({ success: false, error: "No autorizado" }, 401);
	}

	let estado: EstadoDocumentoFirma;
	try {
		estado = await c.req.json();
	} catch {
		return c.json({ success: false, error: "Body inválido" }, 400);
	}

	if (!estado?.documentID || !Array.isArray(estado.signatories)) {
		return c.json(
			{ success: false, error: "Falta documentID o signatories" },
			400,
		);
	}

	const contrato = await contratoPorDocumentID(estado.documentID);

	// Un documento que no conocemos no es un error nuestro: puede ser de otra
	// integración sobre la misma cuenta de WeeTrust. Se responde 200 para que
	// WeeTrust no lo reintente para siempre.
	if (!contrato) {
		console.warn(
			`[weetrust-status] documento ${estado.documentID} sin contrato en el CRM`,
		);
		return c.json({ success: true, message: "Documento no registrado" });
	}

	await sincronizarEstadoDeFirma(contrato.id, estado);

	const firmados = estado.signatories.filter((s) => s.isSigned).length;
	console.log(
		`[weetrust-status] ${contrato.contractType}: ${firmados}/${estado.signatories.length} firmaron (${estado.status})`,
	);

	return c.json({
		success: true,
		contractId: contrato.id,
		status: estado.status,
		firmados,
	});
});

export default app;
