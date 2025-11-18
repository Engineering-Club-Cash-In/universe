// src/hooks/useCancelCredit.ts
import { useMutation } from "@tanstack/react-query";
import {
  type CancelCreditResponse,
  cancelCreditService,
  creditAction,
  type CreditActionResponse,
  type CreditActionPayload, // <--- Usamos el tipo que soporta los 3 payloads
  type ActivateCreditPayload,
  type CancelCreditPayload,
  type BadDebtCreditPayload,
  type PendingCancelCreditPayload, // Si lo quieres importar individualmente
} from "../services/services";

// Hook específico para cancelar crédito (puedes dejarlo si lo usas en un lugar aparte)
export function useInfoCancelCredit() {
  return useMutation<CancelCreditResponse, Error, number>({
    mutationFn: cancelCreditService,
  });
}

// Hook genérico para todas las acciones de crédito (CANCELAR, ACTIVAR, INCOBRABLE)
export function useCreditAction() {
  return useMutation<CreditActionResponse, Error, CreditActionPayload>({
    mutationFn: creditAction,
  });
}

// Si quieres hooks individuales para cada acción, también puedes crearlos así:
export function useActivateCredit() {
  return useMutation<CreditActionResponse, Error, ActivateCreditPayload>({
    mutationFn: creditAction,
  });
}

export function useCancelCredit() {
  return useMutation<CreditActionResponse, Error, CancelCreditPayload>({
    mutationFn: creditAction,
  });
}

// Nuevo: para créditos incobrables, si quieres uno dedicado
export function useBadDebtCredit() {
  return useMutation<CreditActionResponse, Error, BadDebtCreditPayload>({
    mutationFn: creditAction,
  });
}
export function usePendingCancelCredit() {
  return useMutation<CreditActionResponse, Error, PendingCancelCreditPayload>({
    mutationFn: creditAction,
  });
}
export function openReportInNewTab(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}