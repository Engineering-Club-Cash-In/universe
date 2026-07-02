// 🔥 Normalización canónica de emails (trim + minúsculas), compartida por TODOS los
// writers de platform_users.email / asesores.email_cash_in y por los lookups de login.
// Los filtros de cobro comparan por igualdad exacta contra el email de sesión, así que
// cualquier writer que no normalice vuelve a desincronizar las columnas.
// Whitespace-only o no-string → undefined (rechazar en creates, ignorar en updates).
export const normalizeEmail = (email: unknown): string | undefined =>
  typeof email === "string" ? email.trim().toLowerCase() || undefined : undefined;
