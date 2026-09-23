import { estadoVisiblePago, type PagoParaAtraso } from "../../../lib/cuotaAtrasada";

const TONE_CLASSES = {
  blue: "bg-blue-100 text-blue-700",
  amber: "bg-amber-100 text-amber-800",
  green: "bg-green-100 text-green-700",
  red: "bg-red-100 text-red-700",
} as const;

export function PaymentStatusBadges({ payment }: {
  payment: Pick<PagoParaAtraso, "pagado" | "paymentFalse" | "validationStatus" | "cuota_pagada">;
}) {
  return (
    <div className="flex flex-col items-start gap-1 text-xs font-bold">
      {Object.values(estadoVisiblePago(payment)).map(({ label, tone }) => (
        <span
          key={label}
          className={`whitespace-nowrap rounded px-2 py-1 ${TONE_CLASSES[tone]}`}
        >
          {label}
        </span>
      ))}
    </div>
  );
}
