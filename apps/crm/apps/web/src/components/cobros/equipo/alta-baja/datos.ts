import { orpc, orpcAparte, queryClient } from "@/utils/orpc";

/**
 * Tras un alta o una baja cambian el catálogo de asesores, la carga, la
 * cartera de varios asesores y la bitácora: se refresca todo lo que lo muestra.
 */
export async function refrescarEquipo() {
	await Promise.all(
		[
			orpc.getAsesoresTraslados.key(),
			orpc.getCargaPorAsesorBucket.key(),
			orpc.getCreditosPorBucket.key(),
			orpc.getHistorialReasignaciones.key(),
			orpc.listarTraslados.key(),
			orpc.getColaDia.key(),
			orpc.getAgendaDia.key(),
			orpcAparte.listarAusencias.key(),
			orpcAparte.getRecuperacionAsesores.key(),
			orpcAparte.getBitacoraDecisiones.key(),
		].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
	);
}
