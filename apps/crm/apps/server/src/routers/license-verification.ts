import { ORPCError } from "@orpc/server";
import { and, desc, eq, getTableColumns, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db } from "../db";
import { coDebtors, leads, opportunities } from "../db/schema/crm";
import { licenseQrVerifications } from "../db/schema/license-verification";
import { runLicenseVerification } from "../lib/license-verification";
import { crmProcedure } from "../lib/orpc";
import {
	buildUploadPrefix,
	getFileBuffer,
	verifyUploadedDocumentInR2,
} from "../lib/storage";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

// Segunda instancia de "opportunities" para llegar a la oportunidad de un
// co-deudor (coDebtors.opportunityId) sin chocar con el join directo de
// licenseQrVerifications.opportunityId.
const coDebtorOpportunities = alias(opportunities, "co_debtor_opportunities");

function buildLeadName(lead: {
	firstName: string;
	middleName: string | null;
	lastName: string;
	secondLastName: string | null;
}): string {
	return [lead.firstName, lead.middleName, lead.lastName, lead.secondLastName]
		.filter((p) => p?.trim())
		.join(" ");
}

export const licenseVerificationRouter = {
	verifyLicenseQr: crmProcedure
		.input(
			z
				.object({
					leadId: z.string().uuid().optional(),
					opportunityId: z.string().uuid().optional(),
					coDebtorId: z.string().uuid().optional(),
					documentKey: z.string().min(1),
					fileName: z.string().min(1),
					mimeType: z.string().default("image/jpeg"),
				})
				.refine((data) => !!data.leadId !== !!data.coDebtorId, {
					message: "Debe proporcionar exactamente leadId o coDebtorId",
				})
				.refine((data) => !data.leadId || !!data.opportunityId, {
					message: "Debe proporcionar opportunityId para verificar un lead",
				})
				.refine((data) => !data.coDebtorId || !data.opportunityId, {
					message:
						"opportunityId no aplica junto con coDebtorId (se toma la oportunidad del co-deudor)",
				}),
		)
		.handler(async ({ input, context }) => {
			const isForLead = !!input.leadId;
			// Recurso que scopea el archivo/verificación: la oportunidad para leads
			// (una licencia se verifica por cada expediente de crédito, no una vez
			// por persona) y el co-deudor para co-deudores (ya está 1:1 con una
			// oportunidad).
			const resourceId = isForLead ? input.opportunityId! : input.coDebtorId!;

			let registeredName: string;

			if (isForLead) {
				const [lead] = await db
					.select({
						firstName: leads.firstName,
						middleName: leads.middleName,
						lastName: leads.lastName,
						secondLastName: leads.secondLastName,
					})
					.from(leads)
					.where(eq(leads.id, input.leadId!))
					.limit(1);

				if (!lead) {
					throw new ORPCError("NOT_FOUND", { message: "Lead no encontrado" });
				}
				registeredName = buildLeadName(lead);

				const [opportunity] = await db
					.select({
						id: opportunities.id,
						leadId: opportunities.leadId,
						assignedTo: opportunities.assignedTo,
					})
					.from(opportunities)
					.where(eq(opportunities.id, input.opportunityId!))
					.limit(1);

				if (!opportunity) {
					throw new ORPCError("NOT_FOUND", {
						message: "Oportunidad no encontrada",
					});
				}
				if (opportunity.leadId !== input.leadId) {
					throw new ORPCError("BAD_REQUEST", {
						message: "La oportunidad no pertenece al lead indicado",
					});
				}
				if (
					context.userRole === "sales" &&
					opportunity.assignedTo !== context.userId
				) {
					throw new ORPCError("FORBIDDEN", {
						message: "No tienes permiso para verificar esta oportunidad",
					});
				}
			} else {
				const [coDebtor] = await db
					.select({
						fullName: coDebtors.fullName,
						opportunityAssignedTo: opportunities.assignedTo,
					})
					.from(coDebtors)
					.leftJoin(opportunities, eq(coDebtors.opportunityId, opportunities.id))
					.where(eq(coDebtors.id, resourceId))
					.limit(1);

				if (!coDebtor) {
					throw new ORPCError("NOT_FOUND", {
						message: "Co-deudor no encontrado",
					});
				}
				if (
					context.userRole === "sales" &&
					coDebtor.opportunityAssignedTo !== context.userId
				) {
					throw new ORPCError("FORBIDDEN", {
						message: "No tienes permiso para verificar este co-deudor",
					});
				}
				registeredName = coDebtor.fullName;
			}

			const expectedPrefix = buildUploadPrefix(
				"license_verification",
				resourceId,
			);
			const uploadedFile = await verifyUploadedDocumentInR2({
				key: input.documentKey,
				expectedPrefix,
				filename: input.fileName,
				mimeType: input.mimeType,
				maxSizeBytes: MAX_FILE_SIZE_BYTES,
			});

			// Mismo filtro que en getUploadPresignedUrl (upload.ts): el decodificador
			// no soporta WebP/AVIF aunque sean "image/*" válidos para otros documentos.
			if (!["image/jpeg", "image/png"].includes(uploadedFile.mimeType)) {
				throw new ORPCError("BAD_REQUEST", {
					message: "El reverso de la licencia debe ser JPEG o PNG.",
				});
			}

			const imageBuffer = await getFileBuffer(uploadedFile.key);

			// Acá solo llegan fallos de red al consultar Tránsito — los de
			// decodificación de la imagen ya se resuelven dentro de
			// runLicenseVerification como resultado "ilegible" persistible.
			const outcome = await runLicenseVerification({
				imageBuffer,
				registeredName,
			}).catch((error) => {
				console.error("Error consultando Tránsito:", {
					resourceId,
					error: error instanceof Error ? error.message : String(error),
				});
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message:
						"No se pudo contactar el servicio de verificación de Tránsito. Intenta de nuevo en unos minutos.",
				});
			});

			const [saved] = await db
				.insert(licenseQrVerifications)
				.values({
					...(isForLead
						? { leadId: input.leadId, opportunityId: input.opportunityId }
						: { coDebtorId: resourceId }),
					documentKey: uploadedFile.key,
					qrRawUrl: outcome.qrRawUrl,
					qrDomainValid: outcome.qrDomainValid,
					cardCode: outcome.cardCode,
					apiResponseCode: outcome.apiResponseCode,
					licenseHolderName: outcome.licenseHolderName,
					licenseNumber: outcome.licenseNumber,
					licenseExpiresAt: outcome.licenseExpiresAt,
					rawResponse: outcome.rawResponse,
					identityMatchScore: outcome.identityMatchScore?.toString(),
					result: outcome.result,
					failureReason: outcome.failureReason,
					createdBy: context.userId,
				})
				.returning();

			return saved;
		}),

	listLicenseVerifications: crmProcedure
		.input(
			z
				.object({
					leadId: z.string().uuid().optional(),
					opportunityId: z.string().uuid().optional(),
					coDebtorId: z.string().uuid().optional(),
					limit: z.number().int().min(1).max(100).default(20),
					offset: z.number().int().min(0).default(0),
				})
				.optional(),
		)
		.handler(async ({ input, context }) => {
			const conditions = [];
			if (input?.leadId) conditions.push(eq(licenseQrVerifications.leadId, input.leadId));
			if (input?.opportunityId) {
				conditions.push(
					or(
						eq(licenseQrVerifications.opportunityId, input.opportunityId),
						eq(coDebtorOpportunities.id, input.opportunityId),
					)!,
				);
			}
			if (input?.coDebtorId) {
				conditions.push(eq(licenseQrVerifications.coDebtorId, input.coDebtorId));
			}

			// Mismo criterio que getOpportunities: admin y sales_supervisor ven
			// todo, "sales" solo lo suyo. La verificación puede venir de un lead
			// (opportunityId directo) o de un co-deudor (hay que llegar a la
			// oportunidad a través de coDebtors.opportunityId).
			if (context.userRole === "sales") {
				conditions.push(
					or(
						eq(opportunities.assignedTo, context.userId),
						eq(coDebtorOpportunities.assignedTo, context.userId),
					),
				);
			}

			// rawResponse (payload completo de Tránsito, con idCiudadano) no
			// viaja en el listado — solo en el detalle (getLicenseVerificationById).
			const { rawResponse: _rawResponse, ...verificationColumns } =
				getTableColumns(licenseQrVerifications);

			const rows = await db
				.select({
					...verificationColumns,
					leadFirstName: leads.firstName,
					leadMiddleName: leads.middleName,
					leadLastName: leads.lastName,
					leadSecondLastName: leads.secondLastName,
					coDebtorFullName: coDebtors.fullName,
					opportunityTitle: opportunities.title,
				})
				.from(licenseQrVerifications)
				.leftJoin(leads, eq(licenseQrVerifications.leadId, leads.id))
				.leftJoin(coDebtors, eq(licenseQrVerifications.coDebtorId, coDebtors.id))
				.leftJoin(
					opportunities,
					eq(licenseQrVerifications.opportunityId, opportunities.id),
				)
				.leftJoin(
					coDebtorOpportunities,
					eq(coDebtors.opportunityId, coDebtorOpportunities.id),
				)
				.where(conditions.length > 0 ? and(...conditions) : undefined)
				.orderBy(
					desc(licenseQrVerifications.createdAt),
					desc(licenseQrVerifications.id),
				)
				.limit(input?.limit ?? 20)
				.offset(input?.offset ?? 0);

			return rows.map((row) => ({
				...row,
				subjectName: row.leadFirstName
					? buildLeadName({
							firstName: row.leadFirstName,
							middleName: row.leadMiddleName,
							lastName: row.leadLastName ?? "",
							secondLastName: row.leadSecondLastName,
						})
					: (row.coDebtorFullName ?? "—"),
			}));
		}),

	getLicenseVerificationById: crmProcedure
		.input(z.object({ id: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			const conditions = [eq(licenseQrVerifications.id, input.id)];
			if (context.userRole === "sales") {
				conditions.push(
					or(
						eq(opportunities.assignedTo, context.userId),
						eq(coDebtorOpportunities.assignedTo, context.userId),
					)!,
				);
			}

			const [row] = await db
				.select({
					...getTableColumns(licenseQrVerifications),
					leadFirstName: leads.firstName,
					leadMiddleName: leads.middleName,
					leadLastName: leads.lastName,
					leadSecondLastName: leads.secondLastName,
					coDebtorFullName: coDebtors.fullName,
					opportunityTitle: opportunities.title,
				})
				.from(licenseQrVerifications)
				.leftJoin(leads, eq(licenseQrVerifications.leadId, leads.id))
				.leftJoin(coDebtors, eq(licenseQrVerifications.coDebtorId, coDebtors.id))
				.leftJoin(
					opportunities,
					eq(licenseQrVerifications.opportunityId, opportunities.id),
				)
				.leftJoin(
					coDebtorOpportunities,
					eq(coDebtors.opportunityId, coDebtorOpportunities.id),
				)
				.where(and(...conditions))
				.limit(1);

			if (!row) {
				throw new ORPCError("NOT_FOUND", {
					message: "Verificación no encontrada",
				});
			}

			return {
				...row,
				subjectName: row.leadFirstName
					? buildLeadName({
							firstName: row.leadFirstName,
							middleName: row.leadMiddleName,
							lastName: row.leadLastName ?? "",
							secondLastName: row.leadSecondLastName,
						})
					: (row.coDebtorFullName ?? "—"),
			};
		}),
};
