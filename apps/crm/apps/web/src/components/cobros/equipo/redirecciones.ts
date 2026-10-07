import { redirect } from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";
import { PERMISSIONS } from "@/lib/roles";
import type { EquipoSearch } from "./search";

/**
 * Las páginas sueltas Apertura del día (/cobros/apertura), Cierre diario
 * (/cobros/cierre), Carga de cuentas (/cobros/carga) y Traslados y coberturas
 * (/cobros/reasignaciones) viven ahora en «Mi equipo». Sus rutas no se borran:
 * redirigen (`beforeLoad`) para que los enlaces guardados sigan funcionando.
 *
 *   - Supervisión y admin (`canAssignCobros`, los dos por igual) → la pestaña
 *     o vista de «Mi equipo» que corresponde.
 *   - Cualquier otro rol (antes veía «Acceso denegado») → el Dashboard.
 */
export async function redirigirAEquipo(search: EquipoSearch): Promise<never> {
	const sesion = await authClient.getSession().catch(() => null);
	const rol = sesion?.data?.user?.role;
	if (rol && PERMISSIONS.canAssignCobros(rol)) {
		throw redirect({ to: "/cobros/equipo", search, replace: true });
	}
	throw redirect({ to: "/cobros", replace: true });
}
