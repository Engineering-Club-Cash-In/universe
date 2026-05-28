/* eslint-disable react-hooks/rules-of-hooks */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getPagosByCredito, getHistorialCambioFecha, type HistorialCambioFecha } from "../services/services";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { useState } from "react";
import React from "react";
import { Label } from "@/components/ui/label";
import {
  ChevronDown,
  ChevronUp,
  Search,
  Calendar,
  Loader2,
  CheckCircle2,
  BadgeDollarSign,
  CalendarDays,
  Hash,
  Info,
  FileText,
  Percent,
  Landmark,
  User,
  MoreVertical,
  RefreshCw,
} from "lucide-react";
import { usePagoForm } from "../hooks/registerPayment";
import { Button } from "@/components/ui/button";
import { useFalsePayment } from "../hooks/falsePayments";
import { useReciboPago } from "../hooks/useReciboPago";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@radix-ui/react-dropdown-menu";
import { useAuth } from "@/Provider/authProvider";
import { editPaymentService, type EditPaymentParams } from "../services/services";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DollarSign, Pencil } from "lucide-react";
import { toast } from "sonner";
// Iconos y colores por atributo
const iconMap: Record<string, { icon: React.ReactNode; color: string }> = {
  pago_id: {
    icon: <Hash className="w-4 h-4 text-blue-600" />,
    color: "text-blue-800",
  },
  credito_id: {
    icon: <Hash className="w-4 h-4 text-indigo-600" />,
    color: "text-indigo-800",
  },
  numero_cuota: {
    icon: <Info className="w-4 h-4 text-blue-400" />,
    color: "text-blue-700",
  },
  fecha_pago: {
    icon: <CalendarDays className="w-4 h-4 text-blue-500" />,
    color: "text-blue-700",
  },
  monto_boleta: {
    icon: <BadgeDollarSign className="w-4 h-4 text-green-600" />,
    color: "text-green-800",
  },
  monto_aplicado: {
    icon: <BadgeDollarSign className="w-4 h-4 text-green-500" />,
    color: "text-green-700",
  },
  fecha_aplicado: {
    icon: <CalendarDays className="w-4 h-4 text-green-600" />,
    color: "text-green-700",
  },
  cuota: {
    icon: <BadgeDollarSign className="w-4 h-4 text-indigo-700" />,
    color: "text-indigo-700",
  },
  cuota_interes: {
    icon: <BadgeDollarSign className="w-4 h-4 text-blue-500" />,
    color: "text-blue-600",
  },
  abono_capital: {
    icon: <BadgeDollarSign className="w-4 h-4 text-green-700" />,
    color: "text-green-700",
  },
  abono_interes: {
    icon: <BadgeDollarSign className="w-4 h-4 text-indigo-600" />,
    color: "text-indigo-600",
  },
  abono_iva_12: {
    icon: <BadgeDollarSign className="w-4 h-4 text-yellow-500" />,
    color: "text-yellow-700",
  },
  porcentaje_participacion: {
    icon: <Percent className="w-4 h-4 text-orange-500" />,
    color: "text-orange-700",
  },
  pagado: {
    icon: <BadgeDollarSign className="w-4 h-4 text-green-500" />,
    color: "text-green-800",
  },
  observaciones: {
    icon: <FileText className="w-4 h-4 text-blue-300" />,
    color: "text-blue-700",
  },
  // Puedes agregar más según tu interfaz
};
 
function formatCurrency(q: any) {
  return (
    "Q" +
    Number(q ?? 0).toLocaleString("es-GT", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}
function formatDate(d: string) {
  if (!d) return "--";
  // Si el string es tipo "2025-07-30"
  const [year, month, day] = d.split("-");
  return `${parseInt(day, 10)}/${parseInt(month, 10)}/${year}`;
}
function formatDateTime(d: string) {
  if (!d) return "--";
  const date = new Date(d);
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}
// --- Hook para editar pago ---
function useEditPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ pagoId, params }: { pagoId: number; params: EditPaymentParams }) =>
      editPaymentService(pagoId, params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pagosByCredito"] });
    },
  });
}

// --- Configuración de campos editables ---
interface EditField {
  key: string;
  label: string;
  group: "abonos" | "restantes" | "general";
}

const EDIT_FIELDS: EditField[] = [
  { key: "abono_capital", label: "Abono Capital", group: "abonos" },
  { key: "abono_interes", label: "Abono Interés", group: "abonos" },
  { key: "abono_iva_12", label: "Abono IVA 12%", group: "abonos" },
  { key: "abono_seguro", label: "Abono Seguro", group: "abonos" },
  { key: "abono_gps", label: "Abono GPS", group: "abonos" },
  { key: "membresias_pago", label: "Membresías Pago", group: "abonos" },
  { key: "membresias_mes", label: "Membresías Mes", group: "abonos" },
  { key: "capital_restante", label: "Capital Restante", group: "restantes" },
  { key: "interes_restante", label: "Interés Restante", group: "restantes" },
  { key: "iva_12_restante", label: "IVA 12% Restante", group: "restantes" },
  { key: "seguro_restante", label: "Seguro Restante", group: "restantes" },
  { key: "gps_restante", label: "GPS Restante", group: "restantes" },
  { key: "membresias", label: "Membresías Restante", group: "restantes" },
  { key: "monto_boleta", label: "Monto Boleta", group: "general" },
  { key: "monto_aplicado", label: "Monto Aplicado", group: "general" },
  { key: "mora", label: "Mora", group: "general" },
  { key: "otros", label: "Otros", group: "general" },
  { key: "observaciones", label: "Observaciones", group: "general" },
];

// --- Modal de edición de pago ---
function EditPaymentModal({
  pago,
  open,
  onClose,
  onSuccess,
}: {
  pago: any;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const editPayment = useEditPayment();

  const buildInitial = () => {
    const vals: Record<string, string> = {};
    for (const f of EDIT_FIELDS) {
      vals[f.key] = pago[f.key] != null ? String(pago[f.key]) : "";
    }
    return vals;
  };

  const [formValues, setFormValues] = React.useState<Record<string, string>>(buildInitial);

  React.useEffect(() => {
    if (open) setFormValues(buildInitial());
  }, [open, pago?.pago_id]);

  const handleChange = (key: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    // Mandar todos los campos que tengan valor (el backend acepta parcial)
    const payload: Record<string, string> = {};
    for (const f of EDIT_FIELDS) {
      const val = formValues[f.key];
      if (val !== undefined && val !== "") {
        payload[f.key] = val;
      }
    }

    if (Object.keys(payload).length === 0) {
      toast.info("No hay campos con valor para guardar");
      return;
    }

    editPayment.mutate(
      { pagoId: pago.pago_id, params: payload },
      {
        onSuccess: () => {
          onClose();
          toast.success("Pago actualizado correctamente");
          onSuccess();
        },
        onError: (error: any) => {
          toast.error(error?.response?.data?.message || "Error al actualizar pago");
        },
      },
    );
  };

  const renderGroup = (group: string, title: string, icon: React.ReactNode) => {
    const fields = EDIT_FIELDS.filter((f) => f.group === group);
    return (
      <div>
        <h4 className="text-sm font-bold text-blue-800 flex items-center gap-2 mb-3 border-b border-blue-100 pb-2">
          {icon}
          {title}
        </h4>
        <div className="grid grid-cols-2 gap-3">
          {fields.map((field) => (
            <div key={field.key} className="space-y-1">
              <Label className="text-xs font-semibold text-gray-700">{field.label}</Label>
              <Input
                type={field.key === "observaciones" ? "text" : "number"}
                step="0.01"
                value={formValues[field.key] ?? ""}
                onChange={(e) => handleChange(field.key, e.target.value)}
                className="h-9 text-sm border-gray-300 focus:border-blue-500"
              />
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-white text-gray-900 shadow-2xl rounded-xl border border-blue-200 max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-blue-900 flex items-center gap-2">
            <Pencil className="w-5 h-5" />
            Editar Pago — Cuota #{pago?.numero_cuota} (ID {pago?.pago_id})
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          {renderGroup("abonos", "Abonos", <DollarSign className="w-4 h-4 text-green-600" />)}
          {renderGroup("restantes", "Restantes", <DollarSign className="w-4 h-4 text-blue-600" />)}
          {renderGroup("general", "General", <FileText className="w-4 h-4 text-violet-600" />)}
        </div>

        <div className="flex justify-end gap-3 mt-4 pt-4 border-t border-gray-200">
          <Button
            variant="outline"
            onClick={onClose}
            className="border-gray-300"
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            disabled={editPayment.isPending}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold"
          >
            {editPayment.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Pencil className="w-4 h-4 mr-2" />
            )}
            {editPayment.isPending ? "Guardando..." : "Guardar Cambios"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const FIELD_LABELS: Record<string, string> = {
  pago_id: "ID Pago", numero_cuota: "# Cuota", pagado: "Estado",
  cuota_pagada: "Cuota pagada",
  liquidacion_inversionistas: "Liquidación", validationStatus: "Estado Validación",
  monto_boleta: "Monto Boleta", monto_aplicado: "Monto Aplicado", cuota: "Cuota",
  fecha_pago: "Fecha Pago", fecha_aplicado: "Fecha Aplicado", fecha_vencimiento: "Fecha Vencimiento",
  abono_capital: "Capital", abono_interes: "Interés", abono_iva_12: "IVA 12%", abono_seguro: "Seguro", abono_gps: "GPS",
  capital_restante: "Capital", interes_restante: "Interés", iva_12_restante: "IVA 12%",
  seguro_restante: "Seguro", gps_restante: "GPS", total_restante: "Total",
  membresias: "Membresías", membresias_pago: "Membresías Pago", membresias_mes: "Membresías Mes",
  mora: "Mora", otros: "Otros", reserva: "Reserva", observaciones: "Observaciones",
};

const DETAIL_SECTIONS = [
  { title: "Información General", icon: <Info className="w-4 h-4" />, color: "text-blue-700", bg: "bg-blue-50", border: "border-blue-200",
    fields: ["pago_id", "numero_cuota", "pagado", "cuota_pagada", "liquidacion_inversionistas", "validationStatus"] },
  { title: "Montos", icon: <BadgeDollarSign className="w-4 h-4" />, color: "text-green-700", bg: "bg-green-50", border: "border-green-200",
    fields: ["monto_boleta", "monto_aplicado", "cuota"] },
  { title: "Fechas", icon: <CalendarDays className="w-4 h-4" />, color: "text-indigo-700", bg: "bg-indigo-50", border: "border-indigo-200",
    fields: ["fecha_pago", "fecha_aplicado", "fecha_vencimiento"] },
  { title: "Abonos", icon: <BadgeDollarSign className="w-4 h-4" />, color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200",
    fields: ["abono_capital", "abono_interes", "abono_iva_12", "abono_seguro", "abono_gps"] },
  { title: "Restantes", icon: <Landmark className="w-4 h-4" />, color: "text-orange-700", bg: "bg-orange-50", border: "border-orange-200",
    fields: ["capital_restante", "interes_restante", "iva_12_restante", "seguro_restante", "gps_restante", "total_restante"] },
  { title: "Membresías", icon: <Percent className="w-4 h-4" />, color: "text-purple-700", bg: "bg-purple-50", border: "border-purple-200",
    fields: ["membresias", "membresias_pago", "membresias_mes"] },
  { title: "Mora, Otros y Observaciones", icon: <FileText className="w-4 h-4" />, color: "text-red-700", bg: "bg-red-50", border: "border-red-200",
    fields: ["mora", "otros", "reserva", "observaciones"] },
];

function formatFieldValue(key: string, value: any): string {
  if (value === null || value === undefined) return "--";
  if (key === "pagado" || key === "liquidacion_inversionistas" || key === "cuota_pagada")
    return value === true ? "Sí" : value === false ? "No" : String(value).replace(/_/g, " ");
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (key.startsWith("monto") || key.startsWith("cuota") || key.startsWith("abono") || key.endsWith("_restante") || key === "membresias" || key === "membresias_pago" || key === "membresias_mes" || key === "mora" || key === "otros" || key === "reserva")
    return formatCurrency(value);
  if (key.startsWith("fecha") && typeof value === "string" && value.includes("-"))
    return key === "fecha_aplicado" ? formatDateTime(value) : formatDate(value);
  return String(value);
}

const DetailSections = ({ pago }: { pago: any }) => (
  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full">
    {DETAIL_SECTIONS.map((section) => {
      const hasData = section.fields.some((f) => pago[f] !== undefined);
      if (!hasData) return null;
      return (
        <div key={section.title} className={`rounded-xl border ${section.border} ${section.bg} overflow-hidden`}>
          <div className={`flex items-center gap-2 px-3 py-2 ${section.color} font-bold text-sm border-b ${section.border}`}>
            {section.icon}
            {section.title}
          </div>
          <div className="px-3 py-2 space-y-1.5">
            {section.fields.map((field) => {
              if (pago[field] === undefined) return null;
              return (
                <div key={field} className="flex items-center justify-between text-sm gap-1">
                  <span className="text-gray-500 font-medium flex items-center gap-1">
                    {FIELD_LABELS[field] || field.replace(/_/g, " ")}
                    {field === "abono_capital" && pago.abono_capital_detalle && (
                      <>
                        <span className="inline-flex items-center px-1 py-0 rounded text-[9px] font-semibold bg-amber-100 text-amber-800 border border-amber-300">
                          {pago.abono_capital_detalle.tipo}
                        </span>
                        <span className="inline-flex items-center px-1 py-0 rounded text-[9px] font-semibold bg-blue-100 text-blue-800 border border-blue-300">
                          +{formatCurrency(pago.abono_capital_detalle.monto)}
                        </span>
                      </>
                    )}
                  </span>
                  <span className="font-bold text-gray-900 text-right">{formatFieldValue(field, pago[field])}</span>
                </div>
              );
            })}
          </div>
        </div>
      );
    })}
  </div>
);

function colorEstado(estado: string) {
  if (estado === "LIQUIDADO")
    return "bg-green-100 text-green-700 border-green-200";
  if (estado === "POR_LIQUIDAR")
    return "bg-yellow-100 text-yellow-800 border-yellow-300";
  return "bg-red-100 text-red-700 border-red-200";
}

export function PaymentsCredits() {
  const [showInversionistas, setShowInversionistas] = useState(false);
  const [collapseInv, setCollapseInv] = useState<{ [key: number]: boolean }>(
    {}
  );
  const falsePayment = useFalsePayment();
  const reciboPago = useReciboPago();
  const { user } = useAuth(); 
  const { liquidandoId, handleLiquidar, handleReverse, reversePago, handleRevertToPending, revertPaymentToPending, handleRevalidatePayment, revalidatePayment, handleProcessInvestors, processInvestors, recalcularPagos, handleRecalcularPagos } =
    usePagoForm();
  const [mesFiltro, setMesFiltro] = useState<string>("");
  const [anioFiltro, setAnioFiltro] = useState<string>("");
  const [search, setSearch] = useState("");
  const { numero_credito_sifco } = useParams<{
    numero_credito_sifco: string;
  }>();
  const navigate = useNavigate();
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [pagoParaEditar, setPagoParaEditar] = useState<any | null>(null);
  const [historialFecha, setHistorialFecha] = useState<HistorialCambioFecha[]>([]);

  React.useEffect(() => {
    if (!numero_credito_sifco) return;
    console.log("Cargando historial de cambio de fecha para crédito:", numero_credito_sifco);
    getHistorialCambioFecha(numero_credito_sifco)
      .then((res) => {
        console.log("Historial respuesta:", res);
        setHistorialFecha(Array.isArray(res) ? res : []);
      })
      .catch((err) => {
        console.error("Error al cargar historial:", err);
        setHistorialFecha([]);
      });
  }, [numero_credito_sifco]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["pagosByCredito", numero_credito_sifco],
    queryFn: () => getPagosByCredito(numero_credito_sifco!,false),
    enabled: !!numero_credito_sifco,
  });
const handleDownloadExcel = async () => {
  if (!numero_credito_sifco) return;

  try {
    const res = await getPagosByCredito(numero_credito_sifco, true); // 👈 pedimos excel
    // Check if response has excelUrl (is ExcelResponse)
    if ('excelUrl' in res && res.excelUrl) {
      const link = document.createElement("a");
      link.href = res.excelUrl;
      link.download = `pagos_${numero_credito_sifco}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      alert("⚠️ No se pudo generar el Excel.");
    }
  } catch (error) {
    console.error("❌ Error descargando Excel:", error);
  }
};
  const meses = [
    { value: "01", label: "Enero" },
    { value: "02", label: "Febrero" },
    { value: "03", label: "Marzo" },
    { value: "04", label: "Abril" },
    { value: "05", label: "Mayo" },
    { value: "06", label: "Junio" },
    { value: "07", label: "Julio" },
    { value: "08", label: "Agosto" },
    { value: "09", label: "Septiembre" },
    { value: "10", label: "Octubre" },
    { value: "11", label: "Noviembre" },
    { value: "12", label: "Diciembre" },
  ];

  const pagosFiltrados = Array.isArray(data) 
    ? data.filter((pago: any) => {
      if (!mesFiltro && !anioFiltro) return true;
      const fecha = new Date(pago.fecha_pago);
      const mes = (fecha.getMonth() + 1).toString().padStart(2, "0");
      const anio = fecha.getFullYear().toString();
      const mesOk = mesFiltro ? mes === mesFiltro : true;
      const anioOk = anioFiltro ? anio === anioFiltro : true;
      return mesOk && anioOk;
    })
    .filter(
      (pago: any) =>
        !search ||
        Object.values(pago)
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase())
    )
    : [];
  const handleFalsePayment = (pago_id: number, credito_id: number) => {
    falsePayment.mutate({ pago_id, credito_id });
  };
  return (
    <div className="fixed inset-x-0 top-16 xl:top-20 bottom-0 flex flex-col items-center justify-start bg-gradient-to-br from-blue-50 to-white px-2 overflow-auto pt-8 pb-8">
      <div className="w-full max-w-6xl mx-auto">
        <button
          className="mb-6 px-6 py-2 bg-blue-50 hover:bg-blue-100 rounded-lg font-bold text-blue-700 shadow"
          onClick={() => navigate(-1)}
        >
          ← Volver
        </button>
        <Label className="block text-3xl md:text-4xl font-extrabold mb-2 text-blue-700 text-center">
          Historial de Pagos del Crédito
        </Label>
        <Label className="block text-xl md:text-2xl font-bold mb-8 text-blue-600 text-center">
          {numero_credito_sifco}
        </Label>

        {/* Filtros */}
        <div className="flex flex-col md:flex-row gap-4 mb-8 justify-center items-center">
          <div className="flex items-center gap-2 bg-blue-50 border-2 border-blue-200 rounded-xl px-4 py-2 shadow-md">
            <Calendar className="text-blue-500 w-5 h-5" />
            <select
              value={mesFiltro}
              onChange={(e) => setMesFiltro(e.target.value)}
              className="bg-transparent outline-none text-blue-800 font-semibold"
            >
              <option value="">Mes</option>
              {meses.map((mes) => (
                <option key={mes.value} value={mes.value}>
                  {mes.label}
                </option>
              ))}
            </select>
            <select
              value={anioFiltro}
              onChange={(e) => setAnioFiltro(e.target.value)}
              className="bg-transparent outline-none text-blue-800 font-semibold"
            >
              <option value="">Año</option>
              {["2023", "2024", "2025", "2026"].map((anio) => (
                <option key={anio} value={anio}>
                  {anio}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 bg-blue-50 border-2 border-blue-200 rounded-xl px-4 py-2 shadow-md">
            <Search className="text-blue-500 w-5 h-5" />
            <input
              type="text"
              placeholder="Buscar pago (general)..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border-none outline-none bg-transparent text-blue-800 font-semibold placeholder-blue-400"
            />
          </div>
                <div className="flex items-center gap-2 bg-blue-50 border-2 border-blue-200 rounded-xl px-4 py-2 shadow-md">
          <button
            onClick={handleDownloadExcel}
            className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg shadow-md transition flex items-center gap-2"
          >
            <FileText className="w-5 h-5" />
            Descargar Excel
          </button>
        </div>

        </div>

          {historialFecha.length > 0 && (
            <div className="flex items-center gap-3 bg-blue-50 border-2 border-blue-200 rounded-xl px-4 py-2 shadow-md flex-wrap w-fit mx-auto mt-3">
              <Calendar className="w-4 h-4 text-blue-500 shrink-0" />
              <span className="text-blue-800 font-semibold text-sm shrink-0">Cambios fecha inicio:</span>
              {historialFecha.map((h) => (
                <span key={h.id} className="inline-flex items-center gap-1.5 bg-white border border-blue-200 rounded-lg px-3 py-1.5 text-sm">
                  <span className="text-gray-400 line-through">{h.fecha_inicio_anterior}</span>
                  <span className="text-gray-400">&rarr;</span>
                  <span className="font-semibold text-blue-700">{h.fecha_inicio_nueva}</span>
                  <span className="text-gray-400 text-xs ml-1">({new Date(h.created_at).toLocaleDateString("es-GT")})</span>
                </span>
              ))}
            </div>
          )}

        <div className="mt-6" />
        {isLoading ? (
          <div className="text-blue-500 text-center py-16 text-xl font-bold">
            Cargando pagos...
          </div>
        ) : isError ? (
          <div className="text-red-500 text-center py-16 text-lg font-semibold">
            Error cargando pagos
          </div>
        ) : !pagosFiltrados || pagosFiltrados.length === 0 ? (
          <div className="text-blue-700 bg-blue-50 text-center p-6 rounded-xl font-semibold shadow-inner">
            No hay pagos registrados para este crédito.
          </div>
        ) : (
          <div className="bg-white rounded-3xl shadow-xl p-6 w-full overflow-x-auto">
            <Table className="w-full text-lg text-gray-900">
              <TableHeader>
                <TableRow className="bg-blue-100 border-b-2 border-blue-200">
                  <TableHead className="w-12"></TableHead>
                  <TableHead className="font-bold text-blue-700">
                    # Pago
                  </TableHead>
                  <TableHead className="font-bold text-blue-700">
                    Monto Boleta
                  </TableHead>
                  <TableHead className="font-bold text-blue-700">
                    Monto Aplicado
                  </TableHead>
                  <TableHead className="font-bold text-blue-700">
                    Fecha de Pago
                  </TableHead>
                  <TableHead className="font-bold text-blue-700">
                    Fecha Aplicado
                  </TableHead>
                  <TableHead className="font-bold text-blue-700">
                    Cuota
                  </TableHead>
                  <TableHead className="font-bold text-blue-700">
                    Pagado
                  </TableHead>
                  <TableHead className="w-16 text-center font-bold text-blue-700">
                    Acciones
                  </TableHead>
                  <TableHead className="font-bold text-blue-700">
                    Boleta
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagosFiltrados.map((item, idx) => (
                  <React.Fragment key={item.pago.pago_id}>
                    <TableRow
                      className={idx % 2 === 0 ? "bg-blue-50" : "bg-white"}
                      style={{ cursor: "pointer" }}
                      onClick={() => setOpenIdx(openIdx === idx ? null : idx)}
                    >
                      <TableCell className="text-center">
                        {openIdx === idx ? (
                          <ChevronUp className="mx-auto text-blue-500" />
                        ) : (
                          <ChevronDown className="mx-auto text-blue-400" />
                        )}
                      </TableCell>
                      <TableCell className="text-center font-bold text-blue-700">
                        {item.pago.numero_cuota ?? idx + 1}
                      </TableCell>
                      <TableCell className="text-center text-blue-900 font-bold">
                        {formatCurrency(item.pago.monto_boleta)}
                      </TableCell>
                      <TableCell className="text-center text-green-700 font-bold">
                        {formatCurrency(item.pago.monto_aplicado)}
                      </TableCell>
                      <TableCell className="text-center font-semibold">
                        {formatDate(item.pago.fecha_pago)}
                      </TableCell>
                      <TableCell className="text-center font-semibold text-green-700">
                        {formatDateTime(item.pago.fecha_aplicado)}
                      </TableCell>
                      <TableCell className="text-center text-blue-700 font-semibold">
                        {formatCurrency(item.pago.cuota)}
                      </TableCell>
                      <TableCell className="text-center">
                        {item.pago.pagado ? (
                          <span className="px-2 py-1 rounded bg-green-100 text-green-700 font-bold">
                            Sí
                          </span>
                        ) : (
                          <span className="px-2 py-1 rounded bg-red-100 text-red-600 font-bold">
                            No
                          </span>
                        )}
                      </TableCell>
             <TableCell className="text-center">
              {user?.role === "ADMIN" ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="inline-flex items-center justify-center w-9 h-9 rounded-lg hover:bg-blue-100 transition">
                      <MoreVertical className="w-5 h-5 text-blue-700" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="bg-white border border-blue-200 shadow-xl rounded-xl p-1 min-w-[200px] z-50">
                    <DropdownMenuItem asChild>
                      <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold hover:bg-yellow-50 text-yellow-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
                        onClick={(e) => { e.stopPropagation(); handleReverse(item.pago.pago_id, item.pago.credito_id, true); }}
                        disabled={item.pago.paymentFalse === true}>
                        {reversePago.isPending ? <Loader2 className="animate-spin w-4 h-4" /> : null} Revertir Pago
                      </button>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold hover:bg-orange-50 text-orange-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
                        onClick={(e) => { e.stopPropagation(); handleRevertToPending(item.pago.pago_id, item.pago.credito_id); }}
                        disabled={item.pago.paymentFalse === true || revertPaymentToPending.isPending}>
                        {revertPaymentToPending.isPending ? <Loader2 className="animate-spin w-4 h-4" /> : null} Revertir Especial
                      </button>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-50 text-indigo-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
                        onClick={(e) => { e.stopPropagation(); handleProcessInvestors(item.pago.pago_id, item.pago.credito_id, item.pago.fecha_vencimiento); }}
                        disabled={processInvestors.isPending}>
                        {processInvestors.isPending ? <Loader2 className="animate-spin w-4 h-4" /> : null} Proc. Inversionistas
                      </button>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold hover:bg-purple-50 text-purple-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
                        onClick={(e) => { e.stopPropagation(); handleRevalidatePayment(item.pago.pago_id, item.pago.credito_id); }}
                        disabled={item.pago.pagado === true || item.pago.paymentFalse === true || revalidatePayment.isPending}>
                        {revalidatePayment.isPending ? <Loader2 className="animate-spin w-4 h-4" /> : null} Revalidar Pago
                      </button>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold hover:bg-red-50 text-red-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
                        onClick={(e) => { e.stopPropagation(); handleFalsePayment(item.pago.pago_id, item.pago.credito_id); refetch(); }}
                        disabled={falsePayment.isPending || item.pago.pagado === true || item.pago.paymentFalse === true}>
                        {falsePayment.isPending ? <Loader2 className="animate-spin w-4 h-4" /> : null} Pago Falso
                      </button>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold hover:bg-cyan-50 text-cyan-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
                        onClick={(e) => { e.stopPropagation(); handleRecalcularPagos(item.pago.numero_credito_sifco, item.pago.numero_cuota); }}
                        disabled={recalcularPagos.isPending}>
                        {recalcularPagos.isPending ? <Loader2 className="animate-spin w-4 h-4" /> : <RefreshCw className="w-4 h-4" />} Recalcular Pagos
                      </button>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold hover:bg-emerald-50 text-emerald-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
                        onClick={(e) => { e.stopPropagation(); reciboPago.mutate(item.pago.pago_id); }}
                        disabled={reciboPago.isPending}>
                        {reciboPago.isPending ? <Loader2 className="animate-spin w-4 h-4" /> : <FileText className="w-4 h-4" />} Recibo de Pago
                      </button>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold hover:bg-amber-50 text-amber-700 transition"
                        onClick={(e) => { e.stopPropagation(); setPagoParaEditar(item.pago); setEditModalOpen(true); }}>
                        <Pencil className="w-4 h-4" /> Editar Pago
                      </button>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : user?.role === "ASESOR" ? (
                <button
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 shadow-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
                  onClick={(e) => { e.stopPropagation(); reciboPago.mutate(item.pago.pago_id); }}
                  disabled={reciboPago.isPending}>
                  {reciboPago.isPending ? <Loader2 className="animate-spin w-4 h-4" /> : <FileText className="w-4 h-4" />} Recibo
                </button>
              ) : (
                <span className="text-gray-400 font-semibold italic text-xs">Sin permisos</span>
              )}
            </TableCell>

                      <TableCell className="text-center">
                        {Array.isArray(item.pago.boletas) &&
                        item.pago.boletas.length > 0 ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button className="inline-flex items-center px-3 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white font-semibold transition shadow">
                                <FileText className="w-4 h-4 mr-1" />
                                Ver boletas ({item.pago.boletas.length})
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="bg-white border border-blue-200 shadow-lg rounded-xl p-2 min-w-[170px]">
                              {item.pago.boletas.map((url, idx) => (
                                <DropdownMenuItem asChild key={idx}>
                                  <a
                                    href={url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    download
                                    className="flex items-center gap-2 px-2 py-1 rounded hover:bg-blue-50 font-semibold transition"
                                  >
                                    <FileText className="w-4 h-4 text-blue-600" />
                                    Boleta #{idx + 1}
                                  </a>
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : (
                          <span className="text-gray-400 font-semibold">
                            Sin boleta
                          </span>
                        )}
                      </TableCell>
                    </TableRow>

                    {openIdx === idx && (
                      <TableRow>
                        <TableCell
                          colSpan={9}
                          className="bg-blue-50 p-0 rounded-b-2xl"
                        >
                          <div className="p-6 space-y-6">
                            {/* Detalle de pago con iconos */}
                            <DetailSections pago={item.pago} />
                            {user?.role === "ADMIN" && (
  <>
                            {/* INVERSIONISTAS DETALLE */}
                            {item.inversionistasData?.length > 0 && (
                              <div className="space-y-2">
                                <div
                                  className="font-extrabold text-blue-700 cursor-pointer flex items-center gap-2 select-none text-lg"
                                  onClick={() =>
                                    setShowInversionistas((prev) => !prev)
                                  }
                                >
                                  Inversionistas asociados:
                                  <span className="text-blue-400">
                                    {showInversionistas ? "▼" : "►"}
                                  </span>
                                </div>
                                {showInversionistas && (
                                  <div
                                    className="w-full overflow-x-auto transition-all duration-300"
                                    style={{
                                      maxWidth: "100vw",
                                      WebkitOverflowScrolling: "touch",
                                      borderRadius: 8,
                                      border: "1px solid #c6dbfa",
                                    }}
                                  >
                                    <Table className="min-w-[900px] border text-blue-900 text-xs md:text-sm">
                                      <TableHeader>
                                        <TableRow className="bg-blue-100 sticky top-0 z-10">
                                          <TableHead className="font-bold text-blue-700">
                                            <User className="inline w-4 h-4 mr-1 text-indigo-400" />{" "}
                                            #
                                          </TableHead>
                                          <TableHead className="font-bold text-blue-700">
                                            Nombre
                                          </TableHead>
                                          <TableHead className="font-bold text-blue-700">
                                            Emite Factura
                                          </TableHead>
                                          <TableHead className="font-bold text-blue-700">
                                            % Participación
                                          </TableHead>
                                          <TableHead className="font-bold text-blue-700">
                                            % Cash In
                                          </TableHead>
                                          <TableHead className="font-bold text-blue-700">
                                            Monto Aportado
                                          </TableHead>
                                          <TableHead className="font-bold text-blue-700">
                                            IVA inversionista
                                          </TableHead>
                                          <TableHead className="font-bold text-blue-700">
                                            Detalles
                                          </TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {item.inversionistasData.map(
                                          (inv, index) => (
                                            <React.Fragment
                                              key={inv.inversionista_id}
                                            >
                                              <TableRow
                                                className="hover:bg-blue-50 transition"
                                                style={{ cursor: "pointer" }}
                                                onClick={() =>
                                                  setCollapseInv((prev) => ({
                                                    ...prev,
                                                    [index]: !prev[index],
                                                  }))
                                                }
                                              >
                                                <TableCell className="text-center font-bold flex items-center gap-1">
                                                  <User className="w-4 h-4 text-indigo-500" />{" "}
                                                  {index + 1}
                                                </TableCell>
                                                <TableCell className="font-semibold">
                                                  {inv.nombre}
                                                </TableCell>
                                                <TableCell className="text-center font-bold">
                                                  {inv.emite_factura
                                                    ? "Sí"
                                                    : "No"}
                                                </TableCell>
                                                <TableCell className="text-center font-bold">
                                                  {
                                                    inv.porcentaje_participacion_inversionista
                                                  }
                                                </TableCell>
                                                <TableCell className="text-center font-bold">
                                                  {inv.porcentaje_cash_in}
                                                </TableCell>
                                                <TableCell className="text-right font-semibold">
                                                  <BadgeDollarSign className="w-4 h-4 text-green-600 inline" />{" "}
                                                  {formatCurrency(
                                                    inv.monto_aportado
                                                  )}
                                                </TableCell>
                                                <TableCell className="text-right font-semibold">
                                                  <BadgeDollarSign className="w-4 h-4 text-yellow-600 inline" />{" "}
                                                  {formatCurrency(
                                                    inv.iva_inversionista
                                                  )}
                                                </TableCell>
                                                <TableCell className="text-center text-blue-500 font-bold">
                                                  {collapseInv[index]
                                                    ? "▲"
                                                    : "▼"}
                                                </TableCell>
                                              </TableRow>
                                              {collapseInv[index] && (
                                                <TableRow className="bg-blue-50">
                                                  <TableCell colSpan={9}>
                                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 p-2 text-[11px] md:text-xs">
                                                      <div>
                                                        <span className="font-bold text-blue-700">
                                                          IVA Cash In:{" "}
                                                        </span>
                                                        <span className="font-semibold text-gray-900">
                                                          {formatCurrency(
                                                            inv.iva_cash_in
                                                          )}
                                                        </span>
                                                      </div>
                                                      <div>
                                                        <span className="font-bold text-blue-700">
                                                          Cuota  :{" "}
                                                        </span>
                                                        <span className="font-semibold text-gray-900">
                                                          {formatCurrency(
                                                            inv.cuota_inversionista
                                                          )}
                                                        </span>
                                                      </div>
                                                      <div>
                                                        <span className="font-bold text-blue-700">
                                                          Cuota Interes Inversionista:{" "}
                                                        </span>
                                                        <span className="font-semibold text-gray-900">
                                                          {formatCurrency(
                                                            inv.monto_inversionista
                                                          )}
                                                        </span>
                                                      </div>
                                                      <div>
                                                        <span className="font-bold text-blue-700">
                                                          Cuota Interes Cash In:{" "}
                                                        </span>
                                                        <span className="font-semibold text-gray-900">
                                                          {formatCurrency(
                                                            inv.monto_cash_in
                                                          )}
                                                        </span>
                                                      </div>
                                                      <div>
                                                        <span className="font-bold text-blue-700">
                                                          Fecha Creación:{" "}
                                                        </span>
                                                        <span className="font-semibold text-gray-900">
                                                          {inv.fecha_creacion
                                                            ? new Date(
                                                                inv.fecha_creacion
                                                              ).toLocaleDateString()
                                                            : "--"}
                                                        </span>
                                                      </div>
                                                    </div>
                                                  </TableCell>
                                                </TableRow>
                                              )}
                                            </React.Fragment>
                                          )
                                        )}
                                      </TableBody>
                                    </Table>
                                  </div>
                                )}
                              </div>
                            )}
                            <tbody>
                              {/* ABONOS A INVERSIONISTAS */}
                              {item.pagosInversionistas?.length > 0 && (
                                <div className="space-y-2 mt-4">
                                  <div className="font-extrabold text-blue-700 text-lg">
                                    Abonos a inversionistas por este pago:
                                  </div>
                                  <div className="overflow-x-auto">
                                    <Table className="w-full border text-blue-900 rounded-2xl">
                                      <TableHeader>
                                        <TableRow className="bg-blue-50">
                                          <TableHead className="border px-2 py-1 font-bold text-blue-700">
                                            <User className="inline w-4 h-4 mr-1 text-indigo-400" />{" "}
                                            Inversionista
                                          </TableHead>
                                          <TableHead className="border px-2 py-1 font-bold text-green-700">
                                            <BadgeDollarSign className="inline w-4 h-4 mr-1 text-green-400" />{" "}
                                            Abono Capital
                                          </TableHead>
                                          <TableHead className="border px-2 py-1 font-bold text-blue-700">
                                            <BadgeDollarSign className="inline w-4 h-4 mr-1 text-blue-400" />{" "}
                                            Abono Interés
                                          </TableHead>
                                          <TableHead className="border px-2 py-1 font-bold text-yellow-700">
                                            <BadgeDollarSign className="inline w-4 h-4 mr-1 text-yellow-400" />{" "}
                                            Abono IVA
                                          </TableHead>
                                          <TableHead className="border px-2 py-1 font-bold text-gray-700">
                                            <Landmark className="inline w-4 h-4 mr-1 text-gray-400" />{" "}
                                            Estado Liquidación
                                          </TableHead>
                                          <TableHead className="border px-2 py-1 font-bold text-blue-700">
                                            Acción
                                          </TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {item.pagosInversionistas.map(
                                          (pagoInv) => (
                                            <TableRow key={pagoInv.id}>
                                              <TableCell className="border px-2 py-1 font-semibold">
                                                <div className="flex items-center gap-2">
                                                  <User className="w-4 h-4 text-indigo-500" />
                                                  <span className="text-indigo-700">
                                                    {pagoInv.nombre}
                                                  </span>
                                                </div>
                                              </TableCell>
                                              <TableCell className="border px-2 py-1 font-semibold">
                                                <div className="flex items-center gap-2">
                                                  <BadgeDollarSign className="w-4 h-4 text-green-600" />
                                                  <span className="text-green-800 break-words">
                                                    {formatCurrency(
                                                      pagoInv.abono_capital
                                                    )}
                                                  </span>
                                                  {pagoInv.abono_capital_detalle && (
                                                    <>
                                                      <span className="inline-flex items-center px-1 py-0 rounded text-[9px] font-semibold bg-amber-100 text-amber-800 border border-amber-300">
                                                        {pagoInv.abono_capital_detalle.tipo}
                                                      </span>
                                                      <span className="inline-flex items-center px-1 py-0 rounded text-[9px] font-semibold bg-blue-100 text-blue-800 border border-blue-300">
                                                        +{formatCurrency(pagoInv.abono_capital_detalle.monto)}
                                                      </span>
                                                    </>
                                                  )}
                                                </div>
                                              </TableCell>
                                              <TableCell className="border px-2 py-1 font-semibold">
                                                <div className="flex items-center gap-2">
                                                  <BadgeDollarSign className="w-4 h-4 text-blue-600" />
                                                  <span className="text-blue-800 break-words">
                                                    {formatCurrency(
                                                      pagoInv.abono_interes
                                                    )}
                                                  </span>
                                                </div>
                                              </TableCell>
                                              <TableCell className="border px-2 py-1 font-semibold">
                                                <div className="flex items-center gap-2">
                                                  <BadgeDollarSign className="w-4 h-4 text-yellow-500" />
                                                  <span className="text-yellow-700 break-words">
                                                    {formatCurrency(
                                                      pagoInv.abono_iva_12
                                                    )}
                                                  </span>
                                                </div>
                                              </TableCell>
                                              <TableCell className="border px-2 py-1">
                                                <div className="flex items-center gap-2">
                                                  <Landmark className="w-4 h-4 text-gray-500" />
                                                  <span
                                                    className={`px-3 py-1 rounded font-bold border ${colorEstado(
                                                      pagoInv.estado_liquidacion
                                                    )} text-sm`}
                                                  >
                                                    {pagoInv.estado_liquidacion.replace(
                                                      /_/g,
                                                      " "
                                                    )}
                                                  </span>
                                                </div>
                                              </TableCell>
                                              <TableCell className="border px-2 py-1">
                                                <button
                                                  className={`
                                            flex items-center gap-2
                                            px-3 py-1 rounded font-semibold shadow transition
                                            ${
                                              pagoInv.estado_liquidacion ===
                                              "LIQUIDADO"
                                                ? "bg-green-500 cursor-not-allowed text-white"
                                                : "bg-blue-600 hover:bg-blue-700 text-white"
                                            }
                                            ${
                                              liquidandoId === pagoInv.id
                                                ? "opacity-80"
                                                : ""
                                            }
                                          `}
                                                  disabled={
                                                    pagoInv.estado_liquidacion ===
                                                      "LIQUIDADO" ||
                                                    liquidandoId === pagoInv.id
                                                  }
                                                  onClick={() => {
                                                    handleLiquidar(
                                                      item.pago.pago_id,
                                                      pagoInv.credito_id,
                                                      Number(item.pago.cuota)
                                                    );
                                                    refetch();
                                                  }}
                                                >
                                                  {pagoInv.estado_liquidacion ===
                                                  "LIQUIDADO" ? (
                                                    <>
                                                      <CheckCircle2 className="w-5 h-5 text-white" />
                                                      Liquidado
                                                    </>
                                                  ) : liquidandoId ===
                                                    pagoInv.id ? (
                                                    <>
                                                      <Loader2 className="w-4 h-4 animate-spin" />
                                                      Liquidando...
                                                    </>
                                                  ) : (
                                                    <>Liquidar</>
                                                  )}
                                                </button>
                                              </TableCell>
                                            </TableRow>
                                          )
                                        )}
                                      </TableBody>
                                    </Table>
                                  </div>
                                </div>
                              )}
                            </tbody></>)}

                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Modal de edición de pago */}
      {pagoParaEditar && (
        <EditPaymentModal
          pago={pagoParaEditar}
          open={editModalOpen}
          onClose={() => {
            setEditModalOpen(false);
            setPagoParaEditar(null);
          }}
          onSuccess={() => refetch()}
        />
      )}
    </div>
  );
}
