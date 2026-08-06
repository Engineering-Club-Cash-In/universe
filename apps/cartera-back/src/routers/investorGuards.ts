// ── Guard a nivel de CAMPO para `descuenta_impuestos` ───────────────────────
// `descuenta_impuestos` cambia cuánto se le paga al inversionista (interés
// neteado 12% IVA + 7% ISR), así que solo ADMIN puede tocarlo. El resto del
// endpoint sigue abierto a cualquier usuario autenticado: únicamente se
// rechaza la request cuando el campo viene en el body sin ser ADMIN.
export const bodyTraeDescuentaImpuestos = (body: unknown): boolean => {
  const traeEnObjeto = (o: unknown) =>
    !!o && typeof o === "object" && (o as any).descuenta_impuestos !== undefined;
  // insertInvestor acepta un objeto O un array de inversionistas.
  return Array.isArray(body) ? body.some(traeEnObjeto) : traeEnObjeto(body);
};

export const guardDescuentaImpuestos = ({
  body,
  user,
  set,
}: {
  body: unknown;
  user?: { role?: string };
  set: { status?: number };
}): { message: string } | null => {
  if (!bodyTraeDescuentaImpuestos(body)) return null;
  if (user?.role !== "ADMIN") {
    set.status = 403;
    return { message: "Solo ADMIN puede modificar descuenta_impuestos" };
  }
  return null;
};
