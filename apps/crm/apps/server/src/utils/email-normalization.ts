/**
 * Forma canónica de un correo para COMPARARLO.
 *
 * El portal decide de quién es una ficha por el correo, y ese correo llega de
 * dos sitios que no lo escriben igual: la sesión de Better Auth (lo tecleó la
 * persona) y la fila del lead (lo tecleó ventas, o lo trajo una migración).
 * "Ana@Ejemplo.com " y "ana@ejemplo.com" son la misma persona, así que
 * cualquier búsqueda tiene que normalizar LOS DOS LADOS. Ver `eqEmail`.
 *
 * Solo mayúsculas y espacios de los extremos: la parte local de un correo es
 * sensible a mayúsculas según el RFC, pero ningún proveedor real lo aplica y
 * los datos del CRM ya vienen mezclados. Nada de tocar puntos ni `+etiquetas`,
 * que sí distinguen buzones en algunos servidores.
 *
 * Módulo puro y sin dependencias a propósito: lo usan tanto la capa de SQL como
 * las reglas del registro, y ninguna de las dos debe arrastrar a la otra.
 */
export function normalizarCorreo(correo: string | null | undefined): string {
	return (correo ?? "").trim().toLowerCase();
}
