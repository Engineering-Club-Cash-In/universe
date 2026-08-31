/**
 * CB-127 · Predicado "grupo Págalo problemático" para la bandeja de
 * supervisión (/cobros/pagalo). Extraído como función pura para poder
 * testearlo sin DB.
 */

import { and, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import {
	type PagaloPaymentGroupStatus,
	type PagaloPaymentLinkStatus,
	pagaloPaymentGroups,
} from "../db/schema/pagalo-payments";
import { LINKS_PENDING_HUERFANO_MS } from "./bot-cobros/pago-link";

export const PENDING_PAYMENT_ESTANCADO_DIAS = 7;

export type SupervisionFiltrosInput = {
	estados?: PagaloPaymentGroupStatus[];
	problemasLink?: PagaloPaymentLinkStatus[];
	soloHuerfanos?: boolean;
	antiguedadMinDias?: number;
	numeroSifco?: string;
};

const eqStatus = (status: PagaloPaymentGroupStatus) =>
	inArray(pagaloPaymentGroups.status, [status]);

const esHuerfano = () =>
	and(
		eqStatus("LINKS_PENDING"),
		lt(
			pagaloPaymentGroups.updatedAt,
			new Date(Date.now() - LINKS_PENDING_HUERFANO_MS),
		),
	);

const esPendienteEstancado = () =>
	and(
		eqStatus("PENDING_PAYMENT"),
		lt(
			pagaloPaymentGroups.createdAt,
			new Date(Date.now() - PENDING_PAYMENT_ESTANCADO_DIAS * 86_400_000),
		),
	);

/**
 * Sin filtros explícitos, "problemático" es: REVIEW_REQUIRED/APPLICATION_FAILED
 * siempre; LINKS_PENDING huérfano (mismo umbral que el bot usa para decidir
 * si puede reemplazar un grupo a medio crear, pago-link.ts); PENDING_PAYMENT
 * estancado más de 7 días. Los links con estado problemático
 * (EXPIRED/CANCELLED/ERROR) se filtran aparte, contra la tabla de links —
 * ver nota en el handler (pagalo-supervision.ts).
 */
export function condicionGrupoProblematico(): SQL {
	const condicion = or(
		inArray(pagaloPaymentGroups.status, [
			"REVIEW_REQUIRED",
			"APPLICATION_FAILED",
		]),
		esHuerfano(),
		esPendienteEstancado(),
	);
	if (!condicion) throw new Error("No se pudo armar el predicado Págalo.");
	return condicion;
}

/** Condiciones adicionales derivadas del input explícito del filtro. */
export function condicionesFiltro(input: SupervisionFiltrosInput): SQL[] {
	const condiciones: SQL[] = [];
	if (input.estados && input.estados.length > 0) {
		condiciones.push(inArray(pagaloPaymentGroups.status, input.estados));
	}
	if (input.soloHuerfanos) {
		const huerfano = esHuerfano();
		if (huerfano) condiciones.push(huerfano);
	}
	if (input.antiguedadMinDias && input.antiguedadMinDias > 0) {
		condiciones.push(
			lt(
				pagaloPaymentGroups.createdAt,
				new Date(Date.now() - input.antiguedadMinDias * 86_400_000),
			),
		);
	}
	return condiciones;
}

/** Scope de SIFCOs como un arreglo PostgreSQL: un solo bind, no uno por crédito. */
export function condicionSifcosPermitidos(sifcos: string[]): SQL {
	return sql`${pagaloPaymentGroups.numeroCreditoSifco} = ANY(${sql.param(sifcos, {
		mapToDriverValue: (valores) =>
			`{${valores
				.map(
					(valor) =>
						`"${valor.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`,
				)
				.join(",")}}`,
	})}::text[])`;
}
