import type { opportunities } from "../db/schema";

export type QuotationCreditType =
	(typeof opportunities.$inferSelect)["creditType"];

export function resolveQuotationCreditType(
	creditType: QuotationCreditType | null,
): QuotationCreditType {
	return creditType ?? "autocompra";
}
