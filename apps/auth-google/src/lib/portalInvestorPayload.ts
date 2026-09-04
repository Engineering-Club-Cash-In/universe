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

/**
 * Tipos de cuenta que acepta el portal.
 *
 * Es una copia literal de `tipo_cuenta_enum` (cartera-back,
 * `src/database/db/schema.ts`). No se importa el schema de cartera para no
 * arrastrar drizzle y el modelo entero hasta este módulo, que es puro a
 * propósito; el cruce lo hace la prueba de contrato
 * `portalInvestorContract.test.ts`, que compara esta lista contra
 * `tipoCuentaEnum.enumValues` y falla en cuanto se desalinean.
 *
 * Recortarla no es una medida de seguridad: la columna acepta estos valores y
 * el portal ya los muestra, así que un inversionista que abría el modal y
 * confirmaba el valor que ya tenía recibía un 400.
 */
export const TIPOS_CUENTA = [
  "AHORRO",
  "AHORRO Q",
  "AHORROS",
  "AHORRO $",
  "MONETARIA",
  "MONETARIA Q",
  "MONETARIA $",
  "Capital",
] as const;

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
  const entrada =
    typeof valor === "string" ? valor.trim().replace(/\s+/g, " ") : "";

  // Se compara sin distinguir mayúsculas pero se devuelve el valor CANÓNICO del
  // enum: `toUpperCase()` a secas convertía "Capital" en "CAPITAL", que la
  // columna no admite.
  const canonico = TIPOS_CUENTA.find(
    (tipo) => tipo.toUpperCase() === entrada.toUpperCase(),
  );

  if (!canonico) {
    throw new PortalInvestorPayloadError("El tipo de cuenta no es válido");
  }

  return canonico;
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
