import { eq } from "drizzle-orm";
import { db } from "../db";
import {
	analysisChecklists,
	opportunities,
	opportunityDocuments,
} from "../db/schema";

type ChecklistItem = {
	documentType: string;
	required: boolean;
	uploaded: boolean;
	documentId?: string;
};

type VerificationItem = { required: boolean; completed: boolean };

export type ChecklistData = {
	sections: {
		documentos: { items: ChecklistItem[]; completed: boolean };
		verificaciones: { items: VerificationItem[]; completed: boolean };
		vehiculo?: {
			inspected?: boolean;
			completed?: boolean;
			documentos?: { items: ChecklistItem[]; completed: boolean };
			verificaciones?: { items: VerificationItem[]; completed: boolean };
		};
	};
	overallProgress: number;
	canApprove: boolean;
};

export function rebuildClientDocumentChecklistData(
	checklistData: ChecklistData,
	currentDocuments: Array<{
		id: string;
		documentType: string;
		description: string | null;
	}>,
	hasVehicle: boolean,
): boolean {
	const currentDocumentsByType = new Map<string, string>(
		currentDocuments
			.filter(
				(document) =>
					!document.description?.startsWith("[bank-coverage-debt:") &&
					!document.description?.startsWith("[manual-bank-debt:"),
			)
			.map((document) => [document.documentType, document.id]),
	);
	const hasClientDocumentSection = checklistData.sections.documentos.items.length > 0;
	if (!hasClientDocumentSection) return false;
	for (const item of checklistData.sections.documentos.items) {
		const currentDocumentId = currentDocumentsByType.get(item.documentType);
		item.uploaded = !!currentDocumentId;
		item.documentId = currentDocumentId;
	}
	checklistData.sections.documentos.completed =
		checklistData.sections.documentos.items
			.filter((item) => item.required)
			.every((item) => item.uploaded);
	const totalItems =
		checklistData.sections.documentos.items.length +
		checklistData.sections.verificaciones.items.filter((item) => item.required)
			.length +
		(hasVehicle ? 1 : 0) +
		(hasVehicle && checklistData.sections.vehiculo?.documentos
			? checklistData.sections.vehiculo.documentos.items.length
			: 0) +
		(hasVehicle && checklistData.sections.vehiculo?.verificaciones
			? checklistData.sections.vehiculo.verificaciones.items.filter(
					(item) => item.required,
				).length
			: 0);
	const completedItems =
		checklistData.sections.documentos.items.filter((item) => item.uploaded)
			.length +
		checklistData.sections.verificaciones.items.filter(
			(item) => item.required && item.completed,
		).length +
		(hasVehicle && checklistData.sections.vehiculo?.inspected ? 1 : 0) +
		(hasVehicle && checklistData.sections.vehiculo?.documentos
			? checklistData.sections.vehiculo.documentos.items.filter(
					(item) => item.uploaded,
				).length
			: 0) +
		(hasVehicle && checklistData.sections.vehiculo?.verificaciones
			? checklistData.sections.vehiculo.verificaciones.items.filter(
					(item) => item.required && item.completed,
				).length
			: 0);
	checklistData.overallProgress = Math.round(
		(completedItems / totalItems) * 100,
	);
	checklistData.canApprove =
		checklistData.sections.documentos.completed &&
		checklistData.sections.verificaciones.completed &&
		(hasVehicle ? (checklistData.sections.vehiculo?.completed ?? false) : true);
	return true;
}

type ChecklistTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function rebuildClientDocumentChecklistInTransaction(
	tx: ChecklistTransaction,
	opportunityId: string,
	hasVehicle: boolean,
) {
	const [checklist] = await tx
		.select()
		.from(analysisChecklists)
		.where(eq(analysisChecklists.opportunityId, opportunityId))
		.limit(1);
	if (!checklist) return;
	const currentDocuments = await tx
		.select({
			id: opportunityDocuments.id,
			documentType: opportunityDocuments.documentType,
			description: opportunityDocuments.description,
		})
		.from(opportunityDocuments)
		.where(eq(opportunityDocuments.opportunityId, opportunityId));
	const checklistData = checklist.checklistData as ChecklistData;
	rebuildClientDocumentChecklistData(
		checklistData,
		currentDocuments,
		hasVehicle,
	);
	await tx
		.update(analysisChecklists)
		.set({ checklistData, updatedAt: new Date() })
		.where(eq(analysisChecklists.opportunityId, opportunityId));
}

/** Rebuilds client document state from the database and propagates failures. */
export async function refreshChecklistForClientDocuments(
	opportunityId: string,
	documentType: string,
	documentId: string,
	hasVehicle: boolean,
	vehicleId?: string,
) {
	const [existing] = await db
		.select()
		.from(analysisChecklists)
		.where(eq(analysisChecklists.opportunityId, opportunityId))
		.limit(1);
	if (!existing) return;

	const checklistData = existing.checklistData as ChecklistData;
	const currentDocuments = await db
		.select({
			id: opportunityDocuments.id,
			documentType: opportunityDocuments.documentType,
			description: opportunityDocuments.description,
		})
		.from(opportunityDocuments)
		.where(eq(opportunityDocuments.opportunityId, opportunityId));
	const docItem = checklistData.sections.documentos.items.find(
		(item) => item.documentType === documentType,
	);
	if (!docItem) {
		if (hasVehicle && vehicleId) {
			await updateChecklistForVehicleDocument(
				vehicleId,
				documentType,
				documentId,
			);
		}
		return;
	}
	rebuildClientDocumentChecklistData(
		checklistData,
		currentDocuments,
		hasVehicle,
	);

	await db
		.update(analysisChecklists)
		.set({ checklistData, updatedAt: new Date() })
		.where(eq(analysisChecklists.opportunityId, opportunityId));
}

/** Updates the analysis checklist when a client document is uploaded. */
export async function updateChecklistForClientDocument(
	opportunityId: string,
	documentType: string,
	documentId: string,
	hasVehicle: boolean,
	vehicleId?: string,
) {
	try {
		await refreshChecklistForClientDocuments(
			opportunityId,
			documentType,
			documentId,
			hasVehicle,
			vehicleId,
		);
	} catch (error) {
		console.log(
			"Could not update analysis checklist for client document (this is OK if it doesn't exist):",
			error,
		);
	}
}

/**
 * Updates the analysis checklist when a vehicle document is uploaded
 */
export async function updateChecklistForVehicleDocument(
	vehicleId: string,
	documentType: string,
	documentId: string,
) {
	try {
		console.log("Updating checklist for vehicle document:", {
			vehicleId,
			documentType,
			documentId,
		});

		// Find ALL opportunities for this vehicle
		const opportunitiesWithVehicle = await db
			.select({
				id: opportunities.id,
				vehicleId: opportunities.vehicleId,
			})
			.from(opportunities)
			.where(eq(opportunities.vehicleId, vehicleId));

		console.log(
			`Found ${opportunitiesWithVehicle.length} opportunities for vehicle:`,
			opportunitiesWithVehicle,
		);

		if (opportunitiesWithVehicle.length === 0) {
			return; // No opportunities for this vehicle, that's OK
		}

		// Update checklist for each opportunity
		for (const opportunity of opportunitiesWithVehicle) {
			try {
				// Get existing checklist for this opportunity
				const [existing] = await db
					.select()
					.from(analysisChecklists)
					.where(eq(analysisChecklists.opportunityId, opportunity.id))
					.limit(1);

				console.log(
					`Found existing checklist for opportunity ${opportunity.id}:`,
					existing ? "YES" : "NO",
				);

				if (!existing) {
					continue; // Checklist doesn't exist yet for this opportunity, skip it
				}

				const checklistData = existing.checklistData as any;

				// Check if vehicle section exists
				if (!checklistData.sections.vehiculo?.documentos) {
					continue; // Vehicle documents section doesn't exist, skip it
				}

				// Find the document item in the vehiculo.documentos section
				const docItem = checklistData.sections.vehiculo.documentos.items.find(
					(i: any) => i.documentType === documentType,
				);

				if (!docItem) {
					continue; // Document type not in checklist, skip it
				}

				// Mark as uploaded and add the documentId
				docItem.uploaded = true;
				docItem.documentId = documentId;

				// Recalculate vehiculo.documentos section completion
				checklistData.sections.vehiculo.documentos.completed =
					checklistData.sections.vehiculo.documentos.items
						.filter((i: any) => i.required)
						.every((i: any) => i.uploaded);

				// Recalculate vehiculo section completion (needs docs + verifications + inspection)
				const vehicleInspected =
					checklistData.sections.vehiculo?.inspected ?? false;
				checklistData.sections.vehiculo.completed =
					vehicleInspected &&
					checklistData.sections.vehiculo.documentos.completed &&
					(checklistData.sections.vehiculo.verificaciones?.completed ?? false);

				// Recalculate overall progress
				const totalItems =
					checklistData.sections.documentos.items.length + // client docs
					checklistData.sections.verificaciones.items.filter(
						(i: any) => i.required,
					).length + // client verifications
					1 + // vehicle inspection
					checklistData.sections.vehiculo.documentos.items.length + // vehicle docs
					(checklistData.sections.vehiculo.verificaciones
						? checklistData.sections.vehiculo.verificaciones.items.filter(
								(i: any) => i.required,
							).length
						: 0); // vehicle verifications

				const completedItems =
					checklistData.sections.documentos.items.filter((i: any) => i.uploaded)
						.length + // client docs uploaded
					checklistData.sections.verificaciones.items.filter(
						(i: any) => i.required && i.completed,
					).length + // client verifications completed
					(vehicleInspected ? 1 : 0) + // vehicle inspection
					checklistData.sections.vehiculo.documentos.items.filter(
						(i: any) => i.uploaded,
					).length + // vehicle docs uploaded
					(checklistData.sections.vehiculo.verificaciones
						? checklistData.sections.vehiculo.verificaciones.items.filter(
								(i: any) => i.required && i.completed,
							).length
						: 0); // vehicle verifications completed

				checklistData.overallProgress = Math.round(
					(completedItems / totalItems) * 100,
				);

				// Recalculate canApprove
				checklistData.canApprove =
					checklistData.sections.documentos.completed &&
					checklistData.sections.verificaciones.completed &&
					(checklistData.sections.vehiculo?.completed ?? false);

				// Update the checklist
				await db
					.update(analysisChecklists)
					.set({
						checklistData,
						updatedAt: new Date(),
					})
					.where(eq(analysisChecklists.opportunityId, opportunity.id));

				console.log(
					`Updated checklist for opportunity ${opportunity.id} successfully`,
				);
			} catch (oppError) {
				// Log error for this specific opportunity but continue with others
				console.log(
					`Error updating checklist for opportunity ${opportunity.id}:`,
					oppError,
				);
			}
		}
	} catch (error) {
		// Silently ignore errors
		console.log(
			"Could not update analysis checklist for vehicle document (this is OK if it doesn't exist):",
			error,
		);
	}
}
