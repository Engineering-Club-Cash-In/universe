/**
 * Payload con el que el portal actualiza los datos de cobro de su propio
 * inversionista en cartera.
 *
 * El titular no elige la fila: el destino lo resuelve el servidor a partir del
 * correo de la sesión y viaja como `inversionista_id`. Del cuerpo de la
 * petición solo sobreviven los campos que el titular puede editar de su
 * perfil; el resto (identidad y campos de negocio) se descarta aquí, de modo
 * que el upsert de cartera nunca reciba desde el portal un criterio de
 * búsqueda alternativo ni un campo que no le corresponde.
 */

export class PortalInvestorPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortalInvestorPayloadError";
  }
}

export type PortalInvestorUpdate = {
  inversionista_id: number;
  banco_id?: number;
  tipo_cuenta?: string;
  numero_cuenta?: string;
};

const TIPOS_CUENTA = ["MONETARIA", "AHORRO"] as const;

// Dígitos, letras y guiones: cubre cuentas locales e IBAN, y deja fuera
// espacios y separadores que solo aparecen por un copiar/pegar mal hecho.
const NUMERO_CUENTA = /^[A-Za-z0-9-]{4,34}$/;

const esEnteroPositivo = (valor: number): boolean =>
  Number.isInteger(valor) && valor > 0;

const parsearBancoId = (valor: unknown): number => {
  const numero =
    typeof valor === "number"
      ? valor
      : typeof valor === "string" && valor.trim() !== ""
        ? Number(valor)
        : Number.NaN;

  if (!esEnteroPositivo(numero)) {
    throw new PortalInvestorPayloadError("El banco seleccionado no es válido");
  }

  return numero;
};

const parsearTipoCuenta = (valor: unknown): string => {
  const normalizado =
    typeof valor === "string" ? valor.trim().toUpperCase() : "";

  if (!TIPOS_CUENTA.includes(normalizado as (typeof TIPOS_CUENTA)[number])) {
    throw new PortalInvestorPayloadError("El tipo de cuenta no es válido");
  }

  return normalizado;
};

const parsearNumeroCuenta = (valor: unknown): string => {
  const normalizado = typeof valor === "string" ? valor.trim() : "";

  if (!NUMERO_CUENTA.test(normalizado)) {
    throw new PortalInvestorPayloadError("El número de cuenta no es válido");
  }

  return normalizado;
};

/**
 * Arma la actualización para `inversionistaId` con los campos editables que
 * traiga `body`. Lanza `PortalInvestorPayloadError` si el destino no es válido,
 * si algún campo viene mal formado o si no hay nada que actualizar.
 */
export const buildPortalInvestorUpdate = (
  inversionistaId: number,
  body: unknown,
): PortalInvestorUpdate => {
  if (!esEnteroPositivo(inversionistaId)) {
    throw new PortalInvestorPayloadError(
      "No se pudo identificar al inversionista de la cuenta",
    );
  }

  const entrada = (
    body && typeof body === "object" && !Array.isArray(body) ? body : {}
  ) as Record<string, unknown>;

  const update: PortalInvestorUpdate = { inversionista_id: inversionistaId };

  if (entrada.banco_id !== undefined) {
    update.banco_id = parsearBancoId(entrada.banco_id);
  }

  if (entrada.tipo_cuenta !== undefined) {
    update.tipo_cuenta = parsearTipoCuenta(entrada.tipo_cuenta);
  }

  if (entrada.numero_cuenta !== undefined) {
    update.numero_cuenta = parsearNumeroCuenta(entrada.numero_cuenta);
  }

  if (Object.keys(update).length === 1) {
    throw new PortalInvestorPayloadError(
      "No hay ningún campo editable en la petición",
    );
  }

  return update;
};
