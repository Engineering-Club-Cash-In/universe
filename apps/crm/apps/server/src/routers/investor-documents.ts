import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { investorActivityLog } from "../db/schema";
import {
	crmCobrosOrInvestmentsProcedure,
	investmentManagerProcedure,
} from "../lib/orpc";
import { PERMISSIONS } from "../lib/roles";
import { carteraBackClient } from "../services/cartera-back-client";

export const investorDocumentsRouter = {
	getInvestorRendimiento: crmCobrosOrInvestmentsProcedure
		.input(
			z.object({
				email: z.string().email(),
			}),
		)
		.handler(async ({ input }) => {
			const result = await carteraBackClient.getInvestorRendimiento(
				input.email,
			);
			return result;
		}),

	getInvestorDocumentsAdmin: crmCobrosOrInvestmentsProcedure
		.input(
			z.object({
				inversionistaId: z.number().int().positive(),
			}),
		)
		.handler(async ({ input }) => {
			const result = await carteraBackClient.getInvestorDocumentsAdmin(
				input.inversionistaId,
			);
			return result;
		}),

	createInvestorDocument: crmCobrosOrInvestmentsProcedure
		.input(
			z.object({
				inversionistaId: z.number().int().positive(),
				nombre: z.string().min(1),
				descripcion: z.string().optional(),
				visible: z.boolean().optional(),
				fileBase64: z.string().min(1),
				fileMimeType: z.string().min(1),
			}),
		)
		.handler(async ({ input, context }) => {
			const buffer = Buffer.from(input.fileBase64, "base64");
			const blob = new Blob([buffer], { type: input.fileMimeType });

			// Solo manager/admin pueden hacer visible el documento al crearlo
			const canSetVisible = PERMISSIONS.canValidateInvestmentFunds(
				context.userRole,
			);
			const visible = canSetVisible ? input.visible : false;

			const result = await carteraBackClient.createInvestorDocument({
				file: blob,
				inversionista_id: input.inversionistaId,
				nombre: input.nombre,
				descripcion: input.descripcion,
				visible,
				created_by: context.session.user.name ?? context.session.user.email,
			});

			await db.insert(investorActivityLog).values({
				inversionistaId: input.inversionistaId,
				action: "document_created",
				details: {
					nombre: input.nombre,
					descripcion: input.descripcion,
					visible,
					mimeType: input.fileMimeType,
				},
				performedBy: context.session.user.id,
				performedByName:
					context.session.user.name ?? context.session.user.email,
			});

			return result;
		}),

	// Solo manager/admin pueden cambiar visibilidad
	toggleInvestorDocumentVisibility: investmentManagerProcedure
		.input(
			z.object({
				inversionistaId: z.number().int().positive(),
				documentoId: z.number().int().positive(),
				visible: z.boolean(),
				documentoNombre: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const result = await carteraBackClient.toggleInvestorDocumentVisibility(
				input.documentoId,
				input.visible,
			);

			await db.insert(investorActivityLog).values({
				inversionistaId: input.inversionistaId,
				action: "document_visibility_toggled",
				details: {
					documentoId: input.documentoId,
					documentoNombre: input.documentoNombre,
					visible: input.visible,
				},
				performedBy: context.session.user.id,
				performedByName:
					context.session.user.name ?? context.session.user.email,
			});

			return result;
		}),

	deleteInvestorDocument: crmCobrosOrInvestmentsProcedure
		.input(
			z.object({
				inversionistaId: z.number().int().positive(),
				documentoId: z.number().int().positive(),
				documentoNombre: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const result = await carteraBackClient.deleteInvestorDocument(
				input.documentoId,
			);

			await db.insert(investorActivityLog).values({
				inversionistaId: input.inversionistaId,
				action: "document_deleted",
				details: {
					documentoId: input.documentoId,
					documentoNombre: input.documentoNombre,
				},
				performedBy: context.session.user.id,
				performedByName:
					context.session.user.name ?? context.session.user.email,
			});

			return result;
		}),

	// Bancos — catálogo desde cartera-back
	getBancosCartera: crmCobrosOrInvestmentsProcedure
		.handler(async () => {
			return carteraBackClient.getBancos();
		}),

	// Crear inversionista — opcionalmente con compra de cartera
	crearInversionista: investmentManagerProcedure
		.input(
			z.object({
				nombre: z.string().min(1),
				dpi: z.string().optional(),
				email: z.string().email().optional(),
				banco: z.number().nullable().optional(),
				tipoCuenta: z.string().optional(),
				numeroCuenta: z.string().optional(),
				tipoReinversion: z.string().optional(),
				montoReinversion: z.number().optional(),
				moneda: z.enum(["quetzales", "dolares"]).optional(),
				emiteFactura: z.boolean().optional(),
				// Compra de cartera opcional
				hacerCompraCartera: z.boolean().optional(),
				montoCompraCartera: z.number().positive().optional(),
				porcentajeInversion: z.number().min(0).max(100).optional(),
				porcentajeCashIn: z.number().min(0).max(100).optional(),
				fechaInicioParticipacion: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			// 1. Crear inversionista en cartera-back
			const createResult = await carteraBackClient.createInvestor({
				nombre: input.nombre,
				dpi: input.dpi ? Number(input.dpi) : null,
				email: input.email ?? null,
				banco: input.banco ?? null,
				tipo_cuenta: input.tipoCuenta ?? null,
				numero_cuenta: input.numeroCuenta ?? null,
				tipo_reinversion: input.tipoReinversion ?? "sin_reinversion",
				monto_reinversion: input.montoReinversion ?? null,
				moneda: input.moneda ?? "quetzales",
				emite_factura: input.emiteFactura ?? false,
			});

			const created = createResult.data?.[0];
			if (!created?.inversionista_id) {
				throw new Error("No se pudo crear el inversionista en cartera");
			}

			// 2. Log de creación
			await db.insert(investorActivityLog).values({
				inversionistaId: created.inversionista_id,
				action: "investor_created",
				details: {
					nombre: input.nombre,
					dpi: input.dpi,
					email: input.email,
					moneda: input.moneda,
				},
				performedBy: context.session.user.id,
				performedByName:
					context.session.user.name ?? context.session.user.email,
			});

			// 3. Si pidió compra de cartera, ejecutarla con el ID del nuevo inversionista
			let compraResult = null;
			if (input.hacerCompraCartera && input.montoCompraCartera) {
				compraResult = await carteraBackClient.compraCartera({
					inversionista_id: created.inversionista_id,
					monto_aportado: input.montoCompraCartera,
					tipo_operacion: "compra_cartera",
					porcentaje_inversion: input.porcentajeInversion,
					porcentaje_cash_in: input.porcentajeCashIn,
					fecha_inicio_participacion:
						input.fechaInicioParticipacion || undefined,
				});

				// Log de compra de cartera
				await db.insert(investorActivityLog).values({
					inversionistaId: created.inversionista_id,
					action: "compra_cartera",
					details: {
						monto_aportado: input.montoCompraCartera,
						fecha_inicio_participacion: input.fechaInicioParticipacion,
					},
					performedBy: context.session.user.id,
					performedByName:
						context.session.user.name ?? context.session.user.email,
				});
			}

			return {
				success: true,
				inversionista: created,
				compraCartera: compraResult,
			};
		}),

	// Compra de cartera — registra log y llama a cartera-back
	compraCartera: investmentManagerProcedure
		.input(
			z.object({
				inversionistaId: z.number().int().positive(),
				montoAportado: z.number().positive(),
				fechaInicioParticipacion: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			// 1. Llamar a cartera-back para registrar la compra
			const result = await carteraBackClient.compraCartera({
				inversionista_id: input.inversionistaId,
				monto_aportado: input.montoAportado,
				tipo_operacion: "compra_cartera",
				fecha_inicio_participacion: input.fechaInicioParticipacion || undefined,
			});

			// 2. Registrar en investor_activity_log
			await db.insert(investorActivityLog).values({
				inversionistaId: input.inversionistaId,
				action: "compra_cartera",
				details: {
					monto_aportado: input.montoAportado,
					fecha_inicio_participacion: input.fechaInicioParticipacion,
				},
				performedBy: context.session.user.id,
				performedByName:
					context.session.user.name ?? context.session.user.email,
			});

			return result;
		}),

	// Solo manager/admin pueden ver el historial de actividad
	getInvestorActivityLog: investmentManagerProcedure
		.input(
			z.object({
				inversionistaId: z.number().int().positive(),
			}),
		)
		.handler(async ({ input }) => {
			const logs = await db
				.select()
				.from(investorActivityLog)
				.where(eq(investorActivityLog.inversionistaId, input.inversionistaId))
				.orderBy(desc(investorActivityLog.createdAt))
				.limit(100);

			return logs;
		}),
};
