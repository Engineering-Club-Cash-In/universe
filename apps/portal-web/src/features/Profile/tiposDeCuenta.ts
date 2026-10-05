/**
 * Tipos de cuenta que el portal ofrece al inversionista.
 *
 * La lista estaba duplicada: el perfil mostraba cuatro y el modal de edición
 * solo dos, así que quien tenía "MONETARIA Q" o "MONETARIA $" no podía ni
 * conservar su propio valor al editar.
 *
 * El backend (`portalInvestorPayload.ts` en auth-google) acepta el enum
 * completo de la base, que además incluye valores heredados que no tiene
 * sentido ofrecer como opción nueva. Esta es la parte de ese enum que el
 * producto muestra.
 */
export const OPCIONES_TIPO_CUENTA = [
  { value: "MONETARIA", label: "Monetaria" },
  { value: "MONETARIA Q", label: "Monetaria Q" },
  { value: "MONETARIA $", label: "Monetaria $" },
  { value: "AHORRO", label: "Ahorro" },
] as const;
