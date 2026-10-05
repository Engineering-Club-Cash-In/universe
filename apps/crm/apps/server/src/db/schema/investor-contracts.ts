import {
	index,
	integer,
	jsonb,
	numeric,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

/**
 * En qué va la batería de contratos de un inversionista.
 *
 * - `pendiente`: cartera avisó que la compra se aceptó y nadie la tomó todavía.
 * - `en_proceso`: jurídico ya empezó a emitir sus contratos.
 * - `completada`: jurídico dio por terminada la papelería de esta compra.
 * - `descartada`: no había que hacer contratos (se anuló la compra, se hizo por
 *   fuera, estaba repetida). Se conserva la fila con el motivo.
 */
export const investorContractBatchStatusEnum = pgEnum(
	"investor_contract_batch_status",
	["pendiente", "en_proceso", "completada", "descartada"],
);

/** Un crédito de la compra que originó la batería, tal como lo mandó cartera. */
export type CreditoDeLaCompra = {
	creditoId: number;
	numeroCreditoSifco: string;
	clienteNombre: string;
	/** Lo que puso ESTE inversionista en ESTE crédito, en quetzales. */
	monto: string;
	/**
	 * Las fechas del crédito: cuándo se formalizó (la cuota 0) y cuándo vence (la
	 * última cuota). Es lo que dice el contrato de cesión, junto con el monto que
	 * puso el inversionista.
	 *
	 * Opcionales: las baterías abiertas antes de que esto existiera no las
	 * tienen, y ahí esos campos del contrato se llenan a mano.
	 */
	fechaInicio?: string | null;
	fechaVencimiento?: string | null;
	/**
	 * Lo que quedó estampado en el espejo de cartera para este crédito: qué hace
	 * el inversionista con el retorno (`sin_reinversion`, `reinversion_capital`,
	 * …) y cómo factura (`p2p_directa`, `factura_cube`, `factura_cube_pequeno`).
	 *
	 * Los contratos los piden como dato del inversionista, pero en cartera viven
	 * por crédito: una compra de Q100,000 puede estar repartida en dos créditos
	 * y lo que vale es lo que se estampó en ellos. Se usa el del primero.
	 *
	 * Opcionales: las baterías abiertas antes de que esto existiera no los
	 * tienen, y ahí esos campos del contrato se eligen a mano.
	 */
	tipoReinversion?: string | null;
	modalidadFacturacion?: string | null;
};

/**
 * El trabajo de contratos que le queda pendiente a jurídico por un inversionista.
 *
 * Nace cuando Pablo acepta la compra de cartera en carteraFront: hasta ahora eso
 * sólo mandaba un correo, y jurídico se enteraba leyendo el hilo. La fila guarda
 * una **foto** de los datos del inversionista y de la compra: la ficha viva está
 * en cartera (otra base, otro servicio), y el contrato tiene que decir lo que era
 * cierto el día que se aceptó, no lo que diga cartera el día que se abra la
 * pantalla.
 *
 * No lleva los contratos: esos son filas de `generated_legal_contracts` que
 * apuntan acá.
 */
export const investorContractBatches = pgTable(
	"investor_contract_batches",
	{
		id: uuid("id").primaryKey().defaultRandom(),

		/** `inversionista_id` de cartera. No hay FK: es otra base. */
		investorId: integer("investor_id").notNull(),
		investorName: text("investor_name").notNull(),
		investorDpi: text("investor_dpi"),
		/**
		 * DPI del representante legal del inversionista, cuando es una sociedad.
		 *
		 * Quien firma los contratos de una sociedad no es "la empresa" sino su
		 * representante, y el catálogo de campos del contrato se pide por DPI. En
		 * cartera es `inversionistas.dpi_rep_legal`.
		 */
		investorDpiRepLegal: text("investor_dpi_rep_legal"),
		investorEmail: text("investor_email"),
		investorPhone: text("investor_phone"),

		/**
		 * Qué compra la originó, para poder reconocerla de nuevo.
		 *
		 * Son los `credito_id` aceptados, ordenados y unidos con guiones. Cartera
		 * reintenta el aviso si el CRM no contesta, y sin esto cada reintento
		 * abría otra batería del mismo trabajo.
		 */
		purchaseKey: text("purchase_key").notNull(),

		creditos: jsonb("creditos").$type<CreditoDeLaCompra[]>().notNull(),
		montoTotal: numeric("monto_total", { precision: 18, scale: 2 }).notNull(),
		/**
		 * Lo que el inversionista tenía aportado en cartera ANTES de esta compra.
		 *
		 * Decide qué verificación de identidad se le pide al firmar: en cero es
		 * su primera compra y va con selfie y DPI; con monto, sólo firma (ver
		 * `lib/identidad-inversionista.ts`). Lo calcula cartera al aceptar la
		 * compra y se pisa cuando otra compra reusa la batería. Vacío en las de
		 * antes: se tratan como primera compra.
		 */
		montoAportadoPrevio: numeric("monto_aportado_previo", {
			precision: 18,
			scale: 2,
		}),
		/** Modalidad de reinversión y facturación del inversionista, como texto. */
		modalidad: text("modalidad"),
		facturacion: text("facturacion"),

		status: investorContractBatchStatusEnum("status")
			.notNull()
			.default("pendiente"),

		/** Cuándo y quién aceptó la compra, del lado de cartera. */
		acceptedAt: timestamp("accepted_at").notNull(),
		acceptedByEmail: text("accepted_by_email"),
		/**
		 * El id de Resend del correo de "Compra de Cartera aceptada".
		 *
		 * Es el hilo donde el "Listo" de jurídico contesta con los contratos y los
		 * enlaces. Resend no respeta un Message-ID propio: con este id se le
		 * pregunta el real, y el asunto y los destinatarios. Vacío en las de antes.
		 */
		emailThreadId: text("email_thread_id"),

		startedAt: timestamp("started_at"),
		startedBy: text("started_by").references(() => user.id),
		completedAt: timestamp("completed_at"),
		completedBy: text("completed_by").references(() => user.id),
		discardedAt: timestamp("discarded_at"),
		discardedBy: text("discarded_by").references(() => user.id),
		discardReason: text("discard_reason"),

		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
	},
	(table) => [
		index("investor_contract_batches_investor_idx").on(table.investorId),
		index("investor_contract_batches_status_idx").on(table.status),
		uniqueIndex("investor_contract_batches_purchase_unique").on(
			table.investorId,
			table.purchaseKey,
		),
	],
);
