import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { entityNotes } from "../db/schema";
import { crmProcedure } from "../lib/orpc";

export const notesRouter = {
	// Obtener notas de una entidad
	getEntityNotes: crmProcedure
		.input(
			z.object({
				entityType: z.enum([
					"lead",
					"opportunity",
					"client",
					"company",
					"vehicle",
					"vendor",
					"contract",
					"collection_case",
				]),
				entityId: z.string().uuid(),
			}),
		)
		.handler(async ({ input }) => {
			const notes = await db
				.select({
					id: entityNotes.id,
					content: entityNotes.content,
					noteType: entityNotes.noteType,
					isPinned: entityNotes.isPinned,
					createdBy: entityNotes.createdBy,
					createdAt: entityNotes.createdAt,
					updatedAt: entityNotes.updatedAt,
					editedBy: entityNotes.editedBy,
				})
				.from(entityNotes)
				.where(
					and(
						eq(entityNotes.entityType, input.entityType),
						eq(entityNotes.entityId, input.entityId),
						eq(entityNotes.isDeleted, false),
					),
				)
				.orderBy(desc(entityNotes.isPinned), desc(entityNotes.createdAt));

			return notes;
		}),

	// Crear una nueva nota
	createNote: crmProcedure
		.input(
			z.object({
				entityType: z.enum([
					"lead",
					"opportunity",
					"client",
					"company",
					"vehicle",
					"vendor",
					"contract",
					"collection_case",
				]),
				entityId: z.string().uuid(),
				content: z
					.string()
					.min(1, "El contenido de la nota no puede estar vacío"),
				noteType: z
					.enum(["general", "follow_up", "important", "internal"])
					.default("general"),
				isPinned: z.boolean().default(false),
			}),
		)
		.handler(async ({ input, context }) => {
			const [note] = await db
				.insert(entityNotes)
				.values({
					entityType: input.entityType,
					entityId: input.entityId,
					content: input.content,
					noteType: input.noteType,
					isPinned: input.isPinned,
					createdBy: context.userId,
				})
				.returning();

			return note;
		}),

	// Actualizar una nota
	updateNote: crmProcedure
		.input(
			z.object({
				noteId: z.string().uuid(),
				content: z
					.string()
					.min(1, "El contenido de la nota no puede estar vacío"),
				noteType: z
					.enum(["general", "follow_up", "important", "internal"])
					.optional(),
				isPinned: z.boolean().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const [note] = await db
				.update(entityNotes)
				.set({
					content: input.content,
					noteType: input.noteType,
					isPinned: input.isPinned,
					updatedAt: new Date(),
					editedBy: context.userId,
				})
				.where(eq(entityNotes.id, input.noteId))
				.returning();

			return note;
		}),

	// Alternar pin de una nota
	togglePinNote: crmProcedure
		.input(
			z.object({
				noteId: z.string().uuid(),
				isPinned: z.boolean(),
			}),
		)
		.handler(async ({ input, context }) => {
			const [note] = await db
				.update(entityNotes)
				.set({
					isPinned: input.isPinned,
					updatedAt: new Date(),
					editedBy: context.userId,
				})
				.where(eq(entityNotes.id, input.noteId))
				.returning();

			return note;
		}),

	// Eliminar una nota (soft delete)
	deleteNote: crmProcedure
		.input(
			z.object({
				noteId: z.string().uuid(),
			}),
		)
		.handler(async ({ input, context }) => {
			const [note] = await db
				.update(entityNotes)
				.set({
					isDeleted: true,
					deletedBy: context.userId,
					deletedAt: new Date(),
				})
				.where(eq(entityNotes.id, input.noteId))
				.returning();

			return note;
		}),
};
