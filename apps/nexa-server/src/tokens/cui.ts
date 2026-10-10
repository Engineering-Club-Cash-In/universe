// Máximo de municipios por departamento de Guatemala (el CUI trae departamento
// en los dígitos 10-11 y municipio en los 12-13).
const MAX_MUNICIPIOS: Record<number, number> = {
  1: 17, 2: 8, 3: 16, 4: 16, 5: 14, 6: 14, 7: 19, 8: 8, 9: 24, 10: 21, 11: 9,
  12: 30, 13: 32, 14: 21, 15: 8, 16: 17, 17: 14, 18: 5, 19: 11, 20: 11, 21: 7, 22: 17,
};

export type CuiCheck = { valid: true } | { valid: false; reason: string };

/**
 * Valida un CUI/DPI de Guatemala (13 dígitos): correlativo (8), verificador (1),
 * departamento (2) y municipio (2). Verificador = (Σ dígito_i × (i+1), i = 1..8) mod 11;
 * si da 10 el CUI no puede ser válido. Los motivos NUNCA incluyen el CUI.
 */
export function validateCui(value: unknown): CuiCheck {
  if (typeof value !== "string") return { valid: false, reason: "debe ser texto de 13 dígitos (no número)" };
  if (!/^\d{13}$/.test(value)) return { valid: false, reason: "debe tener exactamente 13 dígitos" };
  const digits = [...value].map(Number);
  const sum = digits.slice(0, 8).reduce((acc, digit, index) => acc + digit * (index + 2), 0);
  const verifier = sum % 11;
  if (verifier === 10 || verifier !== digits[8]) return { valid: false, reason: "dígito verificador incorrecto" };
  const department = Number(value.slice(9, 11));
  const maxMunicipios = MAX_MUNICIPIOS[department];
  if (!maxMunicipios) return { valid: false, reason: "departamento fuera de 01-22" };
  const municipio = Number(value.slice(11, 13));
  if (municipio < 1 || municipio > maxMunicipios) {
    return { valid: false, reason: `municipio fuera de rango para el departamento ${String(department).padStart(2, "0")}` };
  }
  return { valid: true };
}
