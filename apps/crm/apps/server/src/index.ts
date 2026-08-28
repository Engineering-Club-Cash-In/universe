import "dotenv/config";
import { RPCHandler } from "@orpc/server/fetch";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { Hono, type Context as HonoContext } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import {
	getLeadProgress,
	getRenapInfoController,
	hasPassedLiveness,
	updateLeadAndCreateOpportunity,
	validateMagicUrlController,
} from "./controllers/bot";
import {
	buscarClienteBotCobros,
	confirmarBoletaBotCobros,
	estadoDeCuentaBotCobros,
	infoCreditoBotCobros,
	leerBoletaBotCobros,
	listarCreditosBotCobros,
} from "./controllers/bot-cobros";
import { eventoPagoBotCobros } from "./controllers/bot-cobros-eventos";
import {
	crearPagoLinkBotCobros,
	estadoPagoLinkBotCobros,
	opcionesPagoLinkBotCobros,
} from "./controllers/bot-cobros-pago-link";
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
import {
	getVehicleByCodigoController,
	getVehiclesBySifcoController,
} from "./controllers/vehicles";
import type { db } from "./db";
import { ejecutarAgendaCobrosDiariaConReintentos } from "./jobs/agenda-cobros-snapshots";
import { purgarBoletasSinConfirmar } from "./jobs/bot-cobros-purga";
import { reconciliarBoletasColgadas } from "./jobs/bot-cobros-reconciliacion";
import { reintentarAvisosDeRechazo } from "./jobs/bot-cobros-respaldo";
import { generarCierreDiario } from "./jobs/cierre-diario-asesores";
import {
	checkSeguimientosVencidos,
	procesarSeguimientosRecurrentes,
} from "./jobs/cobros-notifications";
import { correrDispatchPagalo } from "./jobs/pagalo-dispatch";
import { correrPollPagalo } from "./jobs/pagalo-poll";
import { correrRecordatorioPagalo } from "./jobs/pagalo-reminder";
import { auth } from "./lib/auth";
import {
	autenticarBotCobros,
	autenticarCarteraWebhook,
} from "./lib/bot-cobros/auth";
import { docsBotCobros, openapiBotCobros } from "./lib/bot-cobros/docs";
import { historialBotCobros } from "./lib/bot-cobros/historial";
import { createContext } from "./lib/context";
import { toDateStrGT } from "./lib/guatemala-month-window";
import { getTestPhone, isTestModeEnabled } from "./lib/messaging-test-mode";
import { autenticarNotificacionesCarteraBack } from "./lib/notifications-api-key-auth";
import { PERMISSIONS } from "./lib/roles";
import { bucketCapacidadRouter } from "./routers/bucket-capacidad";
import {
	appRouter,
	disbursementRouter,
	manualVehicleRouter,
	proyeccionRouter,
} from "./routers/index";
import { investmentsRouter } from "./routers/investments";
import { pagaloGrupoActivoRouter } from "./routers/pagalo-grupo-activo";
import { pagaloSupervisionRouter } from "./routers/pagalo-supervision";
import externalContractsRouter from "./routes/external-contracts";
import { carteraBackClient } from "./services/cartera-back-client";
import { checkCobrosAlertas } from "./services/check-cobros-alertas";
import {
	type CheckPromesasResumen,
	checkPromesasPago,
} from "./services/check-promesas-pago";
import { refreshPremoraElegibilidad } from "./services/refresh-premora-elegibilidad";
import { sendConvenioReminders } from "./services/send-convenio-reminders";
import { sendPremoraReminders } from "./services/send-premora-reminders";
import { sincronizarPromesasCarteraBack } from "./services/sync-promesas-cartera-back";

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

			// En producción, usar los origin específicos configurados
			const allowedOrigins = [
				process.env.CORS_ORIGIN,
				process.env.FRONT_URL,
				process.env.TALLER_URL,
			].filter((o): o is string => Boolean(o && o !== "*"));

			if (origin && allowedOrigins.includes(origin)) {
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
		bucketCapacidadRouter,
		proyeccionRouter,
		pagaloGrupoActivoRouter,
		pagaloSupervisionRouter,
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
		// Get the context and require authenticated vehicle access.
		const context = await createContext({ context: c });
		const userRole = context.session?.user?.role;

		if (!context.session?.user?.id) {
			return c.json({ error: "No autorizado" }, 401);
		}

		if (!userRole || !PERMISSIONS.canAccessVehicles(userRole)) {
			return c.json({ error: "No tienes permiso para subir fotos" }, 403);
		}

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

// CB-128: boleta/comprobante del form "registrar pago" (Ficha 360). Reenvía
// el archivo server-to-server al mismo endpoint POST /upload que usa
// carteraFront — el bucket R2 y las credenciales de cartera-back nunca las ve
// el browser del CRM, mismo patrón de proxy que ya siguen los uploads de
// vehículo de arriba.
app.post("/api/upload-boleta-pago", async (c) => {
	try {
		const context = await createContext({ context: c });

		if (!context.session?.user?.id) {
			return c.json({ error: "No autorizado" }, 401);
		}

		const userRole = context.session.user.role;
		if (!userRole || !PERMISSIONS.canAccessCobros(userRole)) {
			return c.json({ error: "No tienes permiso para registrar pagos" }, 403);
		}

		const formData = await c.req.formData();
		const file = formData.get("file") as File;

		if (!file) {
			return c.json({ error: "Falta el archivo de la boleta" }, 400);
		}

		const { validateFile } = await import("./lib/storage");
		const validation = validateFile(file);
		if (!validation.valid) {
			console.error("Boleta de pago rechazada:", {
				fileName: file.name,
				fileType: file.type,
				fileSize: file.size,
				error: validation.error,
			});
			return c.json({ error: validation.error }, 400);
		}

		const { filename } = await carteraBackClient.uploadFile(file, file.name);

		return c.json({ success: true, data: { filename } });
	} catch (error) {
		console.error("Error uploading boleta de pago:", error);
		return c.json({ error: "Error al subir la boleta" }, 500);
	}
});

/**
 * Lee una boleta con IA y devuelve los campos para autocompletar el formulario
 * de Registrar pago.
 *
 * Es EXACTAMENTE el mismo lector del bot de WhatsApp (`leerBoletaConIA` +
 * `reconocerBanco` + `fechaBoletaValida`): si el bot y el asesor leyeran la
 * misma boleta con criterios distintos, conta terminaría con dos verdades del
 * mismo depósito.
 *
 * NO sube nada ni escribe en la base: es solo lectura. El archivo se sube a R2
 * al registrar el pago (`/api/upload-boleta-pago`), como siempre — así una
 * lectura que el asesor descarta no deja basura en storage.
 */
app.post("/api/leer-boleta-pago", async (c) => {
	try {
		const context = await createContext({ context: c });

		if (!context.session?.user?.id) {
			return c.json({ error: "No autorizado" }, 401);
		}

		const userRole = context.session.user.role;
		if (!userRole || !PERMISSIONS.canAccessCobros(userRole)) {
			return c.json({ error: "No tienes permiso para registrar pagos" }, 403);
		}

		const formData = await c.req.formData();
		const file = formData.get("file") as File;
		if (!file) {
			return c.json({ error: "Falta el archivo de la boleta" }, 400);
		}

		const { validateFile } = await import("./lib/storage");
		const validation = validateFile(file);
		if (!validation.valid) {
			return c.json({ error: validation.error }, 400);
		}

		const [
			{ leerBoletaConIA, montoALimpio, fechaBoletaValida },
			{ reconocerBanco },
			{ hoyGuatemala },
		] = await Promise.all([
			import("./lib/bot-cobros/lectura-boleta"),
			import("./lib/bot-cobros/bancos-boleta"),
			import("./lib/bot-cobros/boleta"),
		]);

		const buffer = Buffer.from(await file.arrayBuffer());
		const lectura = await leerBoletaConIA({ buffer, tipo: file.type });

		if (!lectura.ok) {
			// Timeout, cuota agotada o modelo caído. 503 y no 500: el asesor puede
			// seguir a mano, que es justo lo que dice el mensaje.
			return c.json(
				{
					error:
						"No se pudo leer la boleta automáticamente. Completá los datos a mano.",
				},
				503,
			);
		}

		const leida = lectura.lectura;
		const banco = reconocerBanco(leida.banco);
		const fecha = fechaBoletaValida(leida.fechaBoleta, hoyGuatemala());
		const tipo = (leida.tipoOperacion ?? "").toLowerCase();

		return c.json({
			success: true,
			data: {
				esBoletaDePago: leida.esBoletaDePago,
				monto: montoALimpio(leida.monto),
				bancoId: banco?.id ?? null,
				bancoNombre: banco?.nombre ?? null,
				// Lo que el modelo leyó tal cual, para poder decir "leí X pero no lo
				// tengo en el catálogo" en vez de un "no se reconoció" pelado.
				bancoLeido: leida.banco ?? null,
				fechaBoleta: fecha.fecha,
				fechaCorregida: fecha.corregida,
				numeroAutorizacion: leida.numeroAutorizacion ?? null,
				// Un depósito monetario es "boleta" para cartera; lo demás se
				// reconoce por palabra suelta y ante la duda no se elige nada.
				origenPago: tipo.includes("transferencia")
					? "transferencia"
					: tipo.includes("cheque")
						? "cheque"
						: tipo.includes("deposito") || tipo.includes("depósito")
							? "boleta"
							: null,
				observaciones: leida.observaciones ?? null,
				camposNoLeidos: leida.camposNoLeidos ?? [],
			},
		});
	} catch (error) {
		console.error("Error leyendo boleta de pago:", error);
		return c.json({ error: "Error al leer la boleta" }, 500);
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
			// Mismo criterio que la tabla de Pagar Inversionistas: el Excel debe
			// traer también a los internos/propios (Cube, Autocash, …).
			incluirInternos: true,
		});
		return c.json(result);
	} catch (err: any) {
		console.error("[ResumenGlobalExcel] Error:", err);
		return c.json({ error: err.message || "Error al descargar Excel" }, 500);
	}
});

// Obtener URL del Excel de transferencias (ACH / no-ACH)
app.get("/api/accounting/resumen-transferencias-excel", async (c) => {
	try {
		const context = await createContext({ context: c });
		if (!context.session?.user?.id) {
			return c.json({ error: "No autorizado" }, 401);
		}

		const mes = c.req.query("mes");
		const anio = c.req.query("anio");
		const ach = c.req.query("ach");
		const moneda = c.req.query("moneda");

		if (!mes || !anio) {
			return c.json(
				{ error: "Los parámetros 'mes' y 'anio' son obligatorios" },
				400,
			);
		}

		const monedaParam: "quetzales" | "dolar" | undefined =
			moneda === "quetzales" || moneda === "dolar" ? moneda : undefined;

		const { carteraBackClient } = await import(
			"./services/cartera-back-client"
		);
		const result = await carteraBackClient.getResumenTransferenciasExcel({
			mes: Number(mes),
			anio: Number(anio),
			ach: ach === "true",
			moneda: monedaParam,
		});
		return c.json(result);
	} catch (err: any) {
		console.error("[ResumenTransferenciasExcel] Error:", err);
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

// Endpoint para que cartera-back mande el recibo de un pago por WhatsApp
// (CB-113), justo después de facturarlo. Servidor-a-servidor: autenticado
// con API key, no con sesión de usuario.
app.post(
	"/api/notifications/recibo-pago-whatsapp",
	autenticarNotificacionesCarteraBack,
	async (c) => {
		try {
			const body = await c.req.json<{
				pagoId?: number;
				numeroSifco?: string;
				reciboUrl?: string;
				clienteNombre?: string;
				numeroCuota?: number | null;
				asesorNombre?: string | null;
				asesorTelefono?: string | null;
			}>();

			if (!body.pagoId || !body.numeroSifco || !body.reciboUrl) {
				return c.json(
					{
						success: false,
						error:
							"Los campos 'pagoId', 'numeroSifco' y 'reciboUrl' son requeridos",
					},
					400,
				);
			}

			const { sendReciboPagoWhatsapp } = await import(
				"./services/send-recibo-pago-whatsapp"
			);

			const resultado = await sendReciboPagoWhatsapp({
				pagoId: body.pagoId,
				numeroSifco: body.numeroSifco,
				reciboUrl: body.reciboUrl,
				clienteNombre: body.clienteNombre ?? "",
				numeroCuota: body.numeroCuota ?? null,
				asesorNombre: body.asesorNombre ?? null,
				asesorTelefono: body.asesorTelefono ?? null,
			});

			return c.json(
				{ success: resultado.sent, ...resultado },
				resultado.sent ? 200 : 502,
			);
		} catch (err: any) {
			console.error("[ReciboPagoWhatsapp] Error:", err);
			return c.json(
				{ success: false, error: err.message || "Error al enviar el recibo" },
				500,
			);
		}
	},
);

// Bot de WhatsApp de cobros (SimpleTech).
// A diferencia de /info/* (bot de ventas), estos endpoints exponen datos de
// clientes con crédito, así que van autenticados con la API key del integrador.
// Ver docs/features/bot-whatsapp-cobros/

// Historial de interacciones para la Ficha 360 (CB-110, D-40/D-41). Es comodín
// A PROPÓSITO: todo servicio del bot —incluido el que se monte acá abajo el
// año que viene— deja su rastro sin que nadie haga nada. Quedar fuera exige
// una entrada justificada en RUTAS_SIN_HISTORIAL (lib/bot-cobros/historial.ts).
app.use("/api/bot/cobros/*", historialBotCobros);

app.post(
	"/api/bot/cobros/buscar-cliente",
	autenticarBotCobros,
	buscarClienteBotCobros,
);
app.post(
	"/api/bot/cobros/creditos",
	autenticarBotCobros,
	listarCreditosBotCobros,
);
// Paso 2 · info del crédito que el cliente eligió en el menú.
app.post(
	"/api/bot/cobros/credito/info",
	autenticarBotCobros,
	infoCreditoBotCobros,
);
// Paso 2 · estado de cuenta en PDF. Puente al documento que genera cartera.
app.post(
	"/api/bot/cobros/credito/estado-cuenta",
	autenticarBotCobros,
	estadoDeCuentaBotCobros,
);

// Paso 4 · lee la boleta que sube el cliente. NO registra el pago: devuelve lo
// que se entendió para que confirme.
app.post(
	"/api/bot/cobros/boleta/leer",
	autenticarBotCobros,
	leerBoletaBotCobros,
);
// Paso 4 · el cliente confirmó. ACÁ SÍ se registra el pago en cartera.
app.post(
	"/api/bot/cobros/boleta/confirmar",
	autenticarBotCobros,
	confirmarBoletaBotCobros,
);

// Paso 3 · pago con link de Págalo (CB-105). Montados y documentados ANTES de
// tener lógica para que SimpleTech arme el árbol contra el contrato; hoy
// responden 501 NO_IMPLEMENTADO (ver controllers/bot-cobros-pago-link.ts).
app.post(
	"/api/bot/cobros/pago-link/opciones",
	autenticarBotCobros,
	opcionesPagoLinkBotCobros,
);
app.post(
	"/api/bot/cobros/pago-link/crear",
	autenticarBotCobros,
	crearPagoLinkBotCobros,
);
app.post(
	"/api/bot/cobros/pago-link/estado",
	autenticarBotCobros,
	estadoPagoLinkBotCobros,
);

// Documentación de esos dos endpoints, para SimpleTech. Va SIN API key —no
// expone datos, y pedirla impediría que Swagger UI cargue el documento— pero
// solo responde con BOT_COBROS_DOCS=true, que se prende únicamente en la
// instancia de dev del bot.
app.get("/api/bot/cobros/docs", docsBotCobros);

// Circuito de vuelta · lo llama CARTERA, no SimpleTech: es el aviso del botón
// "Pago no válido" de conta (D-39), el ÚNICO evento del circuito.
//
// Va con `autenticarCarteraWebhook` y no con la llave del bot, a propósito:
// este endpoint dispara mensajes de WhatsApp a clientes, y quien puede
// consultar un crédito no tiene por qué poder hacer que le escribamos a su
// dueño. Por lo mismo NO está en el Swagger del bot.
app.post(
	"/api/bot/cobros/pagos/evento",
	autenticarCarteraWebhook,
	eventoPagoBotCobros,
);
app.get("/api/bot/cobros/openapi.json", openapiBotCobros);

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

// Endpoint batch para reportes de cartera: placa/chasis por números SIFCO.
app.post("/info/vehicles-by-sifco", async (c) => {
	try {
		const body = await c.req.json<{ numero_sifcos?: unknown }>();
		if (!Array.isArray(body.numero_sifcos)) {
			return c.json(
				{ success: false, message: "numero_sifcos must be an array" },
				400,
			);
		}

		// Tope de abuso sobre el array CRUDO, antes de normalizar, para no recorrer
		// un payload gigante (aunque normalice a vacío) en una ruta pública.
		const MAX_SIFCOS = 50000;
		if (body.numero_sifcos.length > MAX_SIFCOS) {
			return c.json(
				{
					success: false,
					message: `numero_sifcos excede el máximo permitido (${MAX_SIFCOS})`,
				},
				400,
			);
		}

		const numeroSifcos = body.numero_sifcos
			.map((value) => String(value ?? "").trim())
			.filter(Boolean);

		const result = await getVehiclesBySifcoController(numeroSifcos);
		return c.json(result, result.success ? 200 : 500);
	} catch (err: any) {
		console.error("[ERROR] /info/vehicles-by-sifco:", err);
		return c.json(
			{ success: false, message: err.message || "Internal server error" },
			500,
		);
	}
});

// CSRF (review Codex): la cookie de sesión viaja cross-site (sameSite
// "none"), así que una página maliciosa podría disparar el batch desde el
// navegador de un admin logueado. Defensa: POST-only + Origin de dominios
// propios (mismas reglas que el CORS de arriba). Sin Origin (curl/Postman)
// se permite: un navegador SIEMPRE manda Origin en un POST cross-site.
function esOrigenConfiable(origin: string | undefined): boolean {
	if (!origin) return true;
	if (
		origin.startsWith("http://localhost:") ||
		origin.startsWith("http://127.0.0.1:")
	) {
		return true;
	}
	if (
		/^https?:\/\/(.*\.)?(devteamatcci\.site|servicioscashin\.com|clubcashin\.com)$/.test(
			origin,
		)
	) {
		return true;
	}
	const allowed = [
		process.env.CORS_ORIGIN,
		process.env.FRONT_URL,
		process.env.TALLER_URL,
	].filter((o): o is string => Boolean(o && o !== "*"));
	return allowed.includes(origin);
}

// Corrida MANUAL de premora (pruebas / re-corridas del día). Solo admin y
// supervisor de cobros, POST-only con Origin validado (CSRF, arriba).
// `force` salta el gate PREMORA_WHATSAPP_ENABLED (por eso el cron puede
// quedar apagado en dev y este endpoint sí funciona); TEST_MESSAGE y los
// claims de idempotencia aplican exactamente igual. `?sifco=A,B` limita el
// batch a esos créditos para no disparar todo el día.
app.post("/api/premora/run", async (c) => {
	if (!esOrigenConfiable(c.req.header("origin"))) {
		return c.json({ error: "Origen no permitido" }, 403);
	}
	const context = await createContext({ context: c });
	if (!context.session?.user?.id) {
		return c.json({ error: "No autorizado" }, 401);
	}
	const userRole = context.session.user.role;
	if (!userRole || !PERMISSIONS.canAssignCobros(userRole)) {
		return c.json({ error: "No tienes permiso para correr premora" }, 403);
	}

	// Filtros de la corrida. REGLA (review Codex): un filtro PRESENTE pero
	// vacío ("?sifco=" por una variable sin valor, "?dias=,,") es un 400 —
	// jamás degradar en silencio a un batch más amplio del que se pidió.
	const sifcoParam = c.req.query("sifco");
	let sifcos: string[] | undefined;
	if (sifcoParam != null) {
		sifcos = sifcoParam
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		if (sifcos.length === 0) {
			return c.json(
				{ error: "sifco presente pero vacío: no se corre el batch completo" },
				400,
			);
		}
	}

	// `?dias=3` (CSV) corre solo esos recordatorios; sin el param van los 4.
	const diasParam = c.req.query("dias");
	let dias: number[] | undefined;
	if (diasParam != null) {
		const tokens = diasParam
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		dias = tokens.map((s) => Number(s)).filter((n) => Number.isInteger(n));
		const validos = [5, 3, 1, 0];
		if (
			tokens.length === 0 ||
			dias.length !== tokens.length ||
			dias.some((d) => !validos.includes(d))
		) {
			return c.json(
				{ error: "dias inválido o vacío: solo se aceptan 5, 3, 1 y 0 (CSV)" },
				400,
			);
		}
	}

	// `?buckets=0,1` (CSV 0-5): override de PREMORA_BUCKETS para esta corrida.
	const bucketsParam = c.req.query("buckets");
	let buckets: number[] | undefined;
	if (bucketsParam != null) {
		const tokens = bucketsParam
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		if (tokens.length === 0 || tokens.some((s) => !/^[0-5]$/.test(s))) {
			return c.json(
				{ error: "buckets inválido o vacío: CSV de enteros 0-5" },
				400,
			);
		}
		buckets = [...new Set(tokens.map(Number))];
	}

	const testMode = isTestModeEnabled();
	const resumen = await sendPremoraReminders({
		force: true,
		sifcos,
		dias,
		buckets,
	});
	return c.json({
		success: true,
		testMode,
		telefonoTest: testMode ? getTestPhone() : null,
		filtroSifco: sifcos ?? null,
		filtroDias: dias ?? null,
		filtroBuckets: buckets ?? null,
		resumen,
	});
});

// COBROS-02: corrida MANUAL de los recordatorios de CONVENIO (pruebas /
// re-corridas). Mismo gate que premora (admin/cobros_supervisor). `force` salta
// el gate CONVENIO_WHATSAPP_ENABLED. `?sifco=` y `?dias=` iguales que premora.
app.post("/api/convenio/recordatorios/run", async (c) => {
	if (!esOrigenConfiable(c.req.header("origin"))) {
		return c.json({ error: "Origen no permitido" }, 403);
	}
	const context = await createContext({ context: c });
	if (!context.session?.user?.id) {
		return c.json({ error: "No autorizado" }, 401);
	}
	const userRole = context.session.user.role;
	if (!userRole || !PERMISSIONS.canAssignCobros(userRole)) {
		return c.json(
			{ error: "No tienes permiso para correr recordatorios de convenio" },
			403,
		);
	}

	const sifcoParam = c.req.query("sifco");
	let sifcos: string[] | undefined;
	if (sifcoParam != null) {
		sifcos = sifcoParam
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		if (sifcos.length === 0) {
			return c.json(
				{ error: "sifco presente pero vacío: no se corre el batch completo" },
				400,
			);
		}
	}

	const diasParam = c.req.query("dias");
	let dias: number[] | undefined;
	if (diasParam != null) {
		const tokens = diasParam
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		dias = tokens.map((s) => Number(s)).filter((n) => Number.isInteger(n));
		const validos = [5, 3, 1, 0];
		if (
			tokens.length === 0 ||
			dias.length !== tokens.length ||
			dias.some((d) => !validos.includes(d))
		) {
			return c.json(
				{ error: "dias inválido o vacío: solo se aceptan 5, 3, 1 y 0 (CSV)" },
				400,
			);
		}
	}

	const testMode = isTestModeEnabled();
	const resumen = await sendConvenioReminders({ force: true, sifcos, dias });
	return c.json({
		success: true,
		testMode,
		telefonoTest: testMode ? getTestPhone() : null,
		filtroSifco: sifcos ?? null,
		filtroDias: dias ?? null,
		resumen,
	});
});

// CB-010: corrida MANUAL del job de elegibilidad de la reducción de
// recordatorios (refresca la foto de "paga bien" desde cartera y hace el
// auto-revoke). Mismo gate que premora (admin/cobros_supervisor, POST con
// Origin validado). Útil para repoblar el tracking sin reiniciar el server.
app.post("/api/premora/elegibilidad/run", async (c) => {
	if (!esOrigenConfiable(c.req.header("origin"))) {
		return c.json({ error: "Origen no permitido" }, 403);
	}
	const context = await createContext({ context: c });
	if (!context.session?.user?.id) {
		return c.json({ error: "No autorizado" }, 401);
	}
	const userRole = context.session.user.role;
	if (!userRole || !PERMISSIONS.canAssignCobros(userRole)) {
		return c.json({ error: "No tienes permiso para correr este job" }, 403);
	}
	const resumen = await refreshPremoraElegibilidad();
	return c.json({ success: true, resumen });
});

// ═══════════════════════════════════════════════════════════════════════════
// TAREAS PROGRAMADAS
//
// Con `DISABLE_SCHEDULED_JOBS=true` el proceso levanta SOLO la API, sin ningún
// job. Sirve para las instancias que exponen la API a un integrador (hoy el bot
// de WhatsApp de cobros) sin duplicar el trabajo de la instancia principal.
//
// No es un detalle menor: varios de estos jobs LE ESCRIBEN A CLIENTES
// (`sendPremoraReminders` a los 15 s del arranque, `sendConvenioReminders` a
// los 20 s). Una segunda instancia apuntando a una copia de producción les
// mandaría recordatorios de verdad.
//
// Ver docs/features/bot-whatsapp-cobros/despliegue-dev.md
// ═══════════════════════════════════════════════════════════════════════════
//
//   🚨 FIXME(COBROS-02): REVERTIR ESTA LÍNEA ANTES DE MERGEAR A DEVELOP 🚨
//
//   Está en `false` FIJO, no por variable de entorno: en esta rama el binario
//   solo sirve la API para el bot de WhatsApp, y depender de que la env esté
//   bien puesta en el ambiente era demasiado frágil para el riesgo que corre
//   (le escribe a clientes reales).
//
//   Si esta rama se mergea así, el CRM de producción se queda SIN NINGUNA
//   tarea programada: recordatorios premora, convenios, alertas de cobros,
//   sincronización de promesas y cierre diario. Y no se nota al desplegar:
//   se nota cuando los clientes dejan de recibir sus recordatorios.
//
//   Para revertir: poner de vuelta
//   `process.env.DISABLE_SCHEDULED_JOBS !== "true"` y dejar la env en `true`
//   solo en la instancia del bot.
//
// ═══════════════════════════════════════════════════════════════════════════
const TAREAS_PROGRAMADAS_ACTIVAS = false;

if (!TAREAS_PROGRAMADAS_ACTIVAS) {
	console.warn(
		"[Jobs] ⚠️  Tareas programadas DESACTIVADAS en el código (rama COBROS-02): esta instancia levanta solo la API. Si ves esto en el CRM principal, el FIXME de index.ts llegó a producción.",
	);
}

// ═══════════════════════════════════════════════════════════════════════════
// La purga de boletas del bot va FUERA del bloque de arriba, a propósito.
//
// No es un job de negocio: es una obligación de retención. Esas filas guardan
// la URL de origen del cliente, a qué lead pertenece, el hash de su imagen y la
// extracción cruda del modelo, y el contrato les da 7 días. Dejarla adentro del
// `if` la volvía decorativa —la bandera está en `false` en esta rama— y la PII
// se quedaba para siempre.
//
// Es seguro que corra siempre: solo borra filas de este feature que nunca
// llegaron a ser un pago (ver `bot-cobros-purga.ts`).
// ═══════════════════════════════════════════════════════════════════════════
async function correrPurgaDeBoletas(): Promise<void> {
	try {
		await purgarBoletasSinConfirmar();
	} catch (error) {
		console.error("Error en la purga de boletas del bot:", error);
	}
}

// Una vez al arrancar, y de ahí cada 24 h.
//
// Sin la del arranque, la retención dependía de que el proceso viviera 24 horas
// seguidas: en dev se redespliega varias veces al día, así que el temporizador
// se reiniciaba antes de disparar y los borradores con PII no se borraban NUNCA.
// Un intervalo no es una garantía de retención si el proceso no llega a cumplirlo.
void correrPurgaDeBoletas();
setInterval(correrPurgaDeBoletas, 24 * 60 * 60 * 1000);

// ═══════════════════════════════════════════════════════════════════════════
// La reconciliación de confirmaciones colgadas va FUERA por la misma razón.
//
// Del otro lado hay un cliente cuyo pago quedó en el aire: no sabemos si se
// registró, así que no puede reintentar ni recibir una respuesta. Dejar esto
// atado a la bandera de tareas programadas —hoy en `false`— significaría que en
// esta rama nadie lo destraba nunca.
//
// Solo lee de cartera y actualiza el borrador; jamás reintenta el pago.
// Ver 04-validacion-de-boleta.md §4.1.
// ═══════════════════════════════════════════════════════════════════════════
async function correrReconciliacionDeBoletas(): Promise<void> {
	try {
		await reconciliarBoletasColgadas();
	} catch (error) {
		console.error("Error en la reconciliación de boletas del bot:", error);
	}
}

setInterval(correrReconciliacionDeBoletas, 5 * 60 * 1000);

// El respaldo del rechazo (D-39), también fuera de la bandera: si el WhatsApp
// del rechazo falló, el cliente sigue creyendo que su pago va bien. Cada hora
// se barren las boletas rechazadas a las que se les debe el mensaje.
async function correrRespaldoDeRechazos(): Promise<void> {
	try {
		await reintentarAvisosDeRechazo();
	} catch (error) {
		console.error("Error en el respaldo de rechazos del bot:", error);
	}
}

setInterval(correrRespaldoDeRechazos, 60 * 60 * 1000);

// El poller y el dispatcher de Págalo (CB-028) usan el mismo gate que el
// resto de tareas programadas (`TAREAS_PROGRAMADAS_ACTIVAS`) — ya no tienen
// flags propios (`PAGALO_POLL_ENABLED`/`PAGALO_DISPATCH_ENABLED` se
// eliminaron: el botón manual `probarPollPagalo` y el dispatch inline
// dentro del poll corren siempre, sin ningún gate, decisión explícita del
// usuario). En esta rama (COBROS-02), `TAREAS_PROGRAMADAS_ACTIVAS` está
// hardcodeada en `false` (ver FIXME arriba), así que el ciclo automático de
// Págalo queda apagado junto con el resto de jobs hasta que se revierta ese
// FIXME antes de mergear a develop.
async function correrPollDePagalo(): Promise<void> {
	try {
		await correrPollPagalo();
	} catch (error) {
		console.error("Error en el poller de links Págalo:", error);
	}
}

if (TAREAS_PROGRAMADAS_ACTIVAS) {
	void correrPollDePagalo();
	setInterval(correrPollDePagalo, 5 * 60 * 1000);
}

async function correrDispatchDePagalo(): Promise<void> {
	try {
		await correrDispatchPagalo();
	} catch (error) {
		console.error("Error en el dispatcher de pagos Págalo:", error);
	}
}

if (TAREAS_PROGRAMADAS_ACTIVAS) {
	void correrDispatchDePagalo();
	setInterval(correrDispatchDePagalo, 5 * 60 * 1000);
}

// Recordatorio Págalo (CB-028): mismo gate que poll/dispatch, sin flag propio
// — es notificación al cliente, no integridad financiera, pero corre bajo la
// misma bandera general de tareas programadas. Cada 3h.
async function correrRecordatorioDePagalo(): Promise<void> {
	try {
		await correrRecordatorioPagalo();
	} catch (error) {
		console.error("Error en el recordatorio de pagos Págalo:", error);
	}
}

if (TAREAS_PROGRAMADAS_ACTIVAS) {
	setInterval(correrRecordatorioDePagalo, 3 * 60 * 60 * 1000);
}

if (TAREAS_PROGRAMADAS_ACTIVAS) {
	// checkPromesasPago traga sus propios errores de persistencia por SIFCO
	// (todo-o-nada por lote, ver check-promesas-pago.ts) y siempre resuelve
	// normalmente — nunca rechaza, así que un simple .catch() no detecta que
	// algo falló. Si errores>0, el cierre de snapshot que sigue puede leer
	// contactos_cobros.estado_promesa desactualizado para esos SIFCOs. No se
	// aborta el cierre por esto (cartera-back con fallos intermitentes
	// dejaría el snapshot sin cerrar indefinidamente, peor que un dato
	// puntual stale) — solo se deja rastro explícito para investigar
	// (Codex PR #1330).
	function logSiErroresPromesas(resumen: {
		errores: number;
		evaluadas: number;
	}): void {
		if (resumen.errores > 0) {
			console.error(
				`[AgendaCobrosSnapshot] checkPromesasPago tuvo ${resumen.errores} error(es) de ${resumen.evaluadas} promesas evaluadas; el cierre de snapshot puede leer estado_promesa desactualizado para esos casos.`,
			);
		}
	}

	// Job periódico de notificaciones de cobros (cada hora)
	setInterval(
		async () => {
			try {
				await checkSeguimientosVencidos();
			} catch (error) {
				console.error("Error en job de notificaciones cobros:", error);
			}
		},
		60 * 60 * 1000,
	);

	// Ejecutar una vez al iniciar (con delay de 10s para que la DB esté lista).
	// checkPromesasPago se guarda en una promesa module-level: el catch-up de
	// agenda de cobros (más abajo) la espera antes de cerrar snapshots, mismo
	// motivo que el encadenado del timer normal de medianoche (Codex PR #1330).
	const checkPromesasPagoBoot: Promise<CheckPromesasResumen | void> =
		new Promise((resolve) => {
			setTimeout(() => {
				checkSeguimientosVencidos().catch(console.error);
				procesarSeguimientosRecurrentes().catch(console.error);
				resolve(checkPromesasPago().catch(console.error));
			}, 10_000);
		});

	// Recordatorios Premora (CC2-11): diario a las 8:00 GT (= 14:00 UTC, GT no
	// tiene DST). También corre al boot (abajo): la tabla recordatorios_premora
	// hace idempotente el envío, así que un deploy tardío recupera el batch del
	// día sin duplicar mensajes.
	function scheduleAtPremoraGT() {
		const now = new Date();
		const next = new Date();
		next.setUTCHours(14, 0, 0, 0);
		if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
		setTimeout(async () => {
			await sendPremoraReminders().catch(console.error);
			scheduleAtPremoraGT();
		}, next.getTime() - now.getTime());
	}
	scheduleAtPremoraGT();

	// COBROS-02: recordatorios de CONVENIO, diario a las 8:05 GT (= 14:05 UTC), 5
	// min DESPUÉS del funnel premora — así corren después de la subida de bucket de
	// medianoche (job de cartera) y no compiten con premora. Idempotente
	// (recordatorios_convenio), el run de boot recupera sin duplicar.
	function scheduleAtConvenioGT() {
		const now = new Date();
		const next = new Date();
		next.setUTCHours(14, 5, 0, 0); // 08:05 GT
		if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
		setTimeout(async () => {
			await sendConvenioReminders().catch(console.error);
			scheduleAtConvenioGT();
		}, next.getTime() - now.getTime());
	}
	scheduleAtConvenioGT();

	// Recuperación al boot (deploy tardío): idempotente por los claims.
	setTimeout(() => {
		sendConvenioReminders().catch(console.error);
	}, 20_000);

	// CB-010: elegibilidad de la reducción de recordatorios, diario a las 7:00 GT
	// (= 13:00 UTC) — UNA HORA ANTES del funnel premora, para que la foto de "paga
	// bien" y el auto-revoke queden frescos antes de que se decidan los envíos del
	// día. Idempotente (upsert de la foto + revoca solo configs ya inactivas por
	// segunda vez no reactiva nada), así que el run de boot recupera sin efectos.
	function scheduleAtElegibilidadGT() {
		const now = new Date();
		const next = new Date();
		next.setUTCHours(13, 0, 0, 0); // 07:00 GT
		if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
		setTimeout(async () => {
			await refreshPremoraElegibilidad().catch(console.error);
			scheduleAtElegibilidadGT();
		}, next.getTime() - now.getTime());
	}
	scheduleAtElegibilidadGT();

	// Recuperación al boot (deploy tardío): la elegibilidad se refresca ANTES del
	// envío premora y este ESPERA a que termine (review Codex P2). En el path
	// diario no se solapan (07:00 vs 08:00), pero en el boot ambos se disparan
	// juntos; si premora corriera primero leería reducciones stale y saltaría
	// D-5/D-3/D-1 de un crédito que ya debía auto-revocarse (el WhatsApp perdido no
	// se recupera después). Premora es idempotente (claims), así que re-correr al
	// boot no duplica mensajes.
	setTimeout(async () => {
		await refreshPremoraElegibilidad().catch(console.error);
		await sendPremoraReminders().catch(console.error);
	}, 15_000);

	// COBROS-02: alertas de cobros con propósito (cliente_subido + sin_contacto_3d),
	// diario a las 8:00 GT — DESPUÉS de que la subida de bucket de medianoche ya
	// corrió en cartera, para leer las subidas de anoche. Reemplaza las viejas
	// notificaciones masivas de "sin contacto". Idempotente por su propio dedup, así
	// que el run de boot (abajo) recupera sin duplicar.
	function scheduleAtCobrosAlertasGT() {
		const now = new Date();
		const next = new Date();
		next.setUTCHours(14, 0, 0, 0); // 08:00 GT
		if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
		setTimeout(async () => {
			await checkCobrosAlertas().catch(console.error);
			scheduleAtCobrosAlertasGT();
		}, next.getTime() - now.getTime());
	}
	scheduleAtCobrosAlertasGT();
	// Recuperación al boot SOLO si ya pasaron las 08:00 GT (un deploy tardío recupera
	// el batch del día; el dedup evita duplicar). Antes de las 08:00 GT NO se corre:
	// dispararía las alertas "de las 8am" en medianoche — se deja que el timeout
	// programado las lance a la hora (Codex P2).
	setTimeout(() => {
		const horaGT = (new Date().getUTCHours() + 18) % 24; // GT = UTC-6, sin DST
		if (horaGT >= 8) {
			checkCobrosAlertas().catch(console.error);
		} else {
			console.log(
				"[CobrosAlertas] Boot antes de las 08:00 GT; se omite la recuperación (el timeout programado la lanzará a la hora)",
			);
		}
	}, 20_000);

	// Ejecutar procesarSeguimientosRecurrentes a medianoche GT (00:00 GT = 06:00 UTC) cada día.
	// CB-020: también cierra el día evaluando TODAS las promesas de pago activas
	// (pendiente/incumplida) sin depender de que alguien abra el caso — ver
	// check-promesas-pago.ts.
	//
	// CB-128: el cierre de snapshots de agenda se dispara DESDE ACÁ, después de
	// que checkPromesasPago() resuelve, en vez de un setTimeout independiente a
	// las 00:05 GT — checkPromesasPago hace un getCredito secuencial por SIFCO
	// contra cartera-back y puede tardar más de 5 minutos, y cerrarSnapshotsAgenda
	// lee contactos_cobros.estado_promesa: si corriera en paralelo podría leer
	// una promesa que YA se cumplió pero cuyo estado todavía no se actualizó,
	// perdiendo ese pago para siempre en el snapshot del día (Codex PR #1330).
	//
	// Encadenar DESPUÉS de checkPromesasPago no basta como piso: si hay pocas
	// promesas activas ese día, ese encadenado puede resolver en segundos,
	// capturando bien antes de las 00:05 GT documentadas. `procesarMoras`
	// (recalcula mora, buckets y reasignaciones) corre en cartera-back —
	// proceso EXTERNO, sin endpoint de estado que este CRM pueda consultar —
	// a las 23:59 GT (docs/features/cobros-02/02-motor-y-asignacion.md).
	// Capturar mientras sigue corriendo congela una mezcla de datos viejos y
	// nuevos, y el índice único (fecha_gt, asesor_id) con ON CONFLICT DO
	// NOTHING deja ese snapshot corrupto sin forma de corregirlo después
	// (Codex PR #1331). Sin handshake posible, se agrega un piso mínimo
	// explícito hasta las 00:05 GT, ADEMÁS de esperar checkPromesasPago —
	// no elimina el riesgo (sigue siendo heurístico), pero dejar de confiar
	// en que el encadenado por sí solo tarde lo suficiente.
	function esperarHasta0005GT(): Promise<void> {
		const ahora = new Date();
		const barrera = new Date();
		barrera.setUTCHours(6, 5, 0, 0);
		const faltante = barrera.getTime() - ahora.getTime();
		if (faltante <= 0) return Promise.resolve();
		return new Promise((resolve) => setTimeout(resolve, faltante));
	}
	function scheduleAtMidnightGT() {
		const now = new Date();
		const next = new Date();
		next.setUTCHours(6, 0, 0, 0);
		if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
		setTimeout(async () => {
			await procesarSeguimientosRecurrentes().catch(console.error);
			const resumenPromesas = await checkPromesasPago().catch(console.error);
			if (resumenPromesas) logSiErroresPromesas(resumenPromesas);
			await esperarHasta0005GT();
			await ejecutarAgendaCobrosDiariaConReintentos().catch(console.error);
			scheduleAtMidnightGT();
		}, next.getTime() - now.getTime());
	}
	scheduleAtMidnightGT();

	// CB-030: reconciliación diaria de promesas de pago hacia cartera-back
	// (promesas_pago_espejo), a las 23:30 GT — 29 minutos ANTES de que
	// procesarMoras corra en cartera-back a las 23:59 GT (ver el comentario de
	// schedule.ts en ese repo, citado también en check-cobros-alertas.ts). El
	// push por evento (lib/push-promesa-cartera-back.ts) ya mantiene el espejo
	// fresco en el caso normal; esto es la red de seguridad que corrige drift
	// silencioso ANTES del cálculo que importa. Margen de ~30 min: suficiente
	// para absorber latencia sin arriesgar correr después de las 23:59 GT.
	function scheduleAtSyncPromesasGT() {
		const now = new Date();
		const next = new Date();
		next.setUTCHours(5, 30, 0, 0); // 23:30 GT (GT = UTC-6, sin DST)
		if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
		setTimeout(async () => {
			await sincronizarPromesasCarteraBack().catch(console.error);
			scheduleAtSyncPromesasGT();
		}, next.getTime() - now.getTime());
	}
	scheduleAtSyncPromesasGT();

	// Catch-up de arranque: si el proceso bootea DENTRO de la ventana 23:30–23:59
	// GT (deploy nocturno, reinicio, crash-loop), el schedule de arriba ya empujó
	// el timer a mañana y la reconciliación de ESTA noche nunca correría — pero
	// procesarMoras sí va a correr a las 23:59 con lo que haya en el espejo. Es
	// justo el peor momento para saltarla: un deploy en esa franja es lo que hace
	// más probable que se hayan perdido pushes por evento (Codex PR #1237).
	// Fuera de la ventana no se hace nada: correr el job en cualquier arranque lo
	// convertiría en un efecto secundario del deploy, y el batch declarado como
	// "set completo" no es algo que convenga disparar de más.
	{
		const ahora = new Date();
		const minutosUtc = ahora.getUTCHours() * 60 + ahora.getUTCMinutes();
		const INICIO_VENTANA = 5 * 60 + 30; // 23:30 GT
		const FIN_VENTANA = 5 * 60 + 59; // 23:59 GT (cuando arranca procesarMoras)
		if (minutosUtc >= INICIO_VENTANA && minutosUtc < FIN_VENTANA) {
			console.log(
				"[SyncPromesasCarteraBack] Arranque dentro de la ventana 23:30–23:59 GT: ejecutando reconciliación de catch-up antes de procesarMoras.",
			);
			sincronizarPromesasCarteraBack().catch(console.error);
		}
	}

	// CB-024: cierre diario de asesores — snapshot de gestión (contactos
	// efectivos manuales, promesas, movimientos de bucket) a las 00:15 GT
	// (= 06:15 UTC) todos los días, del día que ACABA DE TERMINAR (ayer GT).
	//
	// NO a las 22:00 GT: los movimientos de bucket los genera `procesarMoras` en
	// cartera-back a las 23:59 GT (schedule.ts:37 de ese repo) — correr antes
	// significa preguntar por el día de hoy ANTES de que esas filas existan, y
	// como el job nunca vuelve a visitar un día ya cerrado, esos movimientos se
	// pierden para siempre, todos los días (hallado por Codex en PR #1183).
	//
	// Re-correr el mismo día es seguro: los contactos van con ON CONFLICT DO
	// NOTHING y los movimientos se reemplazan completos (DELETE + INSERT), así
	// que un deploy tardío recupera el snapshot del día sin duplicar.
	function ayerGT(): string {
		return toDateStrGT(new Date(Date.now() - 24 * 60 * 60 * 1000));
	}
	function scheduleAtCierreDiarioGT() {
		const now = new Date();
		const next = new Date();
		next.setUTCHours(6, 15, 0, 0); // 00:15 GT
		if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
		setTimeout(async () => {
			await generarCierreDiario(ayerGT()).catch(console.error);
			scheduleAtCierreDiarioGT();
		}, next.getTime() - now.getTime());
	}
	scheduleAtCierreDiarioGT();
	// Recuperación al boot SOLO si ya pasaron las 00:15 GT (deploy tardío recupera
	// el snapshot de ayer; re-correr no duplica, ver arriba). Antes de las 00:15
	// GT NO se corre: se deja que el timeout programado lo lance a la hora.
	setTimeout(() => {
		const bootNow = new Date();
		const horaGT = (bootNow.getUTCHours() + 18) % 24; // GT = UTC-6, sin DST
		const minutoGT = bootNow.getUTCMinutes();
		if (horaGT > 0 || (horaGT === 0 && minutoGT >= 15)) {
			generarCierreDiario(ayerGT()).catch(console.error);
		} else {
			console.log(
				"[CierreDiarioAsesor] Boot antes de las 00:15 GT; se omite la recuperación (el timeout programado lo lanzará a la hora)",
			);
		}
	}, 25_000);

	// Snapshot de cumplimiento de Agenda: se dispara desde scheduleAtMidnightGT
	// (arriba), encadenado DESPUÉS de checkPromesasPago — no tiene timer propio
	// a las 00:05 GT (ver comentario ahí sobre por qué el margen fijo no
	// alcanza). Cierra ayer completo y después congela D-0 de hoy (solo cuotas
	// que vencen HOY, no D0-D5 — ver obtenerAgendaAsesor en
	// agenda-cobros-source.ts). Advisory lock + constraints únicos hacen
	// seguros timer, reinicio y múltiples instancias.

	// Catch-up del mismo día tras deploy/reinicio posterior a 00:05 GT. No hace
	// backfill: solo reintenta cierre de ayer y captura de hoy; snapshots ya
	// existentes permanecen congelados. Es independiente del encadenado de
	// arriba porque en un boot tardío scheduleAtMidnightGT nunca corrió en ESTA
	// instancia del proceso.
	//
	// Espera checkPromesasPagoBoot antes de correr: mismo race que el timer
	// normal (checkPromesasPago puede tardar minutos con su loop secuencial
	// contra cartera-back), pero acá el catch-up y el checkPromesasPago de
	// boot tenían delays independientes (30s vs 10s) y podían solaparse
	// (Codex PR #1330).
	//
	// Si el boot cae EXACTO entre 00:00 y 00:04:59 GT, scheduleAtMidnightGT ya
	// movió su timer a mañana (next <= now) y este catch-up, sin más, se
	// hubiera quedado callado hasta el próximo boot — perdiendo cierre de ayer
	// Y captura de hoy por un día entero. Reusa esperarHasta0005GT() (mismo
	// piso que el timer normal) en vez de una condición de hora manual: un
	// boot en cualquier otro momento del día (p. ej. 23:00 GT, mientras
	// procesarMoras todavía no corrió) NO debe capturar de inmediato — debe
	// esperar a la próxima barrera de 00:05 GT como cualquier otra corrida.
	//
	// Si el boot ocurrió ANTES de medianoche GT, checkPromesasPagoBoot quedó
	// resuelta horas antes del cierre (p. ej. boot 20:00 GT → promesa resuelta
	// 20:00:10) y scheduleAtMidnightGT SÍ va a correr su propio
	// checkPromesasPago() fresco a las 00:00 GT — pero ambos callbacks
	// convergen cerca de las 00:05 GT y compiten por el mismo advisory lock en
	// ejecutarAgendaCobrosDiaria; si este catch-up ganara el lock, cerraría el
	// snapshot con la reconciliación stale del boot, perdiendo pagos/promesas
	// resueltos entre el boot y medianoche (Codex PR #1331). Por eso, si el
	// boot fue antes de medianoche, se descarta checkPromesasPagoBoot para el
	// cierre y se corre un checkPromesasPago() nuevo DESPUÉS de la barrera.
	const bootAntesDeMedianocheGT = (() => {
		const ahora = new Date();
		const proximaMedianocheGT = new Date();
		proximaMedianocheGT.setUTCHours(6, 0, 0, 0);
		return proximaMedianocheGT > ahora;
	})();
	setTimeout(async () => {
		await checkPromesasPagoBoot;
		await esperarHasta0005GT();
		const resumenPromesas = bootAntesDeMedianocheGT
			? await checkPromesasPago().catch(console.error)
			: await checkPromesasPagoBoot;
		if (resumenPromesas) logSiErroresPromesas(resumenPromesas);
		await ejecutarAgendaCobrosDiariaConReintentos().catch(console.error);
	}, 30_000);
}

export default {
	port: process.env.PORT || 3000,
	fetch: app.fetch,
};
