import "dotenv/config";
import { RPCHandler } from "@orpc/server/fetch";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { type Context as HonoContext, Hono } from "hono";
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
import { loadCarsController } from "./controllers/load-cars";
import { otpController } from "./controllers/otp";
import {
	createPortalRegisterLead,
	getLeadByEmail,
	getLeadLegalContracts,
	getLeadOpportunityDocuments,
	getSifcoNumbersByDpi,
	updateLeadByEmail,
	validatePortalToken,
} from "./controllers/portal-lead";
import { createPublicLead } from "./controllers/public-lead";
import { getVehicleByCodigoController } from "./controllers/vehicles";
import type { db } from "./db";
import { otps } from "./db/schema/otp";
import {
	checkCasosSinContacto,
	checkSeguimientosVencidos,
} from "./jobs/cobros-notifications";
import { auth } from "./lib/auth";
import { createContext } from "./lib/context";
import {
	appRouter,
	disbursementRouter,
	manualVehicleRouter,
} from "./routers/index";
import { investmentsRouter } from "./routers/investments";
import externalContractsRouter from "./routes/external-contracts";

const app = new Hono();
const AUTH_DIAG_PREFIX = "CRM_AUTH_DIAG";

function logAuthDiagnostic(reason: string, detail: Record<string, unknown>) {
	console.warn(
		AUTH_DIAG_PREFIX,
		JSON.stringify({
			...detail,
			reason,
			timestamp: new Date().toISOString(),
		}),
	);
}

function getRequestDiagnostic(c: HonoContext) {
	return {
		ip:
			c.req.header("cf-connecting-ip") ||
			c.req.header("x-forwarded-for") ||
			"unknown",
		origin: c.req.header("origin") || null,
		path: c.req.path,
		userAgent: c.req.header("user-agent") || null,
	};
}

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

			// Permitir subdominios de devteamatcci.site, servicioscashin.com y clubcashin.com (wildcard)
			if (
				origin?.match(
					/^https?:\/\/(.*\.)?(devteamatcci\.site|servicioscashin\.com|clubcashin\.com)$/,
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

app.post("/api/auth-diagnostics/client-event", async (c) => {
	let body: unknown = null;
	try {
		body = await c.req.json();
	} catch {
		body = { parseError: true };
	}

	logAuthDiagnostic("client-event", {
		...getRequestDiagnostic(c),
		body,
	});

	return c.json({ ok: true });
});

app.on(["POST", "GET"], "/api/auth/**", async (c) => {
	const response = await auth.handler(c.req.raw);
	const requestInfo = getRequestDiagnostic(c);

	if (c.req.path.includes("/sign-out")) {
		logAuthDiagnostic("auth-sign-out", {
			...requestInfo,
			status: response.status,
		});
	}

	if (response.status >= 400) {
		logAuthDiagnostic("auth-response-error", {
			...requestInfo,
			status: response.status,
			statusText: response.statusText,
		});
	}

	if (c.req.path.includes("/get-session") && response.status === 200) {
		const body = await response.clone().text();
		if (body === "null") {
			logAuthDiagnostic("auth-get-session-null", {
				...requestInfo,
				hasCookie: c.req.header("cookie")?.includes("better-auth") ?? false,
				status: response.status,
			});
		}
	}

	return response;
});

// External contracts endpoint (requires service account authentication)
app.route("/api/contracts/external", externalContractsRouter);

const handler = new RPCHandler(
	Object.assign(
		{},
		appRouter,
		manualVehicleRouter,
		investmentsRouter,
		disbursementRouter,
	),
);
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

// Vehicle video upload endpoint
app.post("/api/upload-vehicle-video", async (c) => {
	try {
		// Get the context (optional for this endpoint)
		const context = await createContext({ context: c });

		// Video endpoint authentication
		if (!context.session?.user?.id || !context.session?.user?.role) {
			return c.json({ error: "No autorizado" }, 401);
		}

		// Parse multipart form data
		const formData = await c.req.formData();
		const file = formData.get("file") as File;
		const vehicleId = formData.get("vehicleId") as string;
		const category = formData.get("category") as string;
		const videoType = formData.get("videoType") as string;
		const title = formData.get("title") as string;
		const description = formData.get("description") as string | null;

		if (!file || !vehicleId || !category || !videoType || !title) {
			return c.json(
				{
					error:
						"Faltan campos requeridos (file, vehicleId, category, videoType, title)",
				},
				400,
			);
		}

		// Import necessary modules
		const { validateVideo, generateUniqueFilename, uploadVehicleVideoToR2 } =
			await import("./lib/storage");

		// Validate video
		const validation = validateVideo(file);
		if (!validation.valid) {
			console.error("Video validation failed:", {
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
		console.log("Uploading video:", {
			fileName: uniqueFilename,
			vehicleId,
			category,
			fileSize: file.size,
		});

		const { key, url } = await uploadVehicleVideoToR2(
			file,
			uniqueFilename,
			vehicleId,
			category,
		);

		console.log("Video upload successful:", { key, url });

		return c.json({
			success: true,
			data: {
				key,
				url,
				vehicleId,
				category,
				videoType: videoType || "video",
				title: title || "Video Evidence",
				description,
			},
		});
	} catch (error) {
		console.error("Error uploading vehicle video:", error);
		return c.json({ error: "Error al subir el video" }, 500);
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
		const {
			validateFile,
			generateUniqueFilename,
			uploadFileToR2,
			resolveMimeType,
		} = await import("./lib/storage");
		const validation = validateFile(file);
		if (!validation.valid) {
			return c.json({ error: validation.error }, 400);
		}

		const resolvedMimeType = resolveMimeType(file);

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
				mimeType: resolvedMimeType,
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
		const body = await c.req.json<{ dpi: unknown; phone: unknown }>();

		const dpi = String(body.dpi ?? "").trim();
		const phone = String(body.phone ?? "").trim();

		if (!dpi || !phone) {
			return c.json({ error: "dpi y phone son requeridos" }, 400);
		}

		const result = await getRenapInfoController(dpi, phone);

		return c.json(result);
	} catch (err: any) {
		console.error("[ERROR] /info/renap:", err);
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

// Obtener URL del Excel del resumen global de inversionistas
app.get("/api/accounting/resumen-global-excel", async (c) => {
	try {
		const context = await createContext({ context: c });
		if (!context.session?.user?.id) {
			return c.json({ error: "No autorizado" }, 401);
		}

		const estado = c.req.query("estado");
		const mes = c.req.query("mes");
		const anio = c.req.query("anio");
		const inversionistaId = c.req.query("inversionistaId");

		const { carteraBackClient } = await import(
			"./services/cartera-back-client"
		);
		const result = await carteraBackClient.getResumenGlobalExcel({
			estado:
				estado === "pending" ||
				estado === "uploaded" ||
				estado === "liquidated" ||
				estado === "all"
					? estado
					: "pending",
			mes: mes ? Number(mes) : undefined,
			anio: anio ? Number(anio) : undefined,
			inversionistaId: inversionistaId || undefined,
		});
		return c.json(result);
	} catch (err: any) {
		console.error("[ResumenGlobalExcel] Error:", err);
		return c.json({ error: err.message || "Error al descargar Excel" }, 500);
	}
});

// Upload boleta de inversionista a cartera-back
app.post("/api/accounting/upload-boleta", async (c) => {
	try {
		const context = await createContext({ context: c });
		if (!context.session?.user?.id) {
			return c.json({ error: "No autorizado" }, 401);
		}

		const formData = await c.req.formData();
		const file = formData.get("file") as File;
		if (!file) {
			return c.json({ error: "No se envió archivo" }, 400);
		}

		const { carteraBackClient } = await import(
			"./services/cartera-back-client"
		);
		const result = await carteraBackClient.uploadFile(file, file.name);
		return c.json(result);
	} catch (err: any) {
		console.error("[UploadBoleta] Error:", err);
		return c.json({ error: err.message || "Error al subir archivo" }, 500);
	}
});

// Endpoint para que cartera-back cree notificaciones de pago de inversionistas
app.post("/api/notifications/pay-investors", async (c) => {
	try {
		const body = await c.req.json<{
			titulo: string;
			descripcion?: string;
		}>();

		if (!body.titulo) {
			return c.json({ error: "El campo 'titulo' es requerido" }, 400);
		}

		const { createNotification } = await import("./routers/notifications");
		const { db } = await import("./db");
		const { user } = await import("./db/schema/auth");
		const { eq } = await import("drizzle-orm");

		const { ROLES } = await import("./lib/roles");

		// Buscar el primer supervisor de cobros como creador
		const [cobrosSupervisor] = await db
			.select({ id: user.id })
			.from(user)
			.where(eq(user.role, ROLES.COBROS_SUPERVISOR))
			.limit(1);

		if (!cobrosSupervisor) {
			return c.json(
				{ error: "No se encontró un usuario cobros_supervisor" },
				500,
			);
		}

		const notification = await createNotification({
			titulo: body.titulo,
			descripcion: body.descripcion || null,
			type: "pay_investors",
			createdBy: cobrosSupervisor.id,
			createdByRole: ROLES.COBROS_SUPERVISOR,
			assignedToRole: ROLES.ACCOUNTING,
			redirectPage: "pay_investors",
		});

		return c.json({ success: true, notification });
	} catch (err: any) {
		console.error("[PayInvestorsNotification] Error:", err);
		return c.json({ error: err.message || "Error al crear notificación" }, 500);
	}
});

// REST endpoint for public lead creation (for external web forms)
app.post("/api/public/lead", createPublicLead);

// REST endpoint for investment lead creation (for external APIs)
app.post("/api/public/investment-lead", async (c) => {
	const { createInvestmentLeadController } = await import(
		"./controllers/investment-lead"
	);
	return createInvestmentLeadController(c);
});

// Load cars endpoint (for importing vehicles from Excel/JSON)
app.post("/api/load-cars", loadCarsController);

// Portal endpoints (protected with BETTER_SECRET_PORTAL token)
app.get("/api/portal/lead", validatePortalToken, getLeadByEmail);
// REST endpoint for portal registration: finds lead by DPI or creates new one without duplicate opportunities
app.post("/api/portal/lead", validatePortalToken, createPortalRegisterLead);
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

// Endpoint REST directo para migración masiva de créditos (más fácil de usar desde Postman)
// SIEMPRE usa transacción - si algo falla, se hace rollback de todo
// Reprocesar oportunidades ganadas sin numero SIFCO
// DESCONECTADO: ya se procesaron las 7 oportunidades pendientes (2026-03-05)
// Para reconectar, descomentar el bloque de abajo
// app.post("/api/reprocess-won-opportunities", async (c) => {
// 	try {
// 		const { reprocessWonOpportunities } = await import(
// 			"./controllers/reprocess-opportunities"
// 		);
// 		return await reprocessWonOpportunities(c);
// 	} catch (err: any) {
// 		console.error("[ReprocessWon] Error:", err);
// 		return c.json({ error: err.message }, 500);
// 	}
// });

app.post("/api/migrate/creditos", async (c) => {
	try {
		const { migrarCreditos } = await import("./controllers/migrate-creditos");
		const creditos = await c.req.json();

		if (!Array.isArray(creditos)) {
			return c.json(
				{ error: "Formato inválido. Enviar un array de créditos." },
				400,
			);
		}

		const resultado = await migrarCreditos(creditos);
		return c.json(resultado);
	} catch (err: any) {
		console.error("[Migrate] Error:", err);
		return c.json({ error: err.message }, 500);
	}
});

// Endpoint para actualizar el value de oportunidades migradas desde cartera-back
app.post("/api/migrate/actualizar-value", async (c) => {
	try {
		const { actualizarValueOportunidades } = await import(
			"./controllers/migrate-creditos"
		);
		const resultado = await actualizarValueOportunidades();
		return c.json(resultado);
	} catch (err: any) {
		console.error("[UpdateValue] Error:", err);
		return c.json({ error: err.message }, 500);
	}
});

// Endpoint para hacer rollback/limpieza de TODOS los datos migrados
// CUIDADO: Elimina todos los leads, vehículos y oportunidades con status='migrate'
app.delete("/api/migrate/cleanup", async (c) => {
	try {
		const { limpiarMigracion } = await import("./controllers/migrate-creditos");
		const resultado = await limpiarMigracion();
		return c.json(resultado);
	} catch (err: any) {
		console.error("[Cleanup] Error:", err);
		return c.json({ error: err.message }, 500);
	}
});

// Endpoint para traer información del vehiculo a través del sifco
app.get("/info/vehicle-details", async (c) => {
	const { numero_sifco } = c.req.query() as { numero_sifco?: string };

	if (!numero_sifco) {
		return c.json({ success: false, message: "numero_sifco is required" }, 400);
	}

	const result = await getVehicleByCodigoController(numero_sifco);
	return c.json(result, result.success ? 200 : 404);
});

// Job periódico de notificaciones de cobros (cada hora)
setInterval(
	async () => {
		try {
			await checkSeguimientosVencidos();
			await checkCasosSinContacto(3);
		} catch (error) {
			console.error("Error en job de notificaciones cobros:", error);
		}
	},
	60 * 60 * 1000,
);

// Ejecutar una vez al iniciar (con delay de 10s para que la DB esté lista)
setTimeout(() => {
	checkSeguimientosVencidos().catch(console.error);
	checkCasosSinContacto(3).catch(console.error);
}, 10_000);

export default {
	port: process.env.PORT || 3000,
	fetch: app.fetch,
};
