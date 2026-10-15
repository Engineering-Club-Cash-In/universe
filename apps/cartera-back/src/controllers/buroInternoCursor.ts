export const TAMANIO_PAGINA_BURO_INTERNO_POR_DEFECTO = 100;
export const TAMANIO_MAXIMO_PAGINA_BURO_INTERNO = 1_000;

export class ErrorEntradaBuroInterno extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ErrorEntradaBuroInterno";
	}
}

export type CursorBuroInterno = {
	lastCreditoId: number;
	maxCreditoId: number;
};

export function codificarCursorBuroInterno(cursor: CursorBuroInterno): string {
	return `${cursor.lastCreditoId}:${cursor.maxCreditoId}`;
}

export function decodificarCursorBuroInterno(
	value: string | undefined,
): CursorBuroInterno | null {
	if (value === undefined || value === "") return null;
	const match = /^(\d+):(\d+)$/.exec(value);
	if (!match) throw new ErrorEntradaBuroInterno("Cursor de buró inválido.");
	const lastCreditoId = Number(match[1]);
	const maxCreditoId = Number(match[2]);
	if (
		!Number.isSafeInteger(lastCreditoId) ||
		!Number.isSafeInteger(maxCreditoId) ||
		lastCreditoId < 0 ||
		maxCreditoId < 0 ||
		lastCreditoId > maxCreditoId
	) {
		throw new ErrorEntradaBuroInterno("Cursor de buró inválido.");
	}
	return { lastCreditoId, maxCreditoId };
}

export function parsearTamanioPaginaBuroInterno(
	value: string | number | undefined,
): number {
	if (value === undefined || value === "") {
		return TAMANIO_PAGINA_BURO_INTERNO_POR_DEFECTO;
	}
	const parsed = Number(value);
	if (
		!Number.isSafeInteger(parsed) ||
		parsed < 1 ||
		parsed > TAMANIO_MAXIMO_PAGINA_BURO_INTERNO
	) {
		throw new ErrorEntradaBuroInterno(
			`El tamaño de página debe estar entre 1 y ${TAMANIO_MAXIMO_PAGINA_BURO_INTERNO}.`,
		);
	}
	return parsed;
}
