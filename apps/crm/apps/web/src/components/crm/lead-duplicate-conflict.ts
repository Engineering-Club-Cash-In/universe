import { z } from "zod";

const leadDuplicateConflictSchema = z.object({
	reason: z.literal("DUPLICATE_DPI"),
	leadId: z.string(),
	leadName: z.string(),
	isActive: z.boolean(),
	assignedToName: z.string(),
	assignedToCurrentUser: z.boolean(),
});

export type LeadDuplicateConflict = z.infer<
	typeof leadDuplicateConflictSchema
>;

export function getLeadDuplicateConflict(
	error: unknown,
): LeadDuplicateConflict | null {
	const parsedError = z
		.object({ code: z.literal("CONFLICT"), data: leadDuplicateConflictSchema })
		.safeParse(error);
	return parsedError.success ? parsedError.data.data : null;
}

export function getLeadDuplicatePresentation(
	conflict: LeadDuplicateConflict,
) {
	return {
		status: conflict.isActive ? "Activo" : "Inactivo",
		assignment: conflict.assignedToCurrentUser
			? "Este lead está asignado a ti."
			: "Este lead está asignado a otra persona.",
		canViewLead: conflict.assignedToCurrentUser,
	};
}
