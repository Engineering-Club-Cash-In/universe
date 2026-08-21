import { z } from "zod";

/**
 * Mensajes por defecto de zod en español. Se instala una sola vez con
 * `z.setErrorMap()` en `main.tsx`, así todos los schemas de la app lo heredan.
 *
 * Precedencia de zod: el `{ message: "..." }` que declare el schema gana sobre
 * este mapa, y este mapa gana sobre el default en inglés.
 */
export const zodErrorMapEspanol: z.ZodErrorMap = (issue) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type: {
      if (issue.received === "undefined" || issue.received === "null") {
        return { message: "Este campo es obligatorio" };
      }
      if (issue.expected === "number" || issue.expected === "integer") {
        return { message: "Debe ser un número válido" };
      }
      if (issue.expected === "date") {
        return { message: "Fecha inválida" };
      }
      return { message: "El valor de este campo no es válido" };
    }

    case z.ZodIssueCode.too_small: {
      const min = String(issue.minimum);
      if (issue.type === "string") {
        return issue.minimum === 1
          ? { message: "Este campo es obligatorio" }
          : { message: `Debe tener al menos ${min} caracteres` };
      }
      if (issue.type === "array") {
        return { message: `Debe tener al menos ${min} elemento(s)` };
      }
      if (issue.type === "date") {
        return { message: "La fecha es demasiado antigua" };
      }
      return issue.inclusive
        ? { message: `Debe ser mayor o igual a ${min}` }
        : { message: `Debe ser mayor a ${min}` };
    }

    case z.ZodIssueCode.too_big: {
      const max = String(issue.maximum);
      if (issue.type === "string") {
        return { message: `Máximo ${max} caracteres` };
      }
      if (issue.type === "array") {
        return { message: `Máximo ${max} elemento(s)` };
      }
      if (issue.type === "date") {
        return { message: "La fecha es demasiado reciente" };
      }
      return issue.inclusive
        ? { message: `No puede ser mayor a ${max}` }
        : { message: `Debe ser menor a ${max}` };
    }

    case z.ZodIssueCode.invalid_enum_value:
    case z.ZodIssueCode.invalid_union_discriminator:
      return { message: "Debe seleccionar una opción válida" };

    case z.ZodIssueCode.invalid_string: {
      if (issue.validation === "email") return { message: "Correo electrónico inválido" };
      if (issue.validation === "url") return { message: "URL inválida" };
      if (issue.validation === "uuid") return { message: "Identificador inválido" };
      return { message: "Formato inválido" };
    }

    case z.ZodIssueCode.invalid_date:
      return { message: "Fecha inválida" };

    case z.ZodIssueCode.not_finite:
      return { message: "Debe ser un número válido" };

    case z.ZodIssueCode.not_multiple_of:
      return { message: `Debe ser múltiplo de ${String(issue.multipleOf)}` };

    case z.ZodIssueCode.unrecognized_keys:
      return { message: "Hay campos no reconocidos en el formulario" };

    case z.ZodIssueCode.invalid_literal:
    case z.ZodIssueCode.invalid_union:
      return { message: "El valor de este campo no es válido" };

    default:
      return { message: "Este campo no es válido" };
  }
};
