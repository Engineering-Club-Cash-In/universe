// Qué mostrar en el detalle del crédito sobre su token Nexa.
// Un binding inactivo no recibe pagos (cartera los rechaza como binding_inactive),
// así que no se muestra como habilitado aunque tenga token.
export type TonoTokenNexa = "error" | "token" | "gris";

export function textoTokenNexa({
  isLoading,
  error,
  credito,
}: {
  isLoading: boolean;
  error: unknown;
  credito: { nexaToken: string | null; bindingActivo: boolean } | undefined;
}): { texto: string; tono: TonoTokenNexa } {
  if (isLoading) return { texto: "Cargando…", tono: "gris" };
  if (error) return { texto: "No se pudo consultar el token de Nexa", tono: "error" };
  if (!credito) return { texto: "Este crédito no está habilitado para Nexa", tono: "gris" };
  if (credito.bindingActivo === false) return { texto: "Token Nexa inactivo: no recibe pagos", tono: "gris" };
  if (credito.nexaToken) return { texto: credito.nexaToken, tono: "token" };
  return { texto: "Habilitado para Nexa, sin token registrado", tono: "gris" };
}
