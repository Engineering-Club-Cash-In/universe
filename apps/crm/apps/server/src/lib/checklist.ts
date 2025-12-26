import { eq } from "drizzle-orm";
import { db } from "../db";
import { analysisChecklists, opportunities } from "../db/schema";

/**
 * Updates the analysis checklist when a client document is uploaded
 */
export async function updateChecklistForClientDocument(
  opportunityId: string,
  documentType: string,
  documentId: string,
  hasVehicle: boolean,
  vehicleId?: string
) {
  try {
    // Get existing checklist
    const [existing] = await db
      .select()
      .from(analysisChecklists)
      .where(eq(analysisChecklists.opportunityId, opportunityId))
      .limit(1);

    if (!existing) {
      return; // Checklist doesn't exist yet, that's OK
    }

    console.log("Existing checklist found:", existing.id);

    const checklistData = existing.checklistData as any;

    // Find the document item in the documentos section
    const docItem = checklistData.sections.documentos.items.find(
      (i: any) => i.documentType === documentType
    );

    console.log(
      "Document item found in checklist:",
      docItem,
      documentType,
      documentId
    );

    if (!docItem) {
      // if have a vehicle section
      if (hasVehicle && vehicleId) {
        await updateChecklistForVehicleDocument(
          vehicleId,
          documentType,
          documentId
        );
      }
      return; // Document type not in checklist, that's OK
    }

    // Mark as uploaded and add the documentId
    docItem.uploaded = true;
    docItem.documentId = documentId;

    // Recalculate documentos section completion
    checklistData.sections.documentos.completed =
      checklistData.sections.documentos.items
        .filter((i: any) => i.required)
        .every((i: any) => i.uploaded);

    // Recalculate overall progress
    const totalItems =
      checklistData.sections.documentos.items.length + // client docs
      checklistData.sections.verificaciones.items.filter((i: any) => i.required)
        .length + // client verifications
      (hasVehicle ? 1 : 0) + // vehicle inspection
      (hasVehicle && checklistData.sections.vehiculo?.documentos
        ? checklistData.sections.vehiculo.documentos.items.length
        : 0) + // vehicle docs
      (hasVehicle && checklistData.sections.vehiculo?.verificaciones
        ? checklistData.sections.vehiculo.verificaciones.items.filter(
            (i: any) => i.required
          ).length
        : 0); // vehicle verifications

    const completedItems =
      checklistData.sections.documentos.items.filter((i: any) => i.uploaded)
        .length + // client docs uploaded
      checklistData.sections.verificaciones.items.filter(
        (i: any) => i.required && i.completed
      ).length + // client verifications completed
      (hasVehicle && checklistData.sections.vehiculo?.inspected ? 1 : 0) + // vehicle inspection
      (hasVehicle && checklistData.sections.vehiculo?.documentos
        ? checklistData.sections.vehiculo.documentos.items.filter(
            (i: any) => i.uploaded
          ).length
        : 0) + // vehicle docs uploaded
      (hasVehicle && checklistData.sections.vehiculo?.verificaciones
        ? checklistData.sections.vehiculo.verificaciones.items.filter(
            (i: any) => i.required && i.completed
          ).length
        : 0); // vehicle verifications completed

    checklistData.overallProgress = Math.round(
      (completedItems / totalItems) * 100
    );

    // Recalculate canApprove
    checklistData.canApprove =
      checklistData.sections.documentos.completed &&
      checklistData.sections.verificaciones.completed &&
      (hasVehicle
        ? (checklistData.sections.vehiculo?.completed ?? false)
        : true);

    // Update the checklist
    await db
      .update(analysisChecklists)
      .set({
        checklistData,
        updatedAt: new Date(),
      })
      .where(eq(analysisChecklists.opportunityId, opportunityId));
  } catch (error) {
    // Silently ignore errors
    console.log(
      "Could not update analysis checklist for client document (this is OK if it doesn't exist):",
      error
    );
  }
}

/**
 * Updates the analysis checklist when a vehicle document is uploaded
 */
export async function updateChecklistForVehicleDocument(
  vehicleId: string,
  documentType: string,
  documentId: string
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
      opportunitiesWithVehicle
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
          existing ? "YES" : "NO"
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
          (i: any) => i.documentType === documentType
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
            (i: any) => i.required
          ).length + // client verifications
          1 + // vehicle inspection
          checklistData.sections.vehiculo.documentos.items.length + // vehicle docs
          (checklistData.sections.vehiculo.verificaciones
            ? checklistData.sections.vehiculo.verificaciones.items.filter(
                (i: any) => i.required
              ).length
            : 0); // vehicle verifications

        const completedItems =
          checklistData.sections.documentos.items.filter((i: any) => i.uploaded)
            .length + // client docs uploaded
          checklistData.sections.verificaciones.items.filter(
            (i: any) => i.required && i.completed
          ).length + // client verifications completed
          (vehicleInspected ? 1 : 0) + // vehicle inspection
          checklistData.sections.vehiculo.documentos.items.filter(
            (i: any) => i.uploaded
          ).length + // vehicle docs uploaded
          (checklistData.sections.vehiculo.verificaciones
            ? checklistData.sections.vehiculo.verificaciones.items.filter(
                (i: any) => i.required && i.completed
              ).length
            : 0); // vehicle verifications completed

        checklistData.overallProgress = Math.round(
          (completedItems / totalItems) * 100
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
          `Updated checklist for opportunity ${opportunity.id} successfully`
        );
      } catch (oppError) {
        // Log error for this specific opportunity but continue with others
        console.log(
          `Error updating checklist for opportunity ${opportunity.id}:`,
          oppError
        );
      }
    }
  } catch (error) {
    // Silently ignore errors
    console.log(
      "Could not update analysis checklist for vehicle document (this is OK if it doesn't exist):",
      error
    );
  }
}
