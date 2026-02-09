import { relations } from "drizzle-orm";
import {
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { user, userRoleEnum } from "./auth";

// Enums
export const notificationStatusEnum = pgEnum("notification_status", [
	"pending",
	"read",
	"in_progress",
	"resolved",
	"dismissed",
]);

export const notificationTypeEnum = pgEnum("notification_type", [
	"aviso",
	"action_upload_files",
	"action_required",
	"reminder",
	"system",
]);

export const notificationEntityTypeEnum = pgEnum("notification_entity_type", [
	"lead",
	"opportunity",
	"vehicle",
	"contract",
	"collection_case",
]);

// Notifications table
export const notifications = pgTable("notifications", {
	id: uuid("id").primaryKey().defaultRandom(),

	titulo: text("titulo").notNull(),
	descripcion: text("descripcion"),

	status: notificationStatusEnum("status").notNull().default("pending"),
	type: notificationTypeEnum("type").notNull(),

	// Creador
	createdBy: text("created_by")
		.notNull()
		.references(() => user.id),
	createdByRole: userRoleEnum("created_by_role").notNull(),

	// Asignación
	assignedToRole: userRoleEnum("assigned_to_role").notNull(),
	assignedTo: text("assigned_to").references(() => user.id),

	// Entidad relacionada (polimórfica)
	relatedEntityType: notificationEntityTypeEnum("related_entity_type"),
	relatedEntityId: uuid("related_entity_id"),

	// Timestamps de estado
	readAt: timestamp("read_at"),
	resolvedAt: timestamp("resolved_at"),

	// Timestamps
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Notification Documents table
export const notificationDocuments = pgTable("notification_documents", {
	id: uuid("id").primaryKey().defaultRandom(),

	notificationId: uuid("notification_id")
		.notNull()
		.references(() => notifications.id, { onDelete: "cascade" }),

	// File information
	filename: text("filename").notNull(),
	originalName: text("original_name").notNull(),
	mimeType: text("mime_type").notNull(),
	size: integer("size").notNull(),
	filePath: text("file_path").notNull(),

	// Upload metadata
	uploadedBy: text("uploaded_by")
		.notNull()
		.references(() => user.id),
	uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
});

// Relations
export const notificationsRelations = relations(
	notifications,
	({ one, many }) => ({
		creator: one(user, {
			fields: [notifications.createdBy],
			references: [user.id],
			relationName: "notificationCreator",
		}),
		assignee: one(user, {
			fields: [notifications.assignedTo],
			references: [user.id],
			relationName: "notificationAssignee",
		}),
		documents: many(notificationDocuments),
	}),
);

export const notificationDocumentsRelations = relations(
	notificationDocuments,
	({ one }) => ({
		notification: one(notifications, {
			fields: [notificationDocuments.notificationId],
			references: [notifications.id],
		}),
		uploader: one(user, {
			fields: [notificationDocuments.uploadedBy],
			references: [user.id],
		}),
	}),
);

// Export types
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

export type NotificationDocument = typeof notificationDocuments.$inferSelect;
export type NewNotificationDocument = typeof notificationDocuments.$inferInsert;
