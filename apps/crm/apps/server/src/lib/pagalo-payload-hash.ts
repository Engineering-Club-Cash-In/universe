/**
 * Hash canónico del comando de importación Págalo (CB-028).
 *
 * cartera-back reconstruye este mismo hash antes de aceptar el comando
 * (docs/features/pagalo/01-creacion-transaccional-pagos.md §4): un retry
 * legítimo con el mismo contenido debe dar SIEMPRE el mismo hash, o
 * cartera-back lo trata como "mismo grupo, contenido distinto" y lo manda a
 * REVIEW_REQUIRED sin motivo real. Por eso el orden de claves está fijado a
 * mano —no depende de `Object.keys()`/`JSON.stringify`, que no garantiza
 * orden estable— y `allocations[]` se ordena de forma determinística antes
 * de hashear, ya que el orden en que la DB devuelve las filas no está
 * garantizado entre corridas.
 */
import { createHash } from "node:crypto";

export type PagaloAllocationForHash = {
	link_type: "CAPITAL" | "MORA_INTERES";
	cartera_cuota_id: number;
	numero_cuota: number;
	rubro: string;
	amount: string;
	facturable: boolean;
};

export type PagaloSourceForHash = {
	transaction_uuid: string;
	external_identifier: string;
	request_id?: string;
	request_auth?: string;
	paid_at: string;
	voucher_storage_key: string;
} | null;

export type PagaloCommandForHash = {
	crm_group_id: string;
	credito_id: number;
	numero_credito_sifco: string;
	currency: string;
	capital_total: string;
	facturable_total: string;
	otros_total: string;
	total_amount: string;
	cuota_inicial: number;
	allocations: PagaloAllocationForHash[];
	capital: PagaloSourceForHash;
	facturable: PagaloSourceForHash;
};

/** Mismo orden para ambos: el que efectivamente se envía y el que se hashea. */
export function ordenarAllocations(
	allocations: PagaloAllocationForHash[],
): PagaloAllocationForHash[] {
	return [...allocations].sort((a, b) => {
		if (a.link_type !== b.link_type) return a.link_type < b.link_type ? -1 : 1;
		if (a.numero_cuota !== b.numero_cuota)
			return a.numero_cuota - b.numero_cuota;
		return a.rubro < b.rubro ? -1 : a.rubro > b.rubro ? 1 : 0;
	});
}

// cartera-back normaliza transaction_uuid a minúsculas antes de recomputar el
// hash (pagaloPaymentImportPolicy.ts, sourceSchema) — si Págalo alguna vez
// devuelve mayúsculas, hashear el valor crudo acá daría un hash distinto al
// que cartera-back verifica, y un pago legítimo caería a INVALID_COMMAND
// (hallazgo Codex). Se normaliza acá también para que ambos lados hasheen
// exactamente el mismo valor canónico.
const normalizarFuente = (source: PagaloSourceForHash) =>
	source
		? {
				transaction_uuid: source.transaction_uuid.toLowerCase(),
				external_identifier: source.external_identifier,
				request_id: source.request_id ?? null,
				request_auth: source.request_auth ?? null,
				paid_at: source.paid_at,
				voucher_storage_key: source.voucher_storage_key,
			}
		: null;

const normalizarAllocation = (a: PagaloAllocationForHash) => ({
	link_type: a.link_type,
	cartera_cuota_id: a.cartera_cuota_id,
	numero_cuota: a.numero_cuota,
	rubro: a.rubro,
	amount: a.amount,
	facturable: a.facturable,
});

export function canonicalizarPagaloCommand(
	command: PagaloCommandForHash,
): string {
	const allocations = ordenarAllocations(command.allocations);
	return JSON.stringify({
		crm_group_id: command.crm_group_id,
		credito_id: command.credito_id,
		numero_credito_sifco: command.numero_credito_sifco,
		currency: command.currency,
		capital_total: command.capital_total,
		facturable_total: command.facturable_total,
		otros_total: command.otros_total,
		total_amount: command.total_amount,
		cuota_inicial: command.cuota_inicial,
		allocations: allocations.map(normalizarAllocation),
		capital: normalizarFuente(command.capital),
		facturable: normalizarFuente(command.facturable),
	});
}

/** SHA-256 hex minúsculas — debe pasar `^[0-9a-f]{64}$` (cartera-back lo exige). */
export function calcularPagaloPayloadHash(
	command: PagaloCommandForHash,
): string {
	return createHash("sha256")
		.update(canonicalizarPagaloCommand(command))
		.digest("hex");
}
