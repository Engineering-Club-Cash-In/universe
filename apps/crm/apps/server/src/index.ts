import "dotenv/config";
import { RPCHandler } from "@orpc/server/fetch";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { auth } from "./lib/auth";
import { createContext } from "./lib/context";
import { appRouter } from "./routers/index";

const app = new Hono();

app.use(logger());
app.use(
	"/*",
	cors({
		origin: process.env.CORS_ORIGIN || "",
		allowMethods: ["GET", "POST", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization"],
		credentials: true,
	}),
);

app.on(["POST", "GET"], "/api/auth/**", (c) => auth.handler(c.req.raw));

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
		const { validateFile, generateUniqueFilename, uploadFileToR2 } = await import("./lib/storage");

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
		if (
			userRole === "sales" &&
			opportunity[0].assignedTo !== userId
		) {
			return c.json({ error: "No tienes permiso para subir documentos a esta oportunidad" }, 403);
		}

		// Validate file
		const validation = validateFile(file);
		if (!validation.valid) {
			return c.json({ error: validation.error }, 400);
		}

		// Generate unique filename
		const uniqueFilename = generateUniqueFilename(file.name);

		// Upload to R2
		const { key } = await uploadFileToR2(
			file,
			uniqueFilename,
			opportunityId
		);

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

export default app;
