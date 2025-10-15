import {
	boolean,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uuid,
	integer,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { user } from "./auth";

// Enums for notes
export const entityTypeEnum = pgEnum("entity_type", [
	"lead",
	"opportunity",
	"client",
	"company",
	"vehicle",
	"vendor",
	"contract",
	"collection_case",
]);

export const noteTypeEnum = pgEnum("note_type", [
	"general",
	"follow_up",
	"important",
	"internal",
]);

// Entity Notes table - Unified notes system for all entities
export const entityNotes = pgTable("entity_notes", {
	id: uuid("id").primaryKey().defaultRandom(),

	// Entity reference (polymorphic)
	entityType: entityTypeEnum("entity_type").notNull(),
	entityId: uuid("entity_id").notNull(),

	// Note content
	content: text("content").notNull(),
	noteType: noteTypeEnum("note_type").notNull().default("general"),

	// Pinning
	isPinned: boolean("is_pinned").notNull().default(false),

	// Authorship and timestamps
	createdBy: text("created_by")
		.notNull()
		.references(() => user.id),
	createdAt: timestamp("created_at").notNull().defaultNow(),

	// Edit tracking
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
	editedBy: text("edited_by").references(() => user.id),

	// Soft delete
	isDeleted: boolean("is_deleted").notNull().default(false),
	deletedBy: text("deleted_by").references(() => user.id),
	deletedAt: timestamp("deleted_at"),
});

// Note Attachments table
export const noteAttachments = pgTable("note_attachments", {
	id: uuid("id").primaryKey().defaultRandom(),

	// Reference to the note
	noteId: uuid("note_id")
		.notNull()
		.references(() => entityNotes.id, { onDelete: "cascade" }),

	// File information
	filename: text("filename").notNull(),
	originalName: text("original_name").notNull(),
	mimeType: text("mime_type").notNull(),
	size: integer("size").notNull(), // en bytes
	filePath: text("file_path").notNull(), // R2 key

	// Upload metadata
	uploadedBy: text("uploaded_by")
		.notNull()
		.references(() => user.id),
	uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
});

// Relations
export const entityNotesRelations = relations(entityNotes, ({ one, many }) => ({
	author: one(user, {
		fields: [entityNotes.createdBy],
		references: [user.id],
	}),
	editor: one(user, {
		fields: [entityNotes.editedBy],
		references: [user.id],
	}),
	attachments: many(noteAttachments),
}));

export const noteAttachmentsRelations = relations(noteAttachments, ({ one }) => ({
	note: one(entityNotes, {
		fields: [noteAttachments.noteId],
		references: [entityNotes.id],
	}),
	uploader: one(user, {
		fields: [noteAttachments.uploadedBy],
		references: [user.id],
	}),
}));

// Export types for TypeScript
export type EntityNote = typeof entityNotes.$inferSelect;
export type NewEntityNote = typeof entityNotes.$inferInsert;

export type NoteAttachment = typeof noteAttachments.$inferSelect;
export type NewNoteAttachment = typeof noteAttachments.$inferInsert;
