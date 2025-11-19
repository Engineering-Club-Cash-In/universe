import "dotenv/config";
import { RPCHandler } from "@orpc/server/fetch";
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
import { processCsvLeads } from "./controllers/csv";
import { livenessController } from "./controllers/liveness";
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

			// Permitir subdominios de devteamatcci.site (wildcard)
			if (origin?.match(/^https?:\/\/.*\.devteamatcci\.site$/)) {
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

		// Only admin and sales can upload documents
		if (!["admin", "sales"].includes(userRole)) {
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
	} catch (err: unknown) {
		console.error("[ERROR] /test/renap:", err);
		const message = err instanceof Error ? err.message : "Internal server error";
		return c.json({ error: message }, 500);
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
	} catch (err: unknown) {
		console.error("[ERROR] /info/lead-opportunity:", err);
		const message = err instanceof Error ? err.message : "Internal server error";
		return c.json({ error: message }, 500);
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
	} catch (err: unknown) {
		console.error("[ERROR] /info/lead-progress:", err);
		const message = err instanceof Error ? err.message : "Internal server error";
		return c.json(
			{ success: false, message },
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

app.post("/info/liveness-validation", async (c) => {
	const body = await c.req.json();
	const { dpi } = body as { dpi?: string };

	if (!dpi) {
		return c.json({ success: false, message: "DPI is required" }, 400);
	}

	try {
		const result = await hasPassedLiveness(dpi); // 👈 usamos el método que ya hicimos

		return c.json(
			{
				success: true,
				dpi,
				livenessValidated: result,
			},
			200,
		);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : "Internal server error";
		return c.json(
			{
				success: false,
				message,
			},
			500,
		);
	}
});
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
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : "Internal server error";
		return c.json(
			{ success: false, message },
			500,
		);
	}
});
app.get("/upload-csv", async (c) => {
	try {
		const result = await processCsvLeads();
		return c.json(result);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : "Error processing CSV";
		return c.json({ error: message }, 500);
	}
});

export default app;
