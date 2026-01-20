import "dotenv/config";
import { RPCHandler } from "@orpc/server/fetch";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import {
	getLeadProgress,
	getRenapInfoController,
	hasPassedLiveness,
	updateLeadAndCreateOpportunity,
	validateMagicUrlController,
} from "./controllers/bot";
import { infornetController } from "./controllers/buro";
import { processCsvLeads } from "./controllers/csv";
import { livenessController } from "./controllers/liveness";
import { otpController } from "./controllers/otp";
import {
	getLeadByEmail,
	getLeadLegalContracts,
	getLeadOpportunityDocuments,
	getSifcoNumbersByDpi,
	updateLeadByEmail,
	validatePortalToken,
} from "./controllers/portal-lead";
import { createPublicLead } from "./controllers/public-lead";
import type { db } from "./db";
import { otps } from "./db/schema/otp";
import { auth } from "./lib/auth";
import { createContext } from "./lib/context";
import { appRouter } from "./routers/index";
import externalContractsRouter from "./routes/external-contracts";

const app = new Hono();

app.use(logger());
app.use(
	"/*",
	cors({
		origin: (origin) => {
			// En desarrollo, permitir cualquier localhost
			if (
				origin?.startsWith("http://localhost:") ||
				origin?.startsWith("http://127.0.0.1:")
			) {
				return origin;
			}

			// Permitir subdominios de devteamatcci.site y servicioscashin.com (wildcard)
			if (
				origin?.match(
					/^https?:\/\/.*\.(devteamatcci\.site|servicioscashin\.com)$/,
				)
			) {
				return origin;
			}

			// En producción, usar el CORS_ORIGIN específico
			const productionOrigin = process.env.CORS_ORIGIN;
			if (productionOrigin && origin === productionOrigin) {
				return origin;
			}

			// Fallback para desarrollo sin origin (ej: Postman)
			return "http://localhost:3000";
		},
		allowMethods: ["GET", "POST", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization"],
		credentials: true,
	}),
);

app.on(["POST", "GET"], "/api/auth/**", (c) => auth.handler(c.req.raw));

// External contracts endpoint (requires service account authentication)
app.route("/api/contracts/external", externalContractsRouter);

const handler = new RPCHandler(appRouter);
app.use("/rpc/*", async (c, next) => {
	const context = await createContext({ context: c });
	const { matched, response } = await handler.handle(c.req.raw, {
		prefix: "/rpc",
		context: context,
	});

	if (matched) {
		return c.newResponse(response.body, response);
	}
	await next();
});

app.get("/", (c) => {
	return c.text("OK");
});

// Vehicle photo upload endpoint
app.post("/api/upload-vehicle-photo", async (c) => {
	try {
		// Get the context (optional for this endpoint)
		const context = await createContext({ context: c });

		// Public endpoint - no auth required
		// if (!context.session?.user?.id || !context.session?.user?.role) {
		// 	return c.json({ error: "No autorizado" }, 401);
		// }

		// Parse multipart form data
		const formData = await c.req.formData();
		const file = formData.get("file") as File;
		const vehicleId = formData.get("vehicleId") as string;
		const category = formData.get("category") as string;
		const photoType = formData.get("photoType") as string;
		const title = formData.get("title") as string;
		const description = formData.get("description") as string | null;
		const valuatorComment = formData.get("valuatorComment") as string | null;
		const noCommentsChecked = formData.get("noCommentsChecked") === "true";

		if (!file || !vehicleId || !category || !photoType || !title) {
			console.error("Missing required fields:", {
				hasFile: !!file,
				vehicleId,
				category,
				photoType,
				title,
			});
			return c.json({ error: "Faltan campos requeridos" }, 400);
		}

		// Import necessary modules
		const { validateFile, generateUniqueFilename, uploadVehiclePhotoToR2 } =
			await import("./lib/storage");

		// Validate file
		const validation = validateFile(file);
		if (!validation.valid) {
			console.error("File validation failed:", {
				fileName: file.name,
				fileType: file.type,
				fileSize: file.size,
				error: validation.error,
			});
			return c.json({ error: validation.error }, 400);
		}

		// Generate unique filename
		const uniqueFilename = generateUniqueFilename(file.name);

		// Upload to R2
		console.log("Uploading file:", {
			fileName: uniqueFilename,
			vehicleId,
			category,
			fileSize: file.size,
		});

		const { key, url } = await uploadVehiclePhotoToR2(
			file,
			uniqueFilename,
			vehicleId,
			category,
		);

		console.log("Upload successful:", { key, url });

		return c.json({
			success: true,
			data: {
				key,
				url,
				vehicleId,
				category,
				photoType,
				title,
				description,
				valuatorComment,
				noCommentsChecked,
			},
		});
	} catch (error) {
		console.error("Error uploading vehicle photo:", error);
		return c.json({ error: "Error al subir la foto" }, 500);
	}
});

// File upload endpoint
app.post("/api/upload-opportunity-document", async (c) => {
	try {
		// Get the context
		const context = await createContext({ context: c });

		if (!context.session?.user?.id || !context.session?.user?.role) {
			return c.json({ error: "No autorizado" }, 401);
		}

		const userId = context.session.user.id;
		const userRole = context.session.user.role;

		// Parse multipart form data
		const formData = await c.req.formData();
		const file = formData.get("file") as File;
		const opportunityId = formData.get("opportunityId") as string;
		const documentType = formData.get("documentType") as string;
		const description = formData.get("description") as string | null;

		if (!file || !opportunityId || !documentType) {
			return c.json({ error: "Faltan campos requeridos" }, 400);
		}

		// Import necessary modules
		const { db } = await import("./db");
		const { opportunities, opportunityDocuments } = await import("./db/schema");
		const { eq } = await import("drizzle-orm");
		const { validateFile, generateUniqueFilename, uploadFileToR2 } =
			await import("./lib/storage");

		// Verify access to opportunity
		const opportunity = await db
			.select()
			.from(opportunities)
			.where(eq(opportunities.id, opportunityId))
			.limit(1);

		if (!opportunity[0]) {
			return c.json({ error: "Oportunidad no encontrada" }, 404);
		}

		// Only admin, sales, sales_supervisor and analyst can upload documents
		if (!["admin", "sales", "sales_supervisor", "analyst"].includes(userRole)) {
			return c.json({ error: "No tienes permiso para subir documentos" }, 403);
		}

		// For sales, verify it's their opportunity
		if (userRole === "sales" && opportunity[0].assignedTo !== userId) {
			return c.json(
				{ error: "No tienes permiso para subir documentos a esta oportunidad" },
				403,
			);
		}

		// Validate file
		const validation = validateFile(file);
		if (!validation.valid) {
			return c.json({ error: validation.error }, 400);
		}

		// Generate unique filename
		const uniqueFilename = generateUniqueFilename(file.name);

		// Upload to R2
		const { key } = await uploadFileToR2(file, uniqueFilename, opportunityId);

		// Save to database
		const [newDocument] = await db
			.insert(opportunityDocuments)
			.values({
				opportunityId,
				filename: uniqueFilename,
				originalName: file.name,
				mimeType: file.type,
				size: file.size,
				documentType: documentType as any,
				description: description || undefined,
				uploadedBy: userId,
				filePath: key,
			})
			.returning();

		// Update analysis checklist if it exists
		const { updateChecklistForClientDocument } = await import(
			"./lib/checklist"
		);
		await updateChecklistForClientDocument(
			opportunityId,
			documentType,
			newDocument.id,
			!!opportunity[0]?.vehicleId,
			opportunity[0]?.vehicleId || undefined,
		);

		return c.json(newDocument);
	} catch (error) {
		console.error("Error uploading document:", error);
		return c.json({ error: "Error al subir el documento" }, 500);
	}
});
app.post("/info/renap", async (c) => {
	try {
		const body = await c.req.json<{ dpi: string; phone: string }>();

		const result = await getRenapInfoController(body.dpi, body.phone);

		return c.json(result);
	} catch (err: any) {
		console.error("[ERROR] /test/renap:", err);
		return c.json({ error: err.message || "Internal server error" }, 500);
	}
});
app.post("/info/lead-opportunity", async (c) => {
	try {
		const body = await c.req.json<{
			dpi: string;

			// Campos financieros opcionales
			dependents?: number;
			monthlyIncome?: string;
			loanAmount?: string;
			occupation?: string;
			workTime?: string;
			loanPurpose?: string;
			ownsHome?: boolean;
			ownsVehicle?: boolean;
			hasCreditCard?: boolean;

			// Documentos legales opcionales
			electricityBill?: string;
			bankStatements?: string;
			bankStatements2?: string;
			bankStatements3?: string;
		}>();

		console.log("Environment:", process.env.NODE_ENV);
		console.log("[DEBUG] /info/lead-opportunity request with body:", body);
		if (!body.dpi) {
			return c.json({ success: false, message: "DPI is required" }, 400);
		}

		const result = await updateLeadAndCreateOpportunity(body.dpi, body);

		return c.json(result);
	} catch (err: any) {
		console.error("[ERROR] /info/lead-opportunity:", err);
		return c.json({ error: err.message || "Internal server error" }, 500);
	}
});
app.post("/info/lead-progress", async (c) => {
	try {
		// Parse body
		const body = await c.req.json<{ phone?: string }>();

		if (!body.phone) {
			return c.json({ success: false, message: "Phone is required" }, 400);
		}
		console.log("Environment:", process.env.NODE_ENV);

		console.log("[DEBUG] /info/lead-progress request with phone:", body.phone);

		const result = await getLeadProgress(body.phone);

		return c.json(result);
	} catch (err: any) {
		console.error("[ERROR] /info/lead-progress:", err);
		return c.json(
			{ success: false, message: err.message || "Internal server error" },
			500,
		);
	}
});
app.get("/info/liveness-session", async (c) => {
	const result = await livenessController.createLivenessSession();
	return c.json(result, result.success ? 200 : 500);
});

app.get("/info/validate-liveness", async (c) => {
	const { sessionId, userDpi } = c.req.query() as {
		sessionId?: string;
		userDpi?: string;
	};

	if (!sessionId || !userDpi) {
		return c.json(
			{ success: false, message: "sessionId and userDpi are required" },
			400,
		);
	}

	const result = await livenessController.validateLivenessSession(
		sessionId,
		userDpi,
	);
	return c.json(result, result.success ? 200 : 500);
});
app.get("/info/validate-magic-url", async (c) => {
	const { userDpi } = c.req.query() as { userDpi?: string };

	if (!userDpi) {
		return c.json({ success: false, message: "userDpi is required" }, 400);
	}

	const result = await validateMagicUrlController(userDpi);
	return c.json(result, result.success ? 200 : 400);
});

// 🔥 ENDPOINT - Enviar OTP
app.post("/info/send-otp", async (c) => {
	const body = await c.req.json();
	const { dpi, phoneNumber } = body as { dpi?: string; phoneNumber?: string };

	// Validaciones de formato
	if (!dpi) {
		return c.json({ success: false, message: "DPI is required" }, 400);
	}

	if (!phoneNumber) {
		return c.json({ success: false, message: "Phone number is required" }, 400);
	}

	if (!/^\d{13}$/.test(dpi)) {
		return c.json(
			{
				success: false,
				message: "DPI debe tener 13 dígitos",
			},
			400,
		);
	}

	if (!/^502\d{8}$/.test(phoneNumber)) {
		return c.json(
			{
				success: false,
				message: "Número debe tener formato 502XXXXXXXX",
			},
			400,
		);
	}

	// Llamar al controller
	const result = await otpController.sendOTP(dpi, phoneNumber);
	return c.json(result, result.status);
});

// 🔥 ENDPOINT - Validar OTP
app.post("/info/validate-otp", async (c) => {
	const body = await c.req.json();
	const { code, dpi } = body as { code?: string; dpi?: string };

	// Validaciones de formato
	if (!code) {
		return c.json({ success: false, message: "Code is required" }, 400);
	}

	if (!dpi) {
		return c.json({ success: false, message: "DPI is required" }, 400);
	}

	if (!/^\d{13}$/.test(dpi)) {
		return c.json(
			{
				success: false,
				message: "DPI debe tener 13 dígitos",
			},
			400,
		);
	}

	if (!/^\d{4}$/.test(code)) {
		return c.json(
			{
				success: false,
				message: "Código debe tener 4 dígitos",
			},
			400,
		);
	}

	// Llamar al controller para validar
	const result = await otpController.validateOTP(dpi, code);

	// Si es exitoso, consultar Infornet
	if (result.success && result.data) {
		console.log(`🔍 OTP válido, consultando Infornet para DPI: ${dpi}`);

		const estudioResult = await infornetController.obtenerEstudioPorDPI(dpi);

		if (!estudioResult.success) {
			return c.json(
				{
					success: false,
					message:
						estudioResult.error || "Error al obtener información de Infornet",
					tokenValidated: true,
					infornetError: true,
				},
				404,
			);
		}

		// Análisis de riesgo
		const analisisRiesgo = await infornetController.analizarRiesgo(dpi);

		// 🔥 Determinar si pasó el buró
		const pasoBuro =
			!analisisRiesgo?.detalles.tieneDelitosPenales &&
			!analisisRiesgo?.detalles.tieneMorosidad;

		// 🔥 Mensaje descriptivo del resultado
		let mensajeBuro = "Aprobado";
		const motivosRechazo: string[] = [];

		if (analisisRiesgo?.detalles.tieneDelitosPenales) {
			motivosRechazo.push("Tiene antecedentes penales");
		}
		if (analisisRiesgo?.detalles.tieneMorosidad) {
			motivosRechazo.push("Tiene historial de morosidad");
		}

		if (!pasoBuro) {
			mensajeBuro = `Rechazado: ${motivosRechazo.join(", ")}`;
		}

		return c.json(
			{
				success: true,
				message: "OTP validated successfully",
				tokenValidated: true,
				pasoBuro: pasoBuro,
				mensajeBuro: mensajeBuro,
				data: {
					estudio: estudioResult.data,
					fromCache: estudioResult.fromCache,
					analisisRiesgo: analisisRiesgo,
				},
			},
			200,
		);
	}

	// Si falló la validación, retornar el error
	return c.json(result, result.status);
});

app.post("/info/validate-otp", async (c) => {
	const body = await c.req.json();
	const { code, dpi } = body as { code?: string; dpi?: string };

	// Validaciones de formato
	if (!code) {
		return c.json({ success: false, message: "Code is required" }, 400);
	}

	if (!dpi) {
		return c.json({ success: false, message: "DPI is required" }, 400);
	}

	if (!/^\d{13}$/.test(dpi)) {
		return c.json(
			{
				success: false,
				message: "DPI debe tener 13 dígitos",
			},
			400,
		);
	}

	if (!/^\d{4}$/.test(code)) {
		return c.json(
			{
				success: false,
				message: "Código debe tener 4 dígitos",
			},
			400,
		);
	}

	// Llamar al controller para validar
	const result = await otpController.validateOTP(dpi, code);

	// Si es exitoso, consultar Infornet
	if (result.success && result.data) {
		console.log(`🔍 OTP válido, consultando Infornet para DPI: ${dpi}`);

		const estudioResult = await infornetController.obtenerEstudioPorDPI(dpi);

		if (!estudioResult.success) {
			return c.json(
				{
					success: false,
					message:
						estudioResult.error || "Error al obtener información de Infornet",
					tokenValidated: true,
					infornetError: true,
				},
				404,
			);
		}

		// Análisis de riesgo
		const analisisRiesgo = await infornetController.analizarRiesgo(dpi);

		// 🔥 Determinar si pasó el buró
		const pasoBuro =
			!analisisRiesgo?.detalles.tieneDelitosPenales &&
			!analisisRiesgo?.detalles.tieneMorosidad;

		// 🔥 Mensaje descriptivo del resultado
		let mensajeBuro = "Aprobado";
		const motivosRechazo: string[] = [];

		if (analisisRiesgo?.detalles.tieneDelitosPenales) {
			motivosRechazo.push("Tiene antecedentes penales");
		}
		if (analisisRiesgo?.detalles.tieneMorosidad) {
			motivosRechazo.push("Tiene historial de morosidad");
		}

		if (!pasoBuro) {
			mensajeBuro = `Rechazado: ${motivosRechazo.join(", ")}`;
		}

		return c.json(
			{
				success: true,
				message: "OTP validated successfully",
				tokenValidated: true,
				pasoBuro: pasoBuro,
				mensajeBuro: mensajeBuro,
				data: {
					estudio: estudioResult.data,
					fromCache: estudioResult.fromCache,
					analisisRiesgo: analisisRiesgo,
				},
			},
			200,
		);
	}

	// Si falló la validación, retornar el error
	return c.json(result, result.status);
});
app.post("/info/check-liveness", async (c) => {
	const body = await c.req.json();
	const { dpi, phoneNumber } = body as {
		dpi?: string;
		phoneNumber?: string | number;
	};

	// Validaciones de formato
	if (!dpi) {
		return c.json({ success: false, message: "DPI is required" }, 400);
	}

	if (!phoneNumber && phoneNumber !== 0) {
		return c.json({ success: false, message: "Phone number is required" }, 400);
	}

	// Convertir phoneNumber a string si viene como número
	const phoneNumberStr = String(phoneNumber);

	if (!/^\d{13}$/.test(dpi)) {
		return c.json(
			{
				success: false,
				message: "DPI debe tener 13 dígitos",
			},
			400,
		);
	}

	if (!/^\d{8,11}$/.test(phoneNumberStr)) {
		return c.json(
			{
				success: false,
				message: "Número de teléfono debe tener entre 8 y 11 dígitos",
			},
			400,
		);
	}

	// 🔥 Verificar liveness y generar OTP si pasó
	const livenessResult = await hasPassedLiveness(dpi, phoneNumberStr);

	if (!livenessResult.passed) {
		return c.json(
			{
				success: false,
				message: "Debe completar la validación de vida antes de continuar",
				livenessValidated: false,
			},
			403,
		);
	}

	// 🔥 Si pasó liveness, devolver la respuesta del OTP
	if (livenessResult.otpResponse) {
		return c.json(
			{
				...livenessResult.otpResponse,
				livenessValidated: true,
			},
			livenessResult.otpResponse.status,
		);
	}

	// Caso inesperado
	return c.json(
		{
			success: false,
			message: "Error inesperado al procesar la solicitud",
		},
		500,
	);
});
// 🔥 ENDPOINT - Validar OTP con control de intentos

// REST endpoint for public lead creation (for external web forms)
app.post("/api/public/lead", createPublicLead);

// Portal endpoints (protected with BETTER_SECRET_PORTAL token)
app.get("/api/portal/lead", validatePortalToken, getLeadByEmail);
app.post("/api/portal/lead/update", validatePortalToken, updateLeadByEmail);
app.get(
	"/api/portal/lead/documents",
	validatePortalToken,
	getLeadOpportunityDocuments,
);
app.get(
	"/api/portal/lead/contracts",
	validatePortalToken,
	getLeadLegalContracts,
);
app.get("/api/portal/lead/sifco", validatePortalToken, getSifcoNumbersByDpi);

app.get("/webhook/facebook-lead", async (c) => {
	const challenge = c.req.query("hub.challenge");

	// 👉 Siempre responde con el challenge que manda Facebook
	return new Response(challenge, { status: 200 });
});
app.post("/webhook/facebook-lead", async (c) => {
	try {
		const body = await c.req.json();

		// 👀 De momento solo logueamos lo que llegue
		console.log("Lead recibido:", JSON.stringify(body, null, 2));

		return c.json({ success: true, message: "Lead recibido" }, 200);
	} catch (err: any) {
		return c.json(
			{ success: false, message: err.message || "Internal server error" },
			500,
		);
	}
});
app.get("/upload-csv", async (c) => {
	try {
		const result = await processCsvLeads();
		return c.json(result);
	} catch (err: any) {
		return c.json({ error: err.message }, 500);
	}
});

export default {
	port: process.env.PORT || 3000,
	fetch: app.fetch,
};
