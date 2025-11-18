import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const BACKEND_ENVIRONMENTS = {
  DEV: "localhost:9000/",
  PROD: "https://api.devteamatcci.site/",
};
