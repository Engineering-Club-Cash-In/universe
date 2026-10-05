import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Quita tildes/acentos y pasa a minúsculas para comparar textos.
 * Ej: "José María" → "jose maria"
 * Espejo de removeAccents() en cartera-back/src/utils/functions/generalFunctions.ts
 */
export function normalizeForSearch(str: string | null | undefined): string {
  if (!str) return "";
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * ¿El texto contiene todos los tokens del término de búsqueda?
 * Tolera acentos, mayúsculas, espacios extra y orden de palabras.
 * Ej: matchesSearch("Óscar Alfredo Méndez", "mendez oscar") === true
 */
export function matchesSearch(text: string | null | undefined, term: string): boolean {
  const normalizedTerm = normalizeForSearch(term).trim();
  if (!normalizedTerm) return true;
  const haystack = normalizeForSearch(text);
  return normalizedTerm.split(/\s+/).every((token) => haystack.includes(token));
}