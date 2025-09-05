// src/components/InfoCreditoEstadoModal.tsx
import * as React from "react";
import {
  XCircle,
  AlertCircle,
  FileDown,
  FileSpreadsheet,
  Loader2,
} from "lucide-react";
import {
  openReportUrl,
  type BadDebt,
  type CreditCancelation,
  type ReportFormat,
  type ReportKind,
} from "../services/services"; // ← ajusta si tu ruta es distinta
import { useReport } from "../hooks/reports";

// 🧱 shadcn/ui
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  numeroSifco: string;
  cancelacion?: CreditCancelation | null;
  incobrable?: BadDebt | null;
};

export default function InfoEstadoCredito({
  open,
  onOpenChange,
  numeroSifco,
  cancelacion,
  incobrable,
}: Props) {
  const isCancel = !!cancelacion;
  const isBadDebt = !!incobrable && !isCancel;

  const [kind, setKind] = React.useState<ReportKind>("cancelation");
  const m = useReport(kind);

  const gen = (format: ReportFormat) => {
    m.mutate(
      { numero_sifco: numeroSifco, format },
      { onSuccess: (res) => openReportUrl(res.url) }
    );
  };

  const Badge = ({
    tone,
    children,
  }: {
    tone: "danger" | "warn" | "neutral";
    children: React.ReactNode;
  }) => {
    const map = {
      danger: "bg-red-100 text-red-800 ring-1 ring-red-200",
      warn: "bg-yellow-100 text-yellow-900 ring-1 ring-yellow-200",
      neutral: "bg-slate-100 text-slate-700 ring-1 ring-slate-200",
    } as const;
    return (
      <span
        className={`px-2.5 py-1 rounded-full text-xs font-semibold ${map[tone]}`}
      >
        {children}
      </span>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div
          className={[
            "px-4 py-3",
            isCancel
              ? "bg-red-100"
              : isBadDebt
                ? "bg-yellow-100"
                : "bg-slate-100",
          ].join(" ")}
        >
          <DialogHeader className="flex flex-row items-center gap-2">
            {isCancel && <XCircle className="h-5 w-5 text-red-600" />}
            {isBadDebt && !isCancel && (
              <AlertCircle className="h-5 w-5 text-yellow-600" />
            )}
            <DialogTitle
              className={
                isCancel
                  ? "text-red-700"
                  : isBadDebt
                    ? "text-yellow-800"
                    : "text-slate-800"
              }
            >
              {isCancel
                ? "Crédito Cancelado"
                : isBadDebt
                  ? "Crédito Incobrable"
                  : "Estado del Crédito"}
            </DialogTitle>
            <div className="ml-auto">
              <Badge
                tone={isCancel ? "danger" : isBadDebt ? "warn" : "neutral"}
              >
                {isCancel
                  ? "Cancelación"
                  : isBadDebt
                    ? "Incobrable"
                    : "Sin info"}
              </Badge>
            </div>
          </DialogHeader>
          <DialogDescription className="sr-only">
            Estado y acciones de reporte del crédito {numeroSifco}
          </DialogDescription>
        </div>

        {/* Body */}
        <div className="px-4 pt-4 pb-2 bg-white">
          {isCancel && cancelacion && (
            <div className="space-y-1">
              <p className="text-sm text-red-900">
                <b>Motivo:</b> {cancelacion.motivo ?? "—"}
              </p>
              <p className="text-sm text-red-900">
                <b>Monto:</b>{" "}
                {`Q${Number(cancelacion.monto_cancelacion ?? 0).toLocaleString(
                  "es-GT",
                  {
                    minimumFractionDigits: 2,
                  }
                )}`}
              </p>
              <p className="text-xs text-red-800">
                <b>Fecha:</b>{" "}
                {cancelacion.fecha_cancelacion
                  ? new Date(cancelacion.fecha_cancelacion).toLocaleDateString(
                      "es-GT"
                    )
                  : "—"}
              </p>
              {!!cancelacion.observaciones && (
                <p className="text-xs text-slate-500">
                  <b>Obs:</b> {cancelacion.observaciones}
                </p>
              )}
            </div>
          )}

          {isBadDebt && incobrable && (
            <div className="space-y-1">
              <p className="text-sm text-yellow-900">
                <b>Motivo:</b> {incobrable.motivo ?? "—"}
              </p>
              <p className="text-sm text-yellow-900">
                <b>Monto:</b>{" "}
                {`Q${Number(incobrable.monto_incobrable ?? 0).toLocaleString(
                  "es-GT",
                  {
                    minimumFractionDigits: 2,
                  }
                )}`}
              </p>
              <p className="text-xs text-yellow-800">
                <b>Fecha:</b>{" "}
                {incobrable.fecha_registro
                  ? new Date(incobrable.fecha_registro).toLocaleDateString(
                      "es-GT"
                    )
                  : "—"}
              </p>
              {!!incobrable.observaciones && (
                <p className="text-xs text-slate-500">
                  <b>Obs:</b> {incobrable.observaciones}
                </p>
              )}
            </div>
          )}

          {!isCancel && !isBadDebt && (
            <p className="text-sm text-slate-700">
              No hay información de cancelación/incobrable.
            </p>
          )}

          {/* Acciones */}
          <div className="mt-4">
            <Label className="text-sm text-slate-700">Tipo de reporte</Label>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Select
                defaultValue="cancelation"
                onValueChange={(v) => setKind(v as ReportKind)}
              >
               <SelectTrigger
    className="w-full sm:w-64 rounded-lg border-slate-300 bg-slate-50 
               focus:ring-2 focus:ring-blue-500 text-slate-700"
  >
                  <SelectValue placeholder="Selecciona un reporte" />
                </SelectTrigger>
                <SelectContent className="z-[9999] rounded-lg border border-slate-200 bg-white shadow-lg">
                  <SelectItem
                    value="cancelation"
                    className="cursor-pointer text-slate-700 hover:bg-blue-50 focus:bg-blue-100"
                  >
                    Cancelación (externo)
                  </SelectItem>
                  <SelectItem
                    value="cancelation-intern"
                    className="cursor-pointer text-slate-700 hover:bg-blue-50 focus:bg-blue-100"
                  >
                    Cancelación Detallado (interno)
                  </SelectItem>
                  <SelectItem
                    value="cost-detail"
                    className="cursor-pointer text-slate-700 hover:bg-blue-50 focus:bg-blue-100"
                  >
                    Detalle de Costos
                  </SelectItem>
                </SelectContent>
              </Select>

              <div className="flex gap-2">
                {/* PDF: botón sólido primario */}
                <Button
                  className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
                  disabled={m.isPending}
                  onClick={() => gen("pdf")}
                >
                  {m.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FileDown className="h-4 w-4" />
                  )}
                  PDF
                </Button>

                {/* Excel: botón sólido verde */}
                <Button
                  className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={m.isPending}
                  onClick={() => gen("excel")}
                >
                  {m.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FileSpreadsheet className="h-4 w-4" />
                  )}
                  Excel
                </Button>
              </div>
            </div>

            <p className="mt-3 text-[11px] text-slate-500">
              N° SIFCO: <b>{numeroSifco}</b>
            </p>
          </div>
        </div>

        {/* Footer */}
        <DialogFooter className="px-4 pb-4 bg-slate-50">
          <DialogClose asChild>
            <Button variant="outline">Cerrar</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
