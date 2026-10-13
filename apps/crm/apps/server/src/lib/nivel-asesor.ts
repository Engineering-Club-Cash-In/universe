/**
 * Nivel del asesor de cobros (tarea M6 de
 * docs/features/cobros-02/18-equipo-solicitudes-backend.md). No es un rol del
 * CRM: sale de los buckets de su pool en cartera, con un solo criterio para
 * todo el sistema (regla de negocio):
 *
 * - Junior: B0–B1.
 * - Senior: B2–B4.
 * - Especial: B5 (lo ve gerencia).
 *
 * Si tiene buckets de varios niveles manda el más alto, igual que el front
 * (`equipo/estado-asesor.ts`). Sin buckets no tiene nivel (`null`).
 */

export type NivelAsesor = "junior" | "senior" | "especial";

export function nivelPorBuckets(
	buckets: readonly number[] | null | undefined,
): NivelAsesor | null {
	const lista = buckets ?? [];
	if (lista.some((b) => b >= 5)) return "especial";
	if (lista.some((b) => b >= 2 && b <= 4)) return "senior";
	if (lista.some((b) => b === 0 || b === 1)) return "junior";
	return null;
}
