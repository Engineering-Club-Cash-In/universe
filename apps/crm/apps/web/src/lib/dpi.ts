/**
 * Validación del DPI/CUI guatemalteco: se reexporta la del servidor para que
 * el formulario y el endpoint apliquen exactamente la misma regla (formato,
 * departamento, municipio y dígito verificador).
 */
export { cuiValido, normalizarDpi } from "../../../server/src/utils/cui-validation";
