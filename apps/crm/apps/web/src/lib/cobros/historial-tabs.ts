import { PERMISSIONS } from "@/lib/roles";

export type TabHistorialCobros = "historial" | "cumplimiento";

export function tabsHistorialCobros(
	rol: string | null | undefined,
): TabHistorialCobros[] {
	return PERMISSIONS.canAssignCobros(rol ?? "")
		? ["historial", "cumplimiento"]
		: ["historial"];
}
