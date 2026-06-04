import type { ReactNode } from "react";
import {
  Check,
  Download,
  Receipt,
  AlertCircle,
  X,
  Coins,
  ShieldCheck,
  FileText,
} from "lucide-react";
import type { FacturaGeneradaItem } from "../services/services";

// 💰 Formateo de moneda (GTQ)
const fmtQ = (val?: string | number | null) =>
  val == null || isNaN(Number(val))
    ? "--"
    : Number(val).toLocaleString("es-GT", {
        style: "currency",
        currency: "GTQ",
        minimumFractionDigits: 2,
      });

// 📊 Formateo de porcentaje ("70.00" -> "70%")
const fmtPct = (val?: string | number | null): string | null => {
  if (val == null || isNaN(Number(val))) return null;
  return `${Number(val)
    .toFixed(2)
    .replace(/\.00$/, "")
    .replace(/(\.\d)0$/, "$1")}%`;
};

// Base (interés / servicio sin IVA) = total - IVA
const baseDe = (f: FacturaGeneradaItem) =>
  Number(f.monto_total ?? 0) - Number(f.monto_iva ?? 0);

const sum = (
  arr: FacturaGeneradaItem[],
  sel: (f: FacturaGeneradaItem) => number | undefined | null,
) => arr.reduce((s, f) => s + Number(sel(f) ?? 0), 0);

interface Props {
  open: boolean;
  facturas: FacturaGeneradaItem[];
  onClose: () => void;
}

// 🧾 Fila de una factura individual dentro de una sección
function FilaFactura({ f }: { f: FacturaGeneradaItem }) {
  const esCube = f.tipo === "INTERESES_CUBE";
  const nombre = esCube ? "CUBE INVESTMENTS" : f.inversionista ?? "—";
  const pct = fmtPct(f.porcentaje_participacion);
  const pctCashIn = fmtPct(f.porcentaje_cash_in);
  const emisorDistinto =
    f.emisor && !f.emisor.toUpperCase().includes("CUBE") && !esCube;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-gray-900 truncate">
              {nombre}
            </span>
            {esCube && (
              <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                Residuo + cash-in
              </span>
            )}
            {pct && (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                Participación {pct}
              </span>
            )}
            {pctCashIn && pctCashIn !== "0%" && (
              <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-xs font-semibold text-cyan-700">
                Cash-in {pctCashIn}
              </span>
            )}
          </div>

          {emisorDistinto && (
            <p className="mt-0.5 text-xs text-gray-500">
              Emisor: <span className="font-medium">{f.emisor}</span>
            </p>
          )}

          {f.serie != null && f.numero != null && (
            <p className="mt-1 font-mono text-xs text-gray-600">
              {f.serie}-{f.numero}
            </p>
          )}

          {/* 🆕 Desglose del prorrateo (antes / después de la compra) */}
          {f.flujo === "NUEVO_PRORRATEADO" &&
            (f.parte_antes != null || f.parte_despues != null) && (
              <p className="mt-1 text-xs text-amber-700">
                Prorrateo · antes {fmtQ(f.parte_antes)} · después{" "}
                {fmtQ(f.parte_despues)}
              </p>
            )}
        </div>

        <div className="shrink-0 text-right">
          <p className="text-lg font-bold text-gray-900">
            {fmtQ(f.monto_total)}
          </p>
          <p className="text-xs text-gray-500">
            Base {fmtQ(baseDe(f))} · IVA {fmtQ(f.monto_iva)}
          </p>
          {f.pdfUrl && (
            <a
              href={f.pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800"
            >
              <Download className="h-3.5 w-3.5" />
              PDF
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// 📦 Sección agrupada (Intereses / Mora / Otros servicios / Otros)
function Seccion({
  titulo,
  icon,
  acento,
  items,
}: {
  titulo: string;
  icon: ReactNode;
  acento: string; // clase de color para el borde/encabezado
  items: FacturaGeneradaItem[];
}) {
  if (items.length === 0) return null;
  const total = sum(items, (f) => f.monto_total);
  const iva = sum(items, (f) => f.monto_iva);
  const base = total - iva;

  return (
    <div className={`rounded-xl border-l-4 ${acento} bg-gray-50 p-4`}>
      <div className="mb-3 flex items-center justify-between">
        <h4 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-gray-700">
          {icon}
          {titulo}
          <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-gray-500">
            {items.length}
          </span>
        </h4>
        <div className="text-right">
          <p className="text-base font-bold text-gray-900">{fmtQ(total)}</p>
          <p className="text-xs text-gray-500">
            Base {fmtQ(base)} · IVA {fmtQ(iva)}
          </p>
        </div>
      </div>
      <div className="space-y-2">
        {items.map((f, i) => (
          <FilaFactura key={i} f={f} />
        ))}
      </div>
    </div>
  );
}

// 🧮 Tarjeta de total general
function TotalCard({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className: string;
}) {
  return (
    <div className={`rounded-xl p-3 text-center ${className}`}>
      <p className="text-xs font-medium opacity-80">{label}</p>
      <p className="mt-0.5 text-lg font-bold">{value}</p>
    </div>
  );
}

export function ModalDesgloseFacturas({ open, facturas, onClose }: Props) {
  if (!open) return null;

  const exitosas = facturas.filter((f) => f.tipo !== "ERROR");
  const errores = facturas.filter((f) => f.tipo === "ERROR");
  const esProrrateado = exitosas.some((f) => f.flujo === "NUEVO_PRORRATEADO");

  const intereses = exitosas.filter(
    (f) => f.tipo === "INTERESES" || f.tipo === "INTERESES_CUBE",
  );
  const mora = exitosas.filter((f) => f.tipo === "MORA");
  const otrosServicios = exitosas.filter((f) => f.tipo === "OTROS_SERVICIOS");
  const otros = exitosas.filter((f) => f.tipo === "OTROS");

  const totalGeneral = sum(exitosas, (f) => f.monto_total);
  const ivaGeneral = sum(exitosas, (f) => f.monto_iva);
  const baseGeneral = totalGeneral - ivaGeneral;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* HEADER */}
        <div className="bg-gradient-to-r from-emerald-600 to-green-600 p-6 text-white">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-2xl font-bold">
                <Check className="h-7 w-7" />
                Facturas generadas
              </h3>
              <p className="mt-1 text-sm text-emerald-50">
                {exitosas.length} factura(s) emitida(s)
                {errores.length > 0 && ` · ${errores.length} con error`}
                {esProrrateado && " · flujo prorrateado"}
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded-full p-1 transition-colors hover:bg-white/20"
              aria-label="Cerrar"
            >
              <X className="h-6 w-6" />
            </button>
          </div>

          {/* TOTALES GENERALES */}
          <div className="mt-4 grid grid-cols-3 gap-3">
            <TotalCard
              label="Base"
              value={fmtQ(baseGeneral)}
              className="bg-white/15 text-white"
            />
            <TotalCard
              label="IVA"
              value={fmtQ(ivaGeneral)}
              className="bg-white/15 text-white"
            />
            <TotalCard
              label="Total"
              value={fmtQ(totalGeneral)}
              className="bg-white text-emerald-700"
            />
          </div>
        </div>

        {/* BODY */}
        <div className="space-y-4 overflow-y-auto p-6">
          {esProrrateado && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              <Receipt className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Este pago se facturó con el <b>flujo prorrateado</b> por compra
                de cartera: el interés se repartió entre la distribución de
                inversionistas <b>antes</b> y <b>después</b> de la compra.
              </span>
            </div>
          )}

          <Seccion
            titulo="Intereses"
            icon={<Coins className="h-4 w-4 text-emerald-600" />}
            acento="border-emerald-500"
            items={intereses}
          />
          <Seccion
            titulo="Mora"
            icon={<AlertCircle className="h-4 w-4 text-red-600" />}
            acento="border-red-500"
            items={mora}
          />
          <Seccion
            titulo="Otros servicios"
            icon={<ShieldCheck className="h-4 w-4 text-blue-600" />}
            acento="border-blue-500"
            items={otrosServicios}
          />
          <Seccion
            titulo="Otros"
            icon={<FileText className="h-4 w-4 text-gray-600" />}
            acento="border-gray-400"
            items={otros}
          />

          {/* ERRORES */}
          {errores.length > 0 && (
            <div className="rounded-xl border-l-4 border-red-500 bg-red-50 p-4">
              <h4 className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-red-700">
                <AlertCircle className="h-4 w-4" />
                Con error
                <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-red-500">
                  {errores.length}
                </span>
              </h4>
              <div className="space-y-2">
                {errores.map((f, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-red-200 bg-white p-3 text-sm"
                  >
                    <p className="font-semibold text-red-800">
                      {f.concepto || f.inversionista || "Factura"}
                    </p>
                    <p className="mt-0.5 text-xs text-red-600">{f.error}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* FOOTER */}
        <div className="border-t border-gray-100 p-4">
          <button
            onClick={onClose}
            className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 font-semibold text-white transition-colors hover:bg-emerald-700"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
