/**
 * Sistema de permisos para el módulo de Jurídico
 *
 * Define qué roles tienen acceso a qué operaciones sobre contratos legales
 */

export type Permission =
	| "legal:view" // Ver contratos legales
	| "legal:create" // Crear/registrar nuevos contratos
	| "legal:assign" // Asignar contratos a oportunidades
	| "legal:delete"; // Eliminar contratos

export type UserRole = "admin" | "sales" | "analyst" | "cobros" | "juridico";

/**
 * Mapeo de permisos por rol
 */
export const permissions: Record<Permission, UserRole[]> = {
	"legal:view": ["admin", "juridico", "sales", "analyst"],
	"legal:create": ["admin", "juridico"],
	"legal:assign": ["admin", "juridico"],
	"legal:delete": ["admin"],
} as const;

/**
 * Verifica si un rol tiene un permiso específico
 */
export function hasPermission(userRole: UserRole, permission: Permission): boolean {
	return permissions[permission]?.includes(userRole) || false;
}

/**
 * Obtiene todos los permisos de un rol
 */
export function getRolePermissions(userRole: UserRole): Permission[] {
	const rolePermissions: Permission[] = [];

	for (const [permission, roles] of Object.entries(permissions)) {
		if (roles.includes(userRole)) {
			rolePermissions.push(permission as Permission);
		}
	}

	return rolePermissions;
}

/**
 * Verifica si un usuario tiene múltiples permisos (AND)
 */
export function hasAllPermissions(userRole: UserRole, requiredPermissions: Permission[]): boolean {
	return requiredPermissions.every((permission) => hasPermission(userRole, permission));
}

/**
 * Verifica si un usuario tiene al menos uno de los permisos (OR)
 */
export function hasAnyPermission(userRole: UserRole, requiredPermissions: Permission[]): boolean {
	return requiredPermissions.some((permission) => hasPermission(userRole, permission));
}
