/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  usePendingCancelCredit,
  useInfoCancelCredit,
} from "../hooks/cancelCredit";
import {
  AlertCircle,
  Banknote,
  PercentCircle,
  BadgeDollarSign,
  ShieldCheck,
  ReceiptText,
  CalendarClock,
  FileText,
  X,
} from "lucide-react";

interface MotivoExtra {
  motivo: string;
  monto: number; // puede ser negativo para descuentos
}

export function ModalCancelCredit({
  open,
  onClose,
  creditId,
  onSuccess, // opcional
}: {
  open: boolean;
  onClose: () => void;
  creditId: number;
  onSuccess?: () => void;
}) {
  const cancelCredit = useInfoCancelCredit();
  const creditActionMutation = usePendingCancelCredit();

  const [motivos, setMotivos] = useState<MotivoExtra[]>([]);
  const [motivo, setMotivo] = useState("");
  const [monto, setMonto] = useState("");
  const [motivoCancel, setMotivoCancel] = useState("");
  const [observaciones, setObservaciones] = useState("");

  // Cargar info del crédito al abrir
  useEffect(() => {
    if (open && creditId) {
      cancelCredit.mutate(creditId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, creditId]);

  const agregarMotivo = () => {
    const montoNum = Number(monto);
    if (!motivo.trim()) return;
    if (Number.isNaN(montoNum)) return;
    setMotivos((prev) => [...prev, { motivo: motivo.trim(), monto: montoNum }]);
    setMotivo("");
    setMonto("");
  };

  const removeMotivo = (idx: number) =>
    setMotivos((prev) => prev.filter((_, i) => i !== idx));

  const credit = cancelCredit.data?.credito;

  // Totales base que ya vienen del servicio
  const totalBase = [
    Number(credit?.capital_actual ?? 0),
    Number(credit?.total_intereses_pendientes ?? 0),
    Number(credit?.total_membresias_pendientes ?? 0),
    Number(credit?.total_seguro_pendiente ?? 0),
    Number(credit?.total_iva_pendiente ?? 0),
  ].reduce((acc, v) => acc + v, 0);

  const totalMotivos = motivos.reduce((acc, curr) => acc + curr.monto, 0);
  const total = totalBase + totalMotivos;

  const handleClose = () => {
    setMotivos([]);
    setMotivo("");
    setMonto("");
    setMotivoCancel("");
    setObservaciones("");
    onClose();
  };

  const handleCancelCredit = () => {
    if (!motivoCancel.trim()) {
      alert("Debes escribir el motivo principal de la cancelación.");
      return;
    }
    const payload = {
      creditId,
      accion: "PENDIENTE_CANCELACION" as const,
      motivo: motivoCancel.trim(),
      observaciones: observaciones?.trim() || undefined,
      monto_cancelacion: total,
      // NUEVO: enviamos montosAdicionales al backend
      montosAdicionales: motivos.map((m) => ({
        concepto: m.motivo,
        monto: m.monto,
      })),
    };

    creditActionMutation.mutate(payload, {
      onSuccess: (data: any) => {
        alert(data?.message || "Crédito marcado como pendiente de cancelación");
        handleClose();
        onSuccess?.();
      },
      onError: (err: any) => {
        alert(err?.message || "No se pudo procesar la solicitud");
      },
    });
  };

  const handlePDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.setTextColor(33, 150, 243);
    doc.text("Resumen de Cancelación de Crédito", 105, 22, { align: "center" });

    const resumenCampos = [
      {
        label: "Capital actual",
        value: `Q${Number(credit?.capital_actual ?? 0).toLocaleString("es-GT", {
          minimumFractionDigits: 2,
        })}`,
      },
      {
        label: "Intereses pendientes",
        value: `Q${Number(
          credit?.total_intereses_pendientes ?? 0
        ).toLocaleString("es-GT", { minimumFractionDigits: 2 })}`,
      },
      {
        label: "Membresías pendientes",
        value: `Q${Number(
          credit?.total_membresias_pendientes ?? 0
        ).toLocaleString("es-GT", { minimumFractionDigits: 2 })}`,
      },
      {
        label: "Seguro pendiente",
        value: `Q${Number(credit?.total_seguro_pendiente ?? 0).toLocaleString(
          "es-GT",
          { minimumFractionDigits: 2 }
        )}`,
      },
      {
        label: "IVA pendiente",
        value: `Q${Number(credit?.total_iva_pendiente ?? 0).toLocaleString(
          "es-GT",
          { minimumFractionDigits: 2 }
        )}`,
      },
      {
        label: "Cuotas Atrasadas",
        value: credit?.cuotas_pendientes ?? 0,
      },
    ];

    let x = 14;
    let y = 34;
    resumenCampos.forEach(({ label, value }, i) => {
      doc.setFillColor(240, 248, 255);
      doc.roundedRect(x, y, 47, 18, 4, 4, "F");
      doc.setTextColor(33, 37, 41);
      doc.setFontSize(9);
      doc.text(label, x + 4, y + 7);
      doc.setFontSize(12);
      doc.setTextColor(37, 99, 235);
      (doc as any).setFont("helvetica", "bold");
      doc.text(String(value), x + 4, y + 14);
      x += 49;
      if ((i + 1) % 3 === 0) {
        x = 14;
        y += 22;
      }
    });

    y += 24;
    doc.setDrawColor(180, 180, 180);
    doc.line(14, y, 196, y);

    if (motivos.length) {
      autoTable(doc, {
        head: [["#", "Motivo", "Monto"]],
        body: motivos.map((mot, idx) => [
          idx + 1,
          mot.motivo,
          `Q${mot.monto.toLocaleString("es-GT", { minimumFractionDigits: 2 })}`,
        ]),
        startY: y + 6,
        headStyles: { fillColor: [33, 150, 243], textColor: 255 },
        bodyStyles: { fillColor: [245, 245, 250] },
        styles: { fontSize: 10, halign: "center" },
        columnStyles: { 2: { fontStyle: "bold" } },
      });
      y = (doc as any).lastAutoTable.finalY + 8;
    } else {
      y += 8;
    }

    doc.setFontSize(14);
    doc.setTextColor(22, 163, 74);
    (doc as any).setFont("helvetica", "bold");
    doc.text(
      `TOTAL: Q${total.toLocaleString("es-GT", { minimumFractionDigits: 2 })}`,
      196,
      y + 6,
      { align: "right" }
    );

    doc.setFontSize(8);
    doc.setTextColor(140, 140, 140);
    doc.text(
      "Generado por Club Cashin.com - " +
        new Date().toLocaleDateString("es-GT"),
      14,
      285
    );

    doc.save("cancelacion_credito.pdf");
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        className="
          backdrop-blur
          bg-white/80
          shadow-2xl
          border-blue-200
          rounded-2xl
          max-w-md
          w-[98vw]
          mx-auto
          px-2
          sm:px-8
          py-4
          sm:py-6
          !overflow-visible
        "
        style={{ border: "2px solid #60a5fa" }}
      >
        <div className="max-h-[80vh] overflow-y-auto">
          <div className="flex items-center gap-3 mb-4">
            <AlertCircle className="text-blue-600 w-7 h-7" />
            <span className="text-xl font-bold text-blue-700">
              Cancelar crédito
            </span>
          </div>

          {cancelCredit.error && (
            <p className="text-red-600">{cancelCredit.error.message}</p>
          )}

          {credit && (
            <div className="grid gap-3 mb-6">
              <div className="flex items-center gap-2">
                <Banknote className="text-green-700 w-5 h-5" />
                <span className="font-medium text-slate-700">
                  Capital actual:
                </span>
                <span className="font-bold text-green-700 ml-auto">
                  Q
                  {Number(credit.capital_actual).toLocaleString("es-GT", {
                    minimumFractionDigits: 2,
                  })}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <PercentCircle className="text-blue-700 w-5 h-5" />
                <span className="font-medium text-slate-700">
                  Intereses pendientes:
                </span>
                <span className="font-bold text-blue-700 ml-auto">
                  Q
                  {Number(
                    credit.total_intereses_pendientes
                  ).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <BadgeDollarSign className="text-yellow-600 w-5 h-5" />
                <span className="font-medium text-slate-700">
                  Membresías pendientes:
                </span>
                <span className="font-bold text-yellow-700 ml-auto">
                  Q
                  {Number(
                    credit.total_membresias_pendientes
                  ).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <ShieldCheck className="text-indigo-600 w-5 h-5" />
                <span className="font-medium text-slate-700">
                  Seguro pendiente:
                </span>
                <span className="font-bold text-indigo-700 ml-auto">
                  Q
                  {Number(credit.total_seguro_pendiente).toLocaleString(
                    "es-GT",
                    { minimumFractionDigits: 2 }
                  )}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <ReceiptText className="text-pink-600 w-5 h-5" />
                <span className="font-medium text-slate-700">
                  IVA pendiente:
                </span>
                <span className="font-bold text-pink-700 ml-auto">
                  Q
                  {Number(credit.total_iva_pendiente).toLocaleString("es-GT", {
                    minimumFractionDigits: 2,
                  })}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <CalendarClock className="text-gray-600 w-5 h-5" />
                <span className="font-medium text-slate-700">
                  Cuotas Atrasadas:
                </span>
                <span className="font-bold text-gray-700 ml-auto">
                  {credit.cuotas_pendientes}
                </span>
              </div>
            </div>
          )}

          {/* Montos adicionales */}
          <div className="grid gap-2 mb-2 bg-blue-50 border border-blue-200 rounded-xl p-3 shadow">
            <Label className="font-bold text-blue-700 flex items-center gap-1">
              <FileText className="w-4 h-4" />
              Montos adicionales
            </Label>
            <Input
              placeholder="Motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") agregarMotivo();
              }}
              className="bg-white/90 border-blue-300 focus:border-blue-500 focus:ring-blue-500 text-slate-800"
            />
            <Input
              placeholder="Monto (usa negativo para descuentos)"
              type="number"
              value={monto}
              step="0.01"
              onChange={(e) => setMonto(e.target.value)}
              onKeyDown={(e) => {
                // bloquear notación científica; permitir "-" y "."
                if (["e", "E", "+"].includes(e.key)) e.preventDefault();
              }}
              className="bg-white/90 border-blue-300 focus:border-blue-500 focus:ring-blue-500 text-slate-800"
            />
            <Button
              variant="outline"
              className="border-blue-400 text-blue-700 hover:bg-blue-100"
              onClick={agregarMotivo}
              disabled={!motivo || monto.trim() === "" || Number.isNaN(Number(monto))}
            >
              Agregar Monto
            </Button>
          </div>

          {/* Motivo principal + observaciones */}
          <div className="grid gap-2 mb-2 bg-blue-50 border border-blue-200 rounded-xl p-3 shadow">
            <Label className="font-bold text-blue-700 flex items-center gap-1">
              <AlertCircle className="w-4 h-4" />
              Motivo de cancelación
            </Label>
            <Input
              placeholder="Motivo de la cancelación"
              value={motivoCancel}
              onChange={(e) => setMotivoCancel(e.target.value)}
              className="bg-white/90 border-blue-300 focus:border-blue-500 focus:ring-blue-500 text-slate-800"
              required
            />
            <Label className="font-bold text-blue-700 flex items-center gap-1 mt-1">
              <FileText className="w-4 h-4" />
              Observaciones (opcional)
            </Label>
            <Input
              placeholder="Observaciones generales"
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              className="bg-white/90 border-blue-300 focus:border-blue-500 focus:ring-blue-500 text-slate-800"
            />
          </div>

          {/* Lista de motivos agregados */}
          <div className="mb-2 max-h-[96px] overflow-y-auto">
            {motivos.map((m, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-sm text-slate-700 border rounded px-2 py-1 bg-white/80 mb-1"
              >
                <FileText className="w-4 h-4 text-blue-600" />
                <span>{m.motivo}</span>
                <span className="font-bold text-blue-800 ml-auto">
                  Q{m.monto.toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                </span>
                <button
                  type="button"
                  title="Quitar motivo"
                  className="ml-2 text-red-500 hover:text-red-700 transition"
                  onClick={() => removeMotivo(i)}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          {/* Total */}
          <div className="font-extrabold text-xl text-right mt-3 mb-3 text-green-700 drop-shadow">
            TOTAL:{" "}
            <span className="text-green-700">
              Q{total.toLocaleString("es-GT", { minimumFractionDigits: 2 })}
            </span>
          </div>

          {/* Botones */}
          <div className="flex flex-col sm:flex-row gap-2 mt-2 sm:justify-end w-full">
            <Button
              variant="outline"
              className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold border-gray-300 shadow w-full sm:w-auto"
              onClick={handleClose}
            >
              Cerrar
            </Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-lg w-full sm:w-auto"
              onClick={handlePDF}
            >
              Descargar PDF
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white font-bold shadow-lg w-full sm:w-auto"
              onClick={handleCancelCredit}
              disabled={
                creditActionMutation.status === "pending" ||
                !motivoCancel.trim()
              }
              title={!motivoCancel.trim() ? "Escribe el motivo de cancelación" : ""}
            >
              {creditActionMutation.status === "pending"
                ? "Cancelando..."
                : "Cancelar Crédito"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
