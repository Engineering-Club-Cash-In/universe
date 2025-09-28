// src/hooks/useReport.ts
import { useMutation } from "@tanstack/react-query";
import { type ReportKind, type ReportResponse, type ReportQuery, generateReport } from "../services/services";
 

/**
 * Generic hook to generate any report (by kind).
 * Usage:
 *   const m = useReport("cancelation");
 *   m.mutate({ numero_sifco: "ABC", format: "excel" }, { onSuccess: ... })
 */
export function useReport(kind: ReportKind) {
  return useMutation<ReportResponse, Error, ReportQuery>({
    mutationFn: (q) => generateReport(kind, q),
  });
}