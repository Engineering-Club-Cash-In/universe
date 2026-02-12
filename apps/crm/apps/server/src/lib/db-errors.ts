interface PgError {
	code: string;
	detail?: string;
	constraint?: string;
}

/**
 * Extrae el error original de PostgreSQL desde un DrizzleQueryError.
 * Retorna null si no es un error de base de datos.
 */
function getPgError(error: unknown): PgError | null {
	const cause = error instanceof Error ? (error.cause as PgError) : null;
	if (cause && typeof cause.code === "string") {
		return cause;
	}
	return null;
}

/**
 * Verifica si el error es una violación de unique constraint (código 23505).
 * Opcionalmente filtra por nombre de constraint específico.
 */
export function isUniqueViolation(
	error: unknown,
	constraint?: string,
): boolean {
	const pg = getPgError(error);
	if (!pg || pg.code !== "23505") return false;
	if (constraint && pg.constraint !== constraint) return false;
	return true;
}
