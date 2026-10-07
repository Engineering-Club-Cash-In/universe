import { redirect } from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";
import { PERMISSIONS } from "@/lib/roles";
import type { SearchSegmento } from "./segmentos";

/**
 * Las páginas sueltas Cola del día (/cobros/cola), Alertas de promesas
 * (/cobros/promesas) y Alertas de convenios (/cobros/alertas-convenios) son
 * ahora segmentos de la Cartera general. Sus rutas no se borran: redirigen
 * (`beforeLoad`) para que los enlaces guardados sigan funcionando.
 *
 *   - Supervisión y admin (`canAssignCobros`, los dos por igual) → la Cartera
 *     general con el segmento (y el asesor, si el enlace lo traía).
 *   - El asesor (que ya no las tenía en el menú) → su Dashboard, donde viven
 *     la cola priorizada y la agenda de hoy con sus promesas.
 */
export async function redirigirACartera(
	segmento: SearchSegmento,
	asesor?: number,
): Promise<never> {
	const sesion = await authClient.getSession().catch(() => null);
	const rol = sesion?.data?.user?.role;
	if (rol && PERMISSIONS.canAssignCobros(rol)) {
		throw redirect({
			to: "/cobros/cartera",
			search: { ...segmento, ...(asesor ? { asesor } : {}) },
			replace: true,
		});
	}
	throw redirect({ to: "/cobros", replace: true });
}

/** `?asesor=` / `?asesorId=` de un enlace viejo, si es un id válido. */
export function asesorDeSearch(search: Record<string, unknown>) {
	const n = Number(search.asesor ?? search.asesorId);
	return Number.isInteger(n) && n > 0 ? n : undefined;
}
