/* eslint-disable react-hooks/rules-of-hooks */
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, Fragment } from "react";

import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  BadgeDollarSign,
  Users2,
  FileText,
  Check,
  FileSpreadsheet,
  Download,
  Loader2,
  MoreVertical,
  Undo2,
  Receipt,
  AlertCircle,
  Calendar,
  DollarSign,
  User,
  CalendarRange,
  ListFilter,
  ChevronsUpDown,
  Hash,
  Handshake,
  CheckCircle,
  RotateCcw,
} from "lucide-react";
import { Combobox, Transition } from "@headlessui/react";
import {
  useAplicarPago,
  useEditPayment,
  usePagosConInversionistas,
} from "../hooks/reportPayments";
import {
  getPagosConInversionistasService,
  type CancelacionPago,
  type CuentaEmpresa,
  type Investor,
  type PagoDataInvestor,
} from "../services/services";
import { ModalInversionistas } from "./modalViewInvestor";
import { useCatalogs } from "../hooks/catalogs";

import { useAuth } from "@/Provider/authProvider";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

import { Button } from "@/components/ui/button";
import { usePagoForm } from "../hooks/registerPayment";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@radix-ui/react-dropdown-menu";
import { useActualizarCuentaPago, useCuentasEmpresa } from "../hooks/account";
import { useFacturarPagoCompleto } from "../hooks/cofidi";
import { ModalFacturasPago } from "./modalFacts";
import { DatePickerMUI } from "./calendar";

// --- utilidades ---
const meses = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];
const currentYear = new Date().getFullYear();
const years = Array.from(
  { length: currentYear + 2 - 2020 + 1 },
  (_, i) => 2020 + i,
);
const formatCurrency = (val?: string | number | null) =>
  val == null || isNaN(Number(val))
    ? "--"
    : Number(val).toLocaleString("es-GT", {
        style: "currency",
        currency: "GTQ",
        minimumFractionDigits: 2,
      });
const formatDate = (d?: string) => {
  if (!d) return "--";

  const [datePart, timePart] = d.split(" ");

  if (!datePart) return "--";

  const [year, month, day] = datePart.split("-");

  const time = timePart || "00:00:00";

  return `${day}/${month}/${year} ${time}`;
};

// --- hook para detectar pantallas pequeñas ---
function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(false);
  React.useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  return isMobile;
}

// --- componente de rubros de cancelación para pagos reset ---
function CancelacionRubros({
  cancelacion,
  pagoId,
  onSuccess,
}: {
  cancelacion: CancelacionPago;
  pagoId: number;
  onSuccess: () => void;
}) {
  const editPayment = useEditPayment();

  // Armar la lista de rubros seleccionables desde la cancelación
  const rubrosBase: { nombre: string; monto: number }[] = [
    { nombre: "Traspaso", monto: Number(cancelacion.traspaso) || 0 },
    { nombre: "Garantía Mobiliaria", monto: Number(cancelacion.garantiaMobiliaria) || 0 },
    { nombre: "Otros", monto: Number(cancelacion.otros) || 0 },
    { nombre: "Cuotas Atrasadas", monto: cancelacion.cuotasAtrasadas || 0 },
    ...(cancelacion.montosAdicionales || []).map((ma) => ({
      nombre: ma.concepto,
      monto: Number(ma.monto) || 0,
    })),
  ].filter((r) => r.monto > 0);

  const [selected, setSelected] = React.useState<Record<number, boolean>>({});

  const total = rubrosBase.reduce(
    (sum, r, i) => (selected[i] ? sum + r.monto : sum),
    0,
  );

  const toggleRubro = (idx: number) => {
    setSelected((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const handleGuardar = () => {
    editPayment.mutate(
      { pagoId, params: { otros: total } },
      {
        onSuccess: () => {
          toast.success("Rubros de cancelación aplicados correctamente");
          onSuccess();
        },
        onError: (error: any) => {
          toast.error(error?.response?.data?.message || "Error al aplicar rubros");
        },
      },
    );
  };

  return (
    <div className="mt-4 p-4 bg-orange-50 border-2 border-orange-200 rounded-xl">
      <h5 className="text-orange-800 font-bold flex items-center gap-2 mb-1">
        <RotateCcw className="w-5 h-5" />
        Cancelación — {cancelacion.motivo}
      </h5>
      {cancelacion.observaciones && (
        <p className="text-orange-700 text-sm mb-3">{cancelacion.observaciones}</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 mb-4">
        {rubrosBase.map((rubro, idx) => (
          <label
            key={idx}
            className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
              selected[idx]
                ? "border-orange-400 bg-orange-100"
                : "border-gray-200 bg-white hover:border-orange-300"
            }`}
          >
            <input
              type="checkbox"
              checked={!!selected[idx]}
              onChange={() => toggleRubro(idx)}
              className="w-4 h-4 accent-orange-600"
            />
            <div className="flex-1">
              <span className="font-semibold text-gray-800 text-sm">{rubro.nombre}</span>
              <span className="block text-orange-700 font-bold">
                {formatCurrency(rubro.monto)}
              </span>
            </div>
          </label>
        ))}
      </div>

      <div className="flex items-center justify-between bg-white border-2 border-orange-200 rounded-lg p-3">
        <div>
          <span className="text-sm text-gray-600">Total seleccionado:</span>
          <span className="ml-2 text-xl font-bold text-orange-700">
            {formatCurrency(total)}
          </span>
        </div>
        <Button
          onClick={handleGuardar}
          disabled={editPayment.isPending || total === 0}
          className="bg-orange-600 hover:bg-orange-700 text-white font-semibold px-6"
        >
          {editPayment.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : null}
          {editPayment.isPending ? "Guardando..." : "Aplicar como Otros"}
        </Button>
      </div>
    </div>
  );
}

// --- componente principal ---
export function PaymentsTable() {
  const [validandoPagoId, setValidandoPagoId] = useState<number | null>(null);
  const [generandoFacturaId, setGenerandoFacturaId] = useState<number | null>(
    null,
  );

  const { user } = useAuth();
  // 🆕 Estados para modal de ver facturas
  const [modalVerFacturasOpen, setModalVerFacturasOpen] = useState(false);
  const [pagoIdParaVerFacturas, setPagoIdParaVerFacturas] = useState<
    number | null
  >(null);
  const { handleReverse, reversePago, handleRevertToPending, revertPaymentToPending, handleRevalidatePayment, revalidatePayment, handleProcessInvestors, processInvestors } = usePagoForm();
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isDownloadingExcel, setIsDownloadingExcel] = useState(false);
  const [isDownloadingAdvisor, setIsDownloadingAdvisor] = useState(false);
  const isMobile = useIsMobile();
  const { investors } = useCatalogs() as {
    investors: Investor[];
    advisors: any[];
    loading: boolean;
  };
  const { mutate: aplicarPago, isPending } = useAplicarPago();
  const facturarPago = useFacturarPagoCompleto(); // 🆕 NUEVO HOOK

  // Filtros de fecha - modo "simple" (año/mes/día), "rango" (fechaInicio/fechaFin) o "aplicado" (fechaAplicado)
  const [modoFecha, setModoFecha] = React.useState<"simple" | "rango" | "aplicado" | "boleta">("simple");
  const [mes, setMes] = React.useState(new Date().getMonth() + 1);
  const [anio, setAnio] = React.useState(new Date().getFullYear());
  const [dia, setDia] = React.useState<number | undefined>(
    new Date().getDate(),
  );
  const [fechaInicio, setFechaInicio] = React.useState("");
  const [fechaFin, setFechaFin] = React.useState("");
  const [fechaAplicado, setFechaAplicado] = React.useState("");
  const [fechaBoleta, setFechaBoleta] = React.useState("");

  // Filtros de crédito
  const [sifco, setSifco] = React.useState("");
  const [categoriaCredito, setCategoriaCredito] = React.useState("");
  const [formatoCredito, setFormatoCredito] = React.useState("");

  // Filtros generales
  const [usuarioNombre, setUsuarioNombre] = React.useState("");
  const [inversionistaId, setInversionistaId] = React.useState<
    number | undefined
  >();
  const [soloAplicados, setSoloAplicados] = React.useState<boolean | undefined>(undefined);
  const [validationStatusFilter, setValidationStatusFilter] = React.useState<string>("");
  const [queryInv, setQueryInv] = React.useState("");
  const filteredInvestors = queryInv === ""
    ? investors
    : investors.filter((inv) => inv.nombre.toLowerCase().includes(queryInv.toLowerCase()));


  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(10);
  const { data: cuentas, isLoading: cargandoCuentas } = useCuentasEmpresa();
  const { mutate: actualizarCuenta, isPending: actualizandoCuenta } =
    useActualizarCuentaPago();

  // Estados para el modal de cuenta
  const [modalCuentaOpen, setModalCuentaOpen] = useState(false);
  const [pagoSeleccionado, setPagoSeleccionado] = useState<number | null>(null);

  // 🆕 Estados para modal de facturas generadas
  const [modalFacturasOpen, setModalFacturasOpen] = useState(false);
  const [facturasGeneradas, setFacturasGeneradas] = useState<any[]>([]);

  // Handler para abrir modal de cuenta
  const handleAbrirModalCuenta = (pagoId: number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setPagoSeleccionado(pagoId);
    setModalCuentaOpen(true);
  };

  // Handler para seleccionar cuenta
  const handleSeleccionarCuenta = (cuentaId: number) => {
    if (!pagoSeleccionado || !cuentaId) {
      console.error("❌ Faltan parámetros:", { pagoSeleccionado, cuentaId });
      toast.error("Error: Datos incompletos");
      return;
    }

    console.log("✅ Actualizando cuenta:", {
      pagoId: pagoSeleccionado,
      cuentaEmpresaId: cuentaId,
    });

    actualizarCuenta(
      {
        pagoId: pagoSeleccionado,
        cuentaEmpresaId: cuentaId,
      },
      {
        onSuccess: () => {
          setModalCuentaOpen(false);
          setPagoSeleccionado(null);
          refetch();
        },
      },
    );
  };

  // 🆕 Handler para facturar pago
const handleFacturarPago = (pagoId: number, e?: React.MouseEvent) => {
  if (e) e.stopPropagation();

  facturarPago.mutate(
    {
      pago_id: pagoId,
      created_by: user?.id || undefined,
    },
    {
      onSuccess: (data) => {
        setGenerandoFacturaId(null);
        
        if (data.success && data.data) {
          setFacturasGeneradas(data.data.facturas);
          setModalFacturasOpen(true);
          refetch();
          toast.success("✅ Facturas generadas exitosamente");
        }
      },
      onError: (error: any) => {
        setGenerandoFacturaId(null);

        const errorData = error?.response?.data;

        if (errorData?.facturasExistentes) {
          // Error específico: Ya tiene facturas
          toast.warning(errorData.message, {
            description: `Facturas: ${errorData.facturasExistentes.map((f: any) => `${f.serie}-${f.numero}`).join(", ")}`,
            duration: 5000,
          });
        } else if (errorData?.message) {
          // Otros errores del backend
          toast.error(errorData.message);
        } else {
          // Error genérico
          toast.error("Error al generar facturas electrónicas");
        }
      }
    },
  );
};
  const handleVerFacturas = (pagoId: number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setPagoIdParaVerFacturas(pagoId);
    setModalVerFacturasOpen(true);
  };
 
  // --- helper para el status de validación con iconos ---
  const getValidationStatusConfig = (status: string) => {
    const configs: Record<
      string,
      {
        label: string;
        color: string;
        bgColor: string;
        icon: React.JSX.Element;
      }
    > = {
      no_requiere: {
        label: "No requiere",
        color: "text-gray-700",
        bgColor: "bg-gray-100",
        icon: <Check className="w-4 h-4" />,
      },
      no_required: {
        label: "No requiere",
        color: "text-gray-700",
        bgColor: "bg-gray-100",
        icon: <Check className="w-4 h-4" />,
      },
      pendiente: {
        label: "Pendiente",
        color: "text-yellow-700",
        bgColor: "bg-yellow-100",
        icon: <Loader2 className="w-4 h-4" />,
      },
      pending: {
        label: "Pendiente",
        color: "text-yellow-700",
        bgColor: "bg-yellow-100",
        icon: <Loader2 className="w-4 h-4" />,
      },
      validated: {
        label: "Validado",
        color: "text-green-700",
        bgColor: "bg-green-100",
        icon: <Check className="w-4 h-4" />,
      },
      capital: {
        label: "Capital",
        color: "text-blue-700",
        bgColor: "bg-blue-100",
        icon: <DollarSign className="w-4 h-4" />,
      },
      reset: {
        label: "Reset",
        color: "text-orange-700",
        bgColor: "bg-orange-100",
        icon: <RotateCcw className="w-4 h-4" />,
      },
    };

    return configs[status] || configs.no_required;
  };

  // Función para verificar si tiene cuenta asignada
  const tieneCuentaAsignada = (pago: PagoDataInvestor) => {
    return (
      pago.cuentaEmpresaNombre !== null ||
      pago.cuentaEmpresaBanco !== null ||
      pago.cuentaEmpresaNumero !== null
    );
  };

  const { data, isLoading, refetch } = usePagosConInversionistas({
    page,
    pageSize,
    numeroCredito: sifco || undefined,
    // Fecha: modo simple, rango o aplicado (mutuamente excluyentes)
    ...(modoFecha === "simple"
      ? { dia, mes, anio }
      : modoFecha === "rango"
        ? { fechaInicio: fechaInicio || undefined, fechaFin: fechaFin || undefined }
        : modoFecha === "aplicado"
          ? { fechaAplicado: fechaAplicado || undefined }
          : { fechaBoleta: fechaBoleta || undefined }),
    categoriaCredito: categoriaCredito || undefined,
    formatoCredito: formatoCredito || undefined,
    soloAplicados,
    inversionistaId,
    usuarioNombre: usuarioNombre || undefined,
    validationStatus: validationStatusFilter || undefined,
  });

  const pagos: PagoDataInvestor[] = data?.data || [];
  const totalPages = data?.totalPages ?? 0;

  const [openIdx, setOpenIdx] = React.useState<number | null>(null);
  const [selectedInv, setSelectedInv] = React.useState<
    PagoDataInvestor["inversionistas"]
  >([]);
  const [modalOpen, setModalOpen] = React.useState(false);

  const handleOpenInversionistas = (
    inv: PagoDataInvestor["inversionistas"],
  ) => {
    setSelectedInv(inv);
    setModalOpen(true);
  };

  const handleDownloadExcel = async () => {
    try {
      setIsDownloadingExcel(true);
      toast.loading("Generando reporte Excel...", { id: "excel-download" });

      const response = await getPagosConInversionistasService({
        page,
        pageSize,
        numeroCredito: sifco || undefined,
        ...(modoFecha === "simple"
          ? { dia, mes, anio }
          : modoFecha === "rango"
            ? { fechaInicio: fechaInicio || undefined, fechaFin: fechaFin || undefined }
            : { fechaAplicado: fechaAplicado || undefined }),
        categoriaCredito: categoriaCredito || undefined,
        formatoCredito: formatoCredito || undefined,
        soloAplicados,
        inversionistaId,
        usuarioNombre: usuarioNombre || undefined,
        validationStatus: validationStatusFilter || undefined,
        excel: true,
      });

      if (response.excelUrl) {
        window.open(response.excelUrl, "_blank");
        toast.success("✅ Reporte generado correctamente", {
          id: "excel-download",
        });
      } else {
        toast.error("No se pudo generar el reporte", { id: "excel-download" });
      }
    } catch (error: any) {
      console.error("Error al generar Excel:", error);
      toast.error("Error al generar el reporte", { id: "excel-download" });
    } finally {
      setIsDownloadingExcel(false);
    }
  };

  const handleDownloadAdvisorExcel = async () => {
    try {
      setIsDownloadingAdvisor(true);
      toast.loading("Generando reporte de asesores...", { id: "advisor-download" });

      const response = await getPagosConInversionistasService({
        page,
        pageSize,
        numeroCredito: sifco || undefined,
        ...(modoFecha === "simple"
          ? { dia, mes, anio }
          : modoFecha === "rango"
            ? { fechaInicio: fechaInicio || undefined, fechaFin: fechaFin || undefined }
            : { fechaAplicado: fechaAplicado || undefined }),
        categoriaCredito: categoriaCredito || undefined,
        formatoCredito: formatoCredito || undefined,
        soloAplicados,
        inversionistaId,
        usuarioNombre: usuarioNombre || undefined,
        validationStatus: validationStatusFilter || undefined,
        reportAdvisor: true,
      });

      if (response.excelUrl) {
        window.open(response.excelUrl, "_blank");
        toast.success("Reporte de asesores generado", { id: "advisor-download" });
      } else {
        toast.error("No se pudo generar el reporte", { id: "advisor-download" });
      }
    } catch (error: any) {
      console.error("Error al generar reporte asesores:", error);
      toast.error("Error al generar el reporte", { id: "advisor-download" });
    } finally {
      setIsDownloadingAdvisor(false);
    }
  };

  const handleOpenBoleta = (url: string) => {
    if (!url) {
      toast.warning("Boleta sin URL válida");
      return;
    }
    window.open(url, "_blank");
  };

  return (
    <div className="fixed inset-x-0 top-16 xl:top-20 bottom-0 flex flex-col items-center justify-start bg-gradient-to-br from-blue-50 to-white px-4 sm:px-6 lg:px-8 overflow-auto pt-8 pb-8">
      <div className="bg-blue-50 rounded-xl shadow-md p-5 w-full max-w-6xl">
        <h2 className="text-2xl font-bold text-blue-900 mb-4 flex items-center gap-2">
          <BadgeDollarSign className="w-6 h-6 text-blue-700" />
          Pagos con Inversionistas
        </h2>

        {/* Filtros */}
        <div className="border border-blue-200 rounded-xl bg-white p-5 mb-4">
          {/* Header con título y botón limpiar */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <ListFilter className="w-4 h-4 text-blue-600" />
              <span className="font-bold text-blue-900 text-sm">Filtros</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setModoFecha("simple");
                setSifco("");
                setUsuarioNombre("");
                setMes(new Date().getMonth() + 1);
                setAnio(new Date().getFullYear());
                setDia(new Date().getDate());
                setFechaInicio("");
                setFechaFin("");
                setFechaAplicado("");
                setFechaBoleta("");
                setCategoriaCredito("");
                setFormatoCredito("");
                setSoloAplicados(undefined);
                setInversionistaId(undefined);
                setQueryInv("");
                setPage(1);
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-500 hover:text-red-600 hover:bg-red-50 transition-all flex items-center gap-1.5"
            >
              <RotateCcw className="w-3 h-3" />
              Limpiar
            </button>
          </div>

          {/* Grid principal de filtros */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-x-5 gap-y-4">

            {/* Columna 1: Fechas */}
            <div className="space-y-2.5">
              <div className="flex items-center gap-1.5 pb-1.5 border-b border-blue-100">
                <CalendarRange className="w-3.5 h-3.5 text-blue-500" />
                <span className="font-semibold text-blue-800 text-[11px] uppercase tracking-wider">Fechas</span>
              </div>
              <div className="flex gap-1 flex-wrap">
                <button
                  type="button"
                  onClick={() => { setModoFecha("simple"); setFechaInicio(""); setFechaFin(""); setFechaAplicado(""); setFechaBoleta(""); setPage(1); }}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold transition-all ${modoFecha === "simple" ? "bg-blue-600 text-white shadow-sm" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                >
                  Fecha
                </button>
                <button
                  type="button"
                  onClick={() => { setModoFecha("rango"); setDia(undefined); setFechaAplicado(""); setFechaBoleta(""); setPage(1); }}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold transition-all ${modoFecha === "rango" ? "bg-blue-600 text-white shadow-sm" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                >
                  Rango
                </button>
                <button
                  type="button"
                  onClick={() => { setModoFecha("aplicado"); setDia(undefined); setFechaInicio(""); setFechaFin(""); setFechaBoleta(""); setPage(1); }}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold transition-all ${modoFecha === "aplicado" ? "bg-emerald-600 text-white shadow-sm" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                >
                  Aplicado
                </button>
                <button
                  type="button"
                  onClick={() => { setModoFecha("boleta"); setDia(undefined); setFechaInicio(""); setFechaFin(""); setFechaAplicado(""); setPage(1); }}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold transition-all ${modoFecha === "boleta" ? "bg-amber-600 text-white shadow-sm" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                >
                  Boleta
                </button>
              </div>
              {modoFecha === "simple" ? (
                <div className="grid grid-cols-3 gap-1.5">
                  <div>
                    <label className="text-[10px] text-gray-500 font-medium mb-0.5 block">Año</label>
                    <select
                      value={anio}
                      onChange={(e) => { setAnio(Number(e.target.value)); setPage(1); }}
                      className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-800 font-medium bg-gray-50/50 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all"
                    >
                      {years.map((y) => (<option key={y} value={y}>{y}</option>))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 font-medium mb-0.5 block">Mes</label>
                    <select
                      value={mes}
                      onChange={(e) => { setMes(Number(e.target.value)); setPage(1); }}
                      className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-800 font-medium bg-gray-50/50 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all"
                    >
                      {meses.map((m, i) => (<option key={i} value={i + 1}>{m}</option>))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 font-medium mb-0.5 block">Día</label>
                    <Input
                      type="number"
                      min={1}
                      max={31}
                      value={dia ?? ""}
                      onChange={(e) => { setDia(e.target.value ? Number(e.target.value) : undefined); setPage(1); }}
                      placeholder="—"
                      className="border border-gray-200 text-xs text-gray-800 font-medium bg-gray-50/50 w-full h-[30px] px-2 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                    />
                  </div>
                </div>
              ) : modoFecha === "rango" ? (
                <div className="space-y-1.5">
                  <div>
                    <label className="text-[10px] text-gray-500 font-medium mb-0.5 block">Desde</label>
                    <DatePickerMUI
                      value={fechaInicio}
                      onChange={(value) => { setFechaInicio(value); setPage(1); }}
                      disableFuture={false}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 font-medium mb-0.5 block">Hasta</label>
                    <DatePickerMUI
                      value={fechaFin}
                      onChange={(value) => { setFechaFin(value); setPage(1); }}
                      disableFuture={false}
                    />
                  </div>
                </div>
              ) : modoFecha === "aplicado" ? (
                <div>
                  <label className="text-[10px] text-gray-500 font-medium mb-0.5 block">Fecha de Aplicación</label>
                  <DatePickerMUI
                    value={fechaAplicado}
                    onChange={(value) => { setFechaAplicado(value); setPage(1); }}
                    disableFuture={false}
                  />
                </div>
              ) : (
                <div>
                  <label className="text-[10px] text-gray-500 font-medium mb-0.5 block">Fecha de Boleta</label>
                  <DatePickerMUI
                    value={fechaBoleta}
                    onChange={(value) => { setFechaBoleta(value); setPage(1); }}
                    disableFuture={false}
                  />
                </div>
              )}
            </div>

            {/* Columna 2: Crédito y Usuario */}
            <div className="space-y-2.5">
              <div className="flex items-center gap-1.5 pb-1.5 border-b border-blue-100">
                <Hash className="w-3.5 h-3.5 text-blue-500" />
                <span className="font-semibold text-blue-800 text-[11px] uppercase tracking-wider">Crédito</span>
              </div>
              <div>
                <label className="text-[10px] text-gray-500 font-medium mb-0.5 block">N° SIFCO</label>
                <Input
                  value={sifco}
                  onChange={(e) => { setSifco(e.target.value); setPage(1); }}
                  placeholder="Buscar..."
                  className="border border-gray-200 text-xs text-gray-800 font-medium bg-gray-50/50 h-[30px] px-2.5 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 font-medium mb-0.5 block">Usuario</label>
                <Input
                  value={usuarioNombre}
                  onChange={(e) => { setUsuarioNombre(e.target.value); setPage(1); }}
                  placeholder="Buscar..."
                  className="border border-gray-200 text-xs text-gray-800 font-medium bg-gray-50/50 h-[30px] px-2.5 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 font-medium mb-0.5 block">Categoría</label>
                <select
                  value={categoriaCredito}
                  onChange={(e) => { setCategoriaCredito(e.target.value); setPage(1); }}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-800 font-medium bg-gray-50/50 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all"
                >
                  <option value="">Todas</option>
                  <option value="Contraseña">Contraseña</option>
                  <option value="CV Vehículo">CV Vehículo</option>
                  <option value="CV Vehículo nuevo">CV Vehículo nuevo</option>
                  <option value="Fiduciario">Fiduciario</option>
                  <option value="Hipotecario">Hipotecario</option>
                  <option value="Vehículo">Vehículo</option>
                </select>
              </div>
            </div>

            {/* Columna 3: Inversionista */}
            <div className="space-y-2.5">
              <div className="flex items-center gap-1.5 pb-1.5 border-b border-blue-100">
                <Handshake className="w-3.5 h-3.5 text-blue-500" />
                <span className="font-semibold text-blue-800 text-[11px] uppercase tracking-wider">Inversionista</span>
              </div>
              <div>
                <label className="text-[10px] text-gray-500 font-medium mb-0.5 block">Buscar</label>
                <Combobox
                  value={inversionistaId as unknown as number}
                  onChange={(value: any) => {
                    setInversionistaId(value === "" ? undefined : value);
                    setPage(1);
                    setQueryInv("");
                  }}
                >
                  <div className="relative">
                    <div className="relative">
                      <Combobox.Input
                        className="w-full border border-gray-200 rounded-lg pl-2.5 pr-8 py-1.5 text-xs text-gray-800 font-medium bg-gray-50/50 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 focus:outline-none placeholder:text-gray-400 transition-all"
                        displayValue={(id: any) =>
                          id === "" || id === undefined
                            ? ""
                            : investors.find((inv) => inv.inversionista_id === id)?.nombre || ""
                        }
                        onChange={(e) => setQueryInv(e.target.value)}
                        onFocus={(e: any) => e.target.select()}
                        placeholder="Seleccionar..."
                      />
                      <Combobox.Button className="absolute inset-y-0 right-0 flex items-center pr-2">
                        <ChevronsUpDown className="h-3.5 w-3.5 text-gray-400" />
                      </Combobox.Button>
                    </div>
                    <Transition
                      as={Fragment}
                      leave="transition ease-in duration-100"
                      leaveFrom="opacity-100"
                      leaveTo="opacity-0"
                      afterLeave={() => setQueryInv("")}
                    >
                      <Combobox.Options className="absolute z-50 mt-1 w-full max-h-48 overflow-auto rounded-lg bg-white py-1 shadow-xl border border-gray-200 focus:outline-none">
                        <Combobox.Option
                          value=""
                          className={({ active }) =>
                            `relative cursor-pointer select-none py-1.5 pl-8 pr-3 text-xs ${active ? "bg-blue-50 text-blue-900" : "text-gray-600"}`
                          }
                        >
                          {({ selected }) => (
                            <>
                              <span className={`block truncate ${selected ? "font-bold" : "font-medium"}`}>
                                Todos
                              </span>
                              {selected && (
                                <span className="absolute inset-y-0 left-0 flex items-center pl-2 text-blue-600">
                                  <Check className="h-3.5 w-3.5" />
                                </span>
                              )}
                            </>
                          )}
                        </Combobox.Option>
                        {filteredInvestors.length === 0 && queryInv !== "" ? (
                          <div className="py-2 px-3 text-center text-gray-400 text-xs">
                            No se encontró
                          </div>
                        ) : (
                          filteredInvestors.map((inv) => (
                            <Combobox.Option
                              key={inv.inversionista_id}
                              value={inv.inversionista_id}
                              className={({ active, selected }) =>
                                `relative cursor-pointer select-none py-1.5 pl-8 pr-3 text-xs transition-colors ${
                                  active ? "bg-blue-50 text-blue-900" : selected ? "bg-blue-50/50 text-blue-900" : "text-gray-700"
                                }`
                              }
                            >
                              {({ selected, active }) => (
                                <>
                                  <span className={`block truncate ${selected ? "font-bold" : "font-medium"} ${active ? "text-blue-900" : ""}`}>
                                    {inv.nombre}
                                  </span>
                                  {selected && (
                                    <span className="absolute inset-y-0 left-0 flex items-center pl-2 text-blue-600">
                                      <Check className="h-3.5 w-3.5" />
                                    </span>
                                  )}
                                </>
                              )}
                            </Combobox.Option>
                          ))
                        )}
                      </Combobox.Options>
                    </Transition>
                  </div>
                </Combobox>
              </div>
            </div>

            {/* Columna 4: Estado y Formato */}
            <div className="space-y-2.5">
              <div className="flex items-center gap-1.5 pb-1.5 border-b border-blue-100">
                <CheckCircle className="w-3.5 h-3.5 text-blue-500" />
                <span className="font-semibold text-blue-800 text-[11px] uppercase tracking-wider">Estado</span>
              </div>
              <div>
                <label className="text-[10px] text-gray-500 font-medium mb-0.5 block">Estado de Pago</label>
                <select
                  value={soloAplicados === undefined ? "" : soloAplicados ? "true" : "false"}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSoloAplicados(val === "" ? undefined : val === "true");
                    setPage(1);
                  }}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-800 font-medium bg-gray-50/50 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all"
                >
                  <option value="">Todos</option>
                  <option value="true">Aplicados</option>
                  <option value="false">Pendientes</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-gray-500 font-medium mb-0.5 block">Estado Validación</label>
                <select
                  value={validationStatusFilter}
                  onChange={(e) => { setValidationStatusFilter(e.target.value); setPage(1); }}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs font-medium bg-gray-50/50 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all"
                  style={{
                    color: validationStatusFilter === "validated" ? "#15803d"
                      : validationStatusFilter === "pending" ? "#a16207"
                      : validationStatusFilter === "reset" ? "#c2410c"
                      : validationStatusFilter === "capital" ? "#1d4ed8"
                      : validationStatusFilter === "no_required" ? "#374151"
                      : "#1f2937"
                  }}
                >
                  <option value="" style={{ color: "#1f2937" }}>Todos</option>
                  <option value="validated" style={{ color: "#15803d" }}>Validado</option>
                  <option value="pending" style={{ color: "#a16207" }}>Pendiente</option>
                  <option value="reset" style={{ color: "#c2410c" }}>Reset</option>
                  <option value="capital" style={{ color: "#1d4ed8" }}>Capital</option>
                  <option value="no_required" style={{ color: "#374151" }}>No Requiere</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-gray-500 font-medium mb-0.5 block">Formato</label>
                <select
                  value={formatoCredito}
                  onChange={(e) => { setFormatoCredito(e.target.value); setPage(1); }}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-800 font-medium bg-gray-50/50 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all"
                >
                  <option value="">Todos</option>
                  <option value="pool">Pool</option>
                  <option value="individual">Individual</option>
                </select>
              </div>
            </div>

          </div>
        </div>

        {data?.totales && (
          <>
            {/* Header del Collapse */}
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="w-full flex items-center justify-between bg-white hover:bg-blue-50 p-4 rounded-lg border border-blue-100 transition-colors"
            >
              <div className="flex items-center gap-3">
                <FileSpreadsheet className="h-5 w-5 text-blue-700" />
                <div className="text-left">
                  <h3 className="font-semibold text-lg text-blue-800">
                    Resumen de Totales
                  </h3>
                  <p className="text-sm text-blue-600">
                    {data.total} pagos encontrados
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className="text-lg font-bold px-4 py-2 border-blue-400 text-blue-800 bg-blue-100/70"
                >
                  {formatCurrency(data.totales.totalGeneral)}
                </Badge>
                {isCollapsed ? (
                  <ChevronDown className="h-5 w-5 text-blue-700" />
                ) : (
                  <ChevronUp className="h-5 w-5 text-blue-700" />
                )}
              </div>
            </button>

            {/* Contenido Colapsable */}
            <AnimatePresence>
              {!isCollapsed && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="overflow-hidden"
                >
                  <div className="pt-6 space-y-6">
                    {/* Grid de Totales */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
                      {[
                        {
                          label: "Abono Capital",
                          value: data.totales.totalAbonoCapital,
                        },
                        {
                          label: "Abono Interés",
                          value: data.totales.totalAbonoInteres,
                        },
                        {
                          label: "Abono IVA",
                          value: data.totales.totalAbonoIva,
                        },
                        {
                          label: "Abono Seguro",
                          value: data.totales.totalAbonoSeguro,
                        },
                        {
                          label: "Abono GPS",
                          value: data.totales.totalAbonoGps,
                        },
                        { label: "Mora", value: data.totales.totalMora },
                        { label: "Otros", value: data.totales.totalOtros },
                        {
                          label: "Convenio",
                          value: data.totales.totalConvenio,
                        },
                        { label: "Reserva", value: data.totales.totalReserva },
                        {
                          label: "Membresías",
                          value: data.totales.totalMembresias,
                        },
                      ].map((f, i) => (
                        <div
                          key={i}
                          className="bg-white rounded-lg border border-blue-100 p-3 shadow-sm hover:border-blue-300 transition-all"
                        >
                          <p className="text-blue-800 text-sm font-bold">
                            {f.label}
                          </p>
                          <p className="text-blue-900 font-semibold text-sm">
                            {f.value ?? "--"}
                          </p>
                        </div>
                      ))}
                    </div>

                    {/* Totales por Inversionista (solo si hay uno seleccionado) */}
                    {inversionistaId && data.totalesInversionistas && data.totalesInversionistas.length > 0 && (
                      <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl border border-indigo-200 p-4">
                        <h4 className="text-md font-bold text-indigo-900 mb-3 flex items-center gap-2">
                          <Users2 className="w-4 h-4 text-indigo-700" />
                          Totales por Inversionista
                        </h4>
                        <div className="space-y-3">
                          {data.totalesInversionistas.map((inv) => (
                            <div key={inv.inversionistaId} className="bg-white rounded-lg border border-indigo-100 p-3">
                              <p className="font-bold text-indigo-900 mb-2">{inv.nombreInversionista}</p>
                              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                                {[
                                  { label: "Abono Capital", value: inv.totalAbonoCapital },
                                  { label: "Abono Interés", value: inv.totalAbonoInteres },
                                  { label: "Abono IVA", value: inv.totalAbonoIva },
                                  { label: "ISR", value: inv.totalIsr },
                                  { label: "Monto Aportado", value: inv.totalMontoAportado },
                                ].map((campo, i) => (
                                  <div key={i} className="bg-indigo-50 rounded-lg p-2 border border-indigo-100">
                                    <p className="text-indigo-700 text-xs font-bold">{campo.label}</p>
                                    <p className="text-indigo-900 font-semibold text-sm">{formatCurrency(campo.value)}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Botones Excel */}
                    <div className="flex justify-end gap-3 pt-4 border-t border-blue-100">
                      <Button
                        onClick={handleDownloadAdvisorExcel}
                        disabled={isDownloadingAdvisor}
                        size="lg"
                        className="gap-2 shadow-sm bg-green-600 hover:bg-green-700 text-white transition-all"
                      >
                        <Download className="h-5 w-5" />
                        {isDownloadingAdvisor
                          ? "Generando..."
                          : "Reporte Asesores"}
                      </Button>
                      {user?.role === "ADMIN" && (
                        <Button
                          onClick={handleDownloadExcel}
                          disabled={isDownloadingExcel}
                          size="lg"
                          className="gap-2 shadow-sm bg-blue-600 hover:bg-blue-700 text-white transition-all"
                        >
                          <Download className="h-5 w-5" />
                          {isDownloadingExcel
                            ? "Generando..."
                            : "Descargar Reporte Excel"}
                        </Button>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}

        <br></br>

        {/* 🔹 Contenido principal */}
        {isLoading ? (
          <div className="text-blue-700 font-bold p-6 text-center">
            Cargando pagos...
          </div>
        ) : pagos.length === 0 ? (
          <div className="text-blue-700 font-semibold text-center py-8">
            No hay pagos para los filtros seleccionados.
          </div>
        ) : isMobile ? (
          // 📱 Vista móvil
          <div className="flex flex-col gap-4">
            {pagos.map((pago, idx) => {
              const statusConfig = getValidationStatusConfig(
                pago.validationStatus,
              );

              return (
                <div
                  key={pago.pagoId}
                  className={`bg-white border border-blue-200 rounded-xl shadow-sm p-4 ${
                    openIdx === idx ? "ring-2 ring-blue-300" : ""
                  }`}
                >
                  {/* 🧭 Header principal */}
                  <div
                    className="flex justify-between items-center cursor-pointer"
                    onClick={() => setOpenIdx(openIdx === idx ? null : idx)}
                  >
                    <div>
                      <p className="text-blue-800 font-bold text-lg">
                        {pago.credito?.numeroCreditoSifco}
                      </p>
                      <p className="text-blue-700 font-semibold">
                        {formatDate(pago.fechaPago)}
                      </p>
                    </div>
                    {openIdx === idx ? (
                      <ChevronUp className="text-blue-700" />
                    ) : (
                      <ChevronDown className="text-blue-700" />
                    )}
                  </div>

                  {/* 💰 Monto + usuario */}
                  <div className="mt-3">
                    <p className="text-green-700 font-bold text-xl">
                      {formatCurrency(pago.montoBoleta)}
                    </p>
                    <p className="text-green-600 font-semibold text-sm">
                      Aplicado: {formatCurrency(pago.monto_aplicado)}
                    </p>
                    <p className="text-blue-900 font-semibold">
                      {pago.usuario?.nombre}
                    </p>

                    {/* Badge de estado en móvil */}
                    <div className="mt-2 flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full font-semibold text-sm ${statusConfig.bgColor} ${statusConfig.color}`}
                      >
                        {statusConfig.icon}
                        {statusConfig.label}
                      </span>
                    </div>
                  </div>

                  {/* 🔘 Acciones */}
                  <div className="flex gap-3 mt-3 flex-wrap">
                    {/* Ver Boletas */}
                    {pago.boletas && pago.boletas.length > 0 ? (
                      pago.boletas.length === 1 ? (
                        <button
                          onClick={() => handleOpenBoleta(pago.boletas[0].urlBoleta)}
                          className="text-blue-700 font-semibold flex items-center gap-1 hover:text-blue-900"
                        >
                          <FileText className="w-4 h-4" /> Ver Boleta
                        </button>
                      ) : (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="text-blue-700 font-semibold flex items-center gap-1 hover:text-blue-900">
                              <FileText className="w-4 h-4" /> Ver Boletas ({pago.boletas.length})
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent className="bg-white border border-blue-200 shadow-lg rounded-xl p-2 min-w-[170px]">
                            {pago.boletas.map((b, idx) => (
                              <DropdownMenuItem
                                key={b.boletaId}
                                onClick={() => handleOpenBoleta(b.urlBoleta)}
                                className="cursor-pointer text-blue-700 hover:text-blue-900 hover:bg-blue-50 py-2 px-3 flex items-center rounded-lg transition"
                              >
                                <FileText className="w-4 h-4 mr-2 text-blue-600" />
                                <span className="font-semibold">Boleta {idx + 1}</span>
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )
                    ) : (
                      <button
                        disabled
                        className="text-gray-400 font-semibold flex items-center gap-1 cursor-not-allowed"
                      >
                        <FileText className="w-4 h-4" /> Sin Boleta
                      </button>
                    )}

                    {/* Inversionistas */}
                    <button
                      onClick={() =>
                        handleOpenInversionistas(pago.inversionistas)
                      }
                      disabled={user?.role !== "ADMIN"}
                      className={`font-semibold flex items-center gap-1 ${
                        user?.role !== "ADMIN"
                          ? "text-gray-400 cursor-not-allowed opacity-50"
                          : "text-blue-700 hover:text-blue-900"
                      }`}
                      title={
                        user?.role !== "ADMIN" ? "Solo administradores" : ""
                      }
                    >
                      <Users2 className="w-4 h-4" /> Inversionistas
                    </button>
                    <button
                      onClick={(e) => handleVerFacturas(pago.pagoId, e)}
                      className="font-semibold flex items-center gap-1 text-indigo-700 hover:text-indigo-900"
                    >
                      <Receipt className="w-4 h-4" />
                      Ver Facturas
                    </button>
                    {/* Validar Pago */}
                    <button
                      onClick={() => aplicarPago(pago.pagoId)}
                      disabled={
                        user?.role !== "ADMIN" ||
                        isPending ||
                        pago.validationStatus === "validated" ||
                        !tieneCuentaAsignada(pago)
                      }
                      className={`font-semibold flex items-center gap-1 ${
                        pago.validationStatus === "validated"
                          ? "text-gray-400 cursor-not-allowed"
                          : user?.role !== "ADMIN"
                            ? "text-gray-400 cursor-not-allowed opacity-50"
                            : "text-green-700 hover:text-green-900"
                      } disabled:opacity-50`}
                      title={
                        user?.role !== "ADMIN"
                          ? "Solo administradores"
                          : !tieneCuentaAsignada(pago)
                            ? "Debe asignar una cuenta primero"
                            : pago.validationStatus === "validated"
                              ? "Ya validado"
                              : ""
                      }
                    >
                      <Check className="w-4 h-4" />
                      {pago.validationStatus === "validated"
                        ? "Ya Validado"
                        : !tieneCuentaAsignada(pago)
                          ? "Sin Cuenta"
                          : isPending
                            ? "Validando..."
                            : "Validar Pago"}
                    </button>
{/* Generar Factura */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setGenerandoFacturaId(pago.pagoId);
                        handleFacturarPago(pago.pagoId, e);
                      }}
                      disabled={
                        user?.role !== "ADMIN" ||
                        facturarPago.isPending ||
                        generandoFacturaId === pago.pagoId
                      }
                      className={`font-semibold flex items-center gap-1 ${
                        user?.role !== "ADMIN"
                          ? "text-gray-400 cursor-not-allowed opacity-50"
                          : "text-purple-700 hover:text-purple-900"
                      }`}
                      title={
                        user?.role !== "ADMIN" ? "Solo administradores" : ""
                      }
                    >
                      <Receipt className="w-4 h-4" />
                      {generandoFacturaId === pago.pagoId
                        ? "Generando..."
                        : "Generar Factura"}
                    </button>

                    {/* Revertir */}
                    <button
                      className="bg-yellow-500 hover:bg-yellow-600 text-white px-3 py-1 rounded font-bold shadow flex items-center gap-1"
                      onClick={() =>
                        handleReverse(
                          pago.pagoId,
                          pago.credito?.creditoId || 0,
                          false,
                        )
                      }
                      disabled={reversePago.isPending || user?.role !== "ADMIN"}
                    >
                      {reversePago.isPending ? (
                        <>
                          <Loader2 className="animate-spin w-4 h-4" />
                          Revirtiendo...
                        </>
                      ) : (
                        <>
                          <Undo2 className="w-4 h-4" />
                          Revertir
                        </>
                      )}
                    </button>

                    {/* Revertir a Pendiente */}
                    <button
                      className="bg-orange-500 hover:bg-orange-600 text-white px-3 py-1 rounded font-bold shadow flex items-center gap-1"
                      onClick={() => {
                        handleRevertToPending(pago.pagoId, pago.credito?.creditoId || 0);
                      }}
                      disabled={revertPaymentToPending.isPending || user?.role !== "ADMIN"}
                    >
                      {revertPaymentToPending.isPending ? (
                        <>
                          <Loader2 className="animate-spin w-4 h-4" />
                          Revirtiendo...
                        </>
                      ) : (
                        <>
                          <Undo2 className="w-4 h-4" />
                          Revertir Especial
                        </>
                      )}
                    </button>

                    {/* Procesar Inversionistas */}
                    <button
                      className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1 rounded font-bold shadow flex items-center gap-1"
                      onClick={() => {
                        handleProcessInvestors(pago.pagoId, pago.credito?.creditoId || 0);
                      }}
                      disabled={processInvestors.isPending || user?.role !== "ADMIN"}
                    >
                      {processInvestors.isPending ? (
                        <>
                          <Loader2 className="animate-spin w-4 h-4" />
                          Procesando...
                        </>
                      ) : (
                        <>
                          <Users2 className="w-4 h-4" />
                          Proc. Inversionistas
                        </>
                      )}
                    </button>

                    {/* Revalidar Pago */}
                    <button
                      className="bg-purple-600 hover:bg-purple-700 text-white px-3 py-1 rounded font-bold shadow flex items-center gap-1"
                      onClick={() => {
                        handleRevalidatePayment(pago.pagoId, pago.credito?.creditoId || 0);
                      }}
                      disabled={revalidatePayment.isPending || user?.role !== "ADMIN" || pago.validationStatus === "validated"}
                    >
                      {revalidatePayment.isPending ? (
                        <>
                          <Loader2 className="animate-spin w-4 h-4" />
                          Revalidando...
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4" />
                          Revalidar
                        </>
                      )}
                    </button>
                  </div>

                  {/* 🔽 COLAPSABLE COMPLETO */}
                  <div
                    className={`transition-all duration-500 overflow-hidden ${
                      openIdx === idx
                        ? "max-h-[1000px] opacity-100 mt-4"
                        : "max-h-0 opacity-0"
                    }`}
                  >
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: "Crédito ID", value: pago.credito?.creditoId },
                        {
                          label: "Capital",
                          value: formatCurrency(pago.credito?.capital),
                        },
                        {
                          label: "Deuda Total",
                          value: formatCurrency(pago.credito?.deudaTotal),
                        },
                        {
                          label: "Membresías",
                          value: formatCurrency(pago.membresias),
                          rawValue: pago.membresias,
                        },
                        {
                          label: "Mora",
                          value: formatCurrency(pago.mora),
                          rawValue: pago.mora,
                        },
                        {
                          label: "Convenio",
                          value: formatCurrency(pago.pagoConvenio),
                          rawValue: pago.pagoConvenio,
                        },
                        {
                          label: "Reserva",
                          value: formatCurrency(pago.reserva),
                          rawValue: pago.reserva,
                        },
                        {
                          label: "Otros",
                          value: formatCurrency(pago.otros),
                          rawValue: pago.otros,
                        },
                        {
                          label: "Interés",
                          value: formatCurrency(pago.abono_interes),
                          rawValue: pago.abono_interes,
                        },
                        {
                          label: "IVA 12%",
                          value: formatCurrency(pago.abono_iva_12),
                          rawValue: pago.abono_iva_12,
                        },
                        {
                          label: "Seguro",
                          value: formatCurrency(pago.abono_seguro),
                          rawValue: pago.abono_seguro,
                        },
                        {
                          label: "GPS",
                          value: formatCurrency(pago.abono_gps),
                          rawValue: pago.abono_gps,
                        },
                        {
                          label: "Estado de Validación",
                          value: (
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${statusConfig.bgColor} ${statusConfig.color}`}
                            >
                              {statusConfig.icon}
                              {statusConfig.label}
                            </span>
                          ),
                        },
                        {
                          label: "Cuenta Destino",
                          value: tieneCuentaAsignada(pago)
                            ? `${pago.cuentaEmpresaNombre} - ${pago.cuentaEmpresaBanco}`
                            : "No asignada",
                        },
                        {
                          label: "Número de Cuenta",
                          value: pago.cuentaEmpresaNumero || "—",
                        },
                        pago.cuota
                          ? {
                              label: "Número de Cuota",
                              value: pago.cuota.numeroCuota,
                            }
                          : null,
                        pago.cuota
                          ? {
                              label: "Fecha Vencimiento",
                              value: formatDate(pago.cuota.fechaVencimiento),
                            }
                          : null,
                        {
                          label: "Observaciones",
                          value: pago.observaciones || "—",
                        },
                        pago.usuario.Categoria
                          ? {
                              label: "Categoria",
                              value: pago.usuario.Categoria,
                            }
                          : null,
                        { label: "Banco", value: pago.bancoNombre || "—" },
                        {
                          label: "Número Autorización",
                          value: pago.numeroautorizacion || "—",
                        },
                        {
                          label: "Fecha Boleta",
                          value: pago.fechaBoleta ? formatDate(pago.fechaBoleta) : "—",
                        },
                        {
                          label: "Registrado por",
                          value: pago.registerByNombre || pago.registerBy || "—",
                        },
                      ]
                        .filter(Boolean)
                        .filter((f: any) => {
                          if (f.rawValue !== undefined) {
                            return Number(f.rawValue) !== 0;
                          }
                          return true;
                        })
                        .map((f: any, i) => (
                          <div
                            key={i}
                            className="bg-blue-50 rounded-lg p-2 border border-blue-100"
                          >
                            <p className="text-blue-800 text-sm font-bold">
                              {f.label}
                            </p>
                            <p className="text-blue-900 font-semibold text-sm">
                              {f.value ?? "--"}
                            </p>
                          </div>
                        ))}
                    </div>

                    {/* Rubros de cancelación (solo reset) */}
                    {pago.validationStatus === "reset" && pago.cancelacion && (
                      <CancelacionRubros
                        cancelacion={pago.cancelacion}
                        pagoId={pago.pagoId}
                        onSuccess={() => refetch()}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          // 💻 Vista escritorio
          <div className="space-y-4">
            {pagos.map((pago, idx) => {
              const statusConfig = getValidationStatusConfig(
                pago.validationStatus,
              );

              return (
                <div
                  key={pago.pagoId}
                  className="bg-white border-2 border-blue-200 rounded-2xl shadow-lg hover:shadow-xl transition-all overflow-hidden"
                >
                  {/* HEADER CARD */}
                  <div
                    className="p-6 bg-gradient-to-r from-blue-50 to-indigo-50 cursor-pointer hover:from-blue-100 hover:to-indigo-100 transition-all"
                    onClick={() => setOpenIdx(openIdx === idx ? null : idx)}
                  >
                    <div className="flex items-center justify-between">
                      {/* Info principal */}
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-3">
                          <h3 className="text-2xl font-bold text-blue-900">
                            #{pago.credito?.numeroCreditoSifco}
                          </h3>
                          <span
                            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full font-semibold text-sm ${statusConfig.bgColor} ${statusConfig.color}`}
                          >
                            {statusConfig.icon}
                            {statusConfig.label}
                          </span>
                        </div>

                        {/* Stats Grid */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <div className="bg-white rounded-lg p-3 shadow-sm border border-blue-100">
                            <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                              <DollarSign className="w-3 h-3" />
                              Monto Boleta
                            </div>
                            <div className="font-bold text-green-700 text-lg">
                              {formatCurrency(pago.montoBoleta)}
                            </div>
                          </div>

                          <div className="bg-white rounded-lg p-3 shadow-sm border border-green-100">
                            <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                              <DollarSign className="w-3 h-3" />
                              Monto Aplicado
                            </div>
                            <div className="font-bold text-green-700 text-lg">
                              {formatCurrency(pago.monto_aplicado)}
                            </div>
                          </div>

                          <div className="bg-white rounded-lg p-3 shadow-sm border border-indigo-100">
                            <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              Fecha Pago
                            </div>
                            <div className="font-bold text-indigo-700">
                              {formatDate(pago.fechaPago)}
                            </div>
                          </div>

                          <div className="bg-white rounded-lg p-3 shadow-sm border border-violet-100">
                            <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                              <User className="w-3 h-3" />
                              Usuario
                            </div>
                            <div className="font-bold text-violet-700 truncate">
                              {pago.usuario?.nombre}
                            </div>
                          </div>

                          <div className="bg-white rounded-lg p-3 shadow-sm border border-blue-100">
                            <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" />
                              Categoría
                            </div>
                            <div className="font-bold text-blue-700">
                              {pago.usuario?.Categoria || "--"}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Acciones + Chevron */}
                      <div className="flex items-center gap-4 ml-6">
                        {/* Dropdown Menu */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              className="px-4 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 transition-colors inline-flex items-center justify-center shadow-md"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MoreVertical className="w-5 h-5 text-white" />
                            </button>
                          </DropdownMenuTrigger>

                          <DropdownMenuContent
                            align="end"
                            className="w-64 bg-white shadow-2xl border-2 border-blue-200 rounded-xl p-2"
                          >
                            {/* Ver Boletas */}
                            {pago.boletas && pago.boletas.length > 0 ? (
                              pago.boletas.map((b, idx) => (
                                <DropdownMenuItem
                                  key={b.boletaId}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenBoleta(b.urlBoleta);
                                  }}
                                  className="cursor-pointer text-blue-700 hover:text-blue-900 hover:bg-blue-50 py-2.5 px-3 flex items-center rounded-lg transition"
                                >
                                  <FileText className="w-4 h-4 mr-2 text-blue-600 flex-shrink-0" />
                                  <span className="font-semibold">
                                    {pago.boletas.length === 1 ? "Ver Boleta" : `Boleta ${idx + 1}`}
                                  </span>
                                </DropdownMenuItem>
                              ))
                            ) : (
                              <DropdownMenuItem
                                disabled
                                className="text-gray-400 py-2.5 px-3 flex items-center rounded-lg"
                              >
                                <FileText className="w-4 h-4 mr-2 flex-shrink-0" />
                                <span className="font-semibold">Sin Boleta</span>
                              </DropdownMenuItem>
                            )}

                            <DropdownMenuSeparator className="bg-gray-200 my-1" />

                            {/* Seleccionar Cuenta */}
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAbrirModalCuenta(pago.pagoId, e);
                              }}
                              className="cursor-pointer text-blue-700 hover:text-blue-900 hover:bg-blue-50 py-2.5 px-3 flex items-center rounded-lg transition"
                            >
                              <BadgeDollarSign className="w-4 h-4 mr-2 text-blue-600 flex-shrink-0" />
                              <span className="font-semibold">
                                {pago.cuentaEmpresaNombre
                                  ? "Cambiar Cuenta"
                                  : "Asignar Cuenta"}
                              </span>
                            </DropdownMenuItem>

                            <DropdownMenuSeparator className="bg-gray-200 my-1" />

                            {/* Inversionistas */}
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                if (user?.role === "ADMIN") {
                                  handleOpenInversionistas(pago.inversionistas);
                                }
                              }}
                              disabled={user?.role !== "ADMIN"}
                              className={`cursor-pointer py-2.5 px-3 flex items-center rounded-lg transition ${
                                user?.role !== "ADMIN"
                                  ? "opacity-50 text-gray-400 bg-gray-50"
                                  : "text-blue-700 hover:text-blue-900 hover:bg-blue-50"
                              }`}
                            >
                              <Users2
                                className={`w-4 h-4 mr-2 flex-shrink-0 ${user?.role !== "ADMIN" ? "text-gray-400" : "text-blue-600"}`}
                              />
                              <span className="font-semibold">
                                Ver Inversionistas
                              </span>
                              {user?.role !== "ADMIN" && (
                                <span className="ml-auto text-xs text-gray-400 font-normal">
                                  Admin
                                </span>
                              )}
                            </DropdownMenuItem>

                            <DropdownMenuSeparator className="bg-gray-200 my-1" />

                            {/* Validar Pago (solo validar, sin facturar) */}
                            <DropdownMenuItem
                              onClick={() => {
                                if (
                                  user?.role === "ADMIN" &&
                                  pago.validationStatus !== "validated" &&
                                  tieneCuentaAsignada(pago)
                                ) {
                                  setValidandoPagoId(pago.pagoId);
                                  aplicarPago(pago.pagoId, {
                                    onSuccess: () => {
                                      setValidandoPagoId(null);
                                    },
                                    onError: () => {
                                      setValidandoPagoId(null);
                                    },
                                  });
                                }
                              }}
                              disabled={
                                user?.role !== "ADMIN" ||
                                isPending ||
                                validandoPagoId === pago.pagoId ||
                                pago.validationStatus === "validated" ||
                                !tieneCuentaAsignada(pago)
                              }
                              className={`cursor-pointer py-2.5 px-3 flex items-center rounded-lg transition ${
                                pago.validationStatus === "validated" ||
                                user?.role !== "ADMIN" ||
                                !tieneCuentaAsignada(pago)
                                  ? "opacity-50 text-gray-400 bg-gray-50"
                                  : "text-green-700 hover:text-green-900 hover:bg-green-50"
                              }`}
                            >
                              <Check
                                className={`w-4 h-4 mr-2 flex-shrink-0 ${
                                  pago.validationStatus === "validated" ||
                                  user?.role !== "ADMIN" ||
                                  !tieneCuentaAsignada(pago)
                                    ? "text-gray-400"
                                    : "text-green-600"
                                }`}
                              />
                              <span className="font-semibold">
                                {validandoPagoId === pago.pagoId
                                  ? "Validando..."
                                  : pago.validationStatus === "validated"
                                    ? "Ya Validado"
                                    : !tieneCuentaAsignada(pago)
                                      ? "Sin Cuenta"
                                      : "Validar Pago"}
                              </span>
                              {user?.role !== "ADMIN" && (
                                <span className="ml-auto text-xs text-gray-400 font-normal">
                                  Admin
                                </span>
                              )}
                            </DropdownMenuItem>

                            {/* Validar y Facturar (ambas acciones encadenadas) */}
                            <DropdownMenuItem
                              onClick={() => {
                                if (
                                  user?.role === "ADMIN" &&
                                  pago.validationStatus !== "validated" &&
                                  tieneCuentaAsignada(pago)
                                ) {
                                  setValidandoPagoId(pago.pagoId);
                                  aplicarPago(pago.pagoId, {
                                    onSuccess: () => {
                                      setValidandoPagoId(null);
                                      setGenerandoFacturaId(pago.pagoId);
                                      setTimeout(() => {
                                        handleFacturarPago(pago.pagoId);
                                      }, 200);
                                    },
                                    onError: () => {
                                      setValidandoPagoId(null);
                                    },
                                  });
                                }
                              }}
                              disabled={
                                user?.role !== "ADMIN" ||
                                isPending ||
                                validandoPagoId === pago.pagoId ||
                                generandoFacturaId === pago.pagoId ||
                                pago.validationStatus === "validated" ||
                                !tieneCuentaAsignada(pago)
                              }
                              className={`cursor-pointer py-2.5 px-3 flex items-center rounded-lg transition ${
                                pago.validationStatus === "validated" ||
                                user?.role !== "ADMIN" ||
                                !tieneCuentaAsignada(pago)
                                  ? "opacity-50 text-gray-400 bg-gray-50"
                                  : "text-blue-700 hover:text-blue-900 hover:bg-blue-50"
                              }`}
                            >
                              <Check
                                className={`w-4 h-4 mr-2 flex-shrink-0 ${
                                  pago.validationStatus === "validated" ||
                                  user?.role !== "ADMIN" ||
                                  !tieneCuentaAsignada(pago)
                                    ? "text-gray-400"
                                    : "text-blue-600"
                                }`}
                              />
                              <span className="font-semibold">
                                {validandoPagoId === pago.pagoId
                                  ? "Validando pago..."
                                  : generandoFacturaId === pago.pagoId
                                    ? "Generando factura..."
                                    : pago.validationStatus === "validated"
                                      ? "Ya Validado"
                                      : !tieneCuentaAsignada(pago)
                                        ? "Sin Cuenta"
                                        : "Validar y Facturar"}
                              </span>
                              {user?.role !== "ADMIN" && (
                                <span className="ml-auto text-xs text-gray-400 font-normal">
                                  Admin
                                </span>
                              )}
                            </DropdownMenuItem>

                            <DropdownMenuSeparator className="bg-gray-200 my-1" />

                            {/* Generar Factura */}
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                if (user?.role === "ADMIN") {
                                  setGenerandoFacturaId(pago.pagoId);
                                  handleFacturarPago(pago.pagoId, e);
                                }
                              }}
                              disabled={
                                user?.role !== "ADMIN" ||
                                facturarPago.isPending ||
                                generandoFacturaId === pago.pagoId
                              }
                              className={`cursor-pointer py-2.5 px-3 flex items-center rounded-lg transition ${
                                user?.role !== "ADMIN"
                                  ? "opacity-50 text-gray-400 bg-gray-50"
                                  : "text-purple-700 hover:text-purple-900 hover:bg-purple-50"
                              }`}
                            >
                              <Receipt
                                className={`w-4 h-4 mr-2 flex-shrink-0 ${
                                  user?.role !== "ADMIN"
                                    ? "text-gray-400"
                                    : "text-purple-600"
                                }`}
                              />
                              <span className="font-semibold">
                                {generandoFacturaId === pago.pagoId
                                  ? "Generando..."
                                  : "Generar Factura"}
                              </span>
                              {user?.role !== "ADMIN" && (
                                <span className="ml-auto text-xs text-gray-400 font-normal">
                                  Admin
                                </span>
                              )}
                            </DropdownMenuItem>

                            <DropdownMenuSeparator className="bg-gray-200 my-1" />

                            {/* Ver Facturas */}
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                handleVerFacturas(pago.pagoId, e);
                              }}
                              className="cursor-pointer text-indigo-700 hover:text-indigo-900 hover:bg-indigo-50 py-2.5 px-3 flex items-center rounded-lg transition"
                            >
                              <Receipt className="w-4 h-4 mr-2 text-indigo-600 flex-shrink-0" />
                              <span className="font-semibold">
                                Ver Facturas
                              </span>
                            </DropdownMenuItem>

                            <DropdownMenuSeparator className="bg-gray-200 my-1" />

                            {/* Revertir Pago */}
                            <DropdownMenuItem
                              onClick={() => {
                                if (user?.role === "ADMIN") {
                                  handleReverse(
                                    pago.pagoId,
                                    pago.credito?.creditoId || 0,
                                    false,
                                  );
                                }
                              }}
                              disabled={
                                reversePago.isPending || user?.role !== "ADMIN"
                              }
                              className={`cursor-pointer py-2.5 px-3 flex items-center rounded-lg transition ${
                                user?.role !== "ADMIN"
                                  ? "opacity-50 text-gray-400 bg-gray-50"
                                  : "text-red-700 hover:text-red-900 hover:bg-red-50"
                              }`}
                            >
                              <Undo2
                                className={`w-4 h-4 mr-2 flex-shrink-0 ${user?.role !== "ADMIN" ? "text-gray-400" : "text-red-600"}`}
                              />
                              <span className="font-semibold">
                                {reversePago.isPending
                                  ? "Revirtiendo..."
                                  : "Revertir Pago"}
                              </span>
                            </DropdownMenuItem>

                            <DropdownMenuSeparator className="bg-gray-200 my-1" />

                            {/* Revertir a Pendiente / Inversiones */}
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                if (user?.role === "ADMIN") {
                                  handleRevertToPending(pago.pagoId, pago.credito?.creditoId || 0);
                                }
                              }}
                              disabled={
                                revertPaymentToPending.isPending || user?.role !== "ADMIN"
                              }
                              className={`cursor-pointer py-2.5 px-3 flex items-center rounded-lg transition ${
                                user?.role !== "ADMIN"
                                  ? "opacity-50 text-gray-400 bg-gray-50"
                                  : "text-orange-700 hover:text-orange-900 hover:bg-orange-50"
                              }`}
                            >
                              <Undo2
                                className={`w-4 h-4 mr-2 flex-shrink-0 ${user?.role !== "ADMIN" ? "text-gray-400" : "text-orange-600"}`}
                              />
                              <span className="font-semibold">
                                {revertPaymentToPending.isPending
                                  ? "Revirtiendo Especial..."
                                  : "Revertir Especial"}
                              </span>
                            </DropdownMenuItem>

                            <DropdownMenuSeparator className="bg-gray-200 my-1" />

                            {/* Procesar Inversionistas */}
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                if (user?.role === "ADMIN") {
                                  handleProcessInvestors(pago.pagoId, pago.credito?.creditoId || 0);
                                }
                              }}
                              disabled={
                                processInvestors.isPending || user?.role !== "ADMIN"
                              }
                              className={`cursor-pointer py-2.5 px-3 flex items-center rounded-lg transition ${
                                user?.role !== "ADMIN"
                                  ? "opacity-50 text-gray-400 bg-gray-50"
                                  : "text-indigo-700 hover:text-indigo-900 hover:bg-indigo-50"
                              }`}
                            >
                              <Users2
                                className={`w-4 h-4 mr-2 flex-shrink-0 ${user?.role !== "ADMIN" ? "text-gray-400" : "text-indigo-600"}`}
                              />
                              <span className="font-semibold">
                                {processInvestors.isPending
                                  ? "Procesando..."
                                  : "Procesar Inversionistas"}
                              </span>
                            </DropdownMenuItem>
                            
                            <DropdownMenuSeparator className="bg-gray-200 my-1" />

                            {/* Revalidar Pago */}
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                if (user?.role === "ADMIN") {
                                  handleRevalidatePayment(pago.pagoId, pago.credito?.creditoId || 0);
                                }
                              }}
                              disabled={
                                revalidatePayment.isPending || user?.role !== "ADMIN" || pago.validationStatus === "validated"
                              }
                              className={`cursor-pointer py-2.5 px-3 flex items-center rounded-lg transition ${
                                user?.role !== "ADMIN" || pago.validationStatus === "validated"
                                  ? "opacity-50 text-gray-400 bg-gray-50"
                                  : "text-purple-700 hover:text-purple-900 hover:bg-purple-50"
                              }`}
                            >
                              <Check
                                className={`w-4 h-4 mr-2 flex-shrink-0 ${user?.role !== "ADMIN" || pago.validationStatus === "validated" ? "text-gray-400" : "text-purple-600"}`}
                              />
                              <span className="font-semibold">
                                {revalidatePayment.isPending
                                  ? "Revalidando..."
                                  : "Revalidar Pago"}
                              </span>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>

                        {/* Chevron */}
                        <div className="text-blue-500">
                          {openIdx === idx ? (
                            <ChevronUp className="w-8 h-8" />
                          ) : (
                            <ChevronDown className="w-8 h-8" />
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* COLLAPSE - Detalles */}
                  {openIdx === idx && (
                    <div className="p-6 bg-white border-t-2 border-blue-100">
                      <h4 className="text-lg font-bold text-blue-900 flex items-center gap-2 mb-4">
                        <span className="text-2xl">📋</span>
                        Detalles del Pago
                      </h4>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {[
                          {
                            label: "Crédito ID",
                            value: pago.credito?.creditoId,
                          },
                          {
                            label: "Capital",
                            value: formatCurrency(pago.credito?.capital),
                          },
                          {
                            label: "Deuda Total",
                            value: formatCurrency(pago.credito?.deudaTotal),
                          },
                          {
                            label: "Membresías",
                            value: formatCurrency(pago.membresias),
                            rawValue: pago.membresias,
                          },
                          {
                            label: "Mora",
                            value: formatCurrency(pago.mora),
                            rawValue: pago.mora,
                          },
                          {
                            label: "Convenio",
                            value: formatCurrency(pago.pagoConvenio),
                            rawValue: pago.pagoConvenio,
                          },
                          {
                            label: "Reserva",
                            value: formatCurrency(pago.reserva),
                            rawValue: pago.reserva,
                          },
                          {
                            label: "Otros",
                            value: formatCurrency(pago.otros),
                            rawValue: pago.otros,
                          },
                          {
                            label: "Interés",
                            value: formatCurrency(pago.abono_interes),
                            rawValue: pago.abono_interes,
                          },
                          {
                            label: "Abono Capital",
                            value: formatCurrency(pago.abono_capital),
                            rawValue: pago.abono_capital,
                          },
                          {
                            label: "IVA 12%",
                            value: formatCurrency(pago.abono_iva_12),
                            rawValue: pago.abono_iva_12,
                          },
                          {
                            label: "Seguro",
                            value: formatCurrency(pago.abono_seguro),
                            rawValue: pago.abono_seguro,
                          },
                          {
                            label: "GPS",
                            value: formatCurrency(pago.abono_gps),
                            rawValue: pago.abono_gps,
                          },
                          pago.cuota
                            ? {
                                label: "Número de Cuota",
                                value: pago.cuota.numeroCuota,
                              }
                            : null,
                          pago.cuota
                            ? {
                                label: "Fecha Vencimiento",
                                value: formatDate(pago.cuota.fechaVencimiento),
                              }
                            : null,
                          {
                            label: "Observaciones",
                            value: pago.observaciones || "—",
                          },
                          { label: "Banco", value: pago.bancoNombre || "—" },
                          {
                            label: "Número Autorización",
                            value: pago.numeroautorizacion || "—",
                          },
                          {
                            label: "Fecha Boleta",
                            value: pago.fechaBoleta ? formatDate(pago.fechaBoleta) : "—",
                          },
                          {
                            label: "Registrado por",
                            value: pago.registerByNombre || pago.registerBy || "—",
                          },
                          {
                            label: "Cuenta Destino",
                            value: tieneCuentaAsignada(pago)
                              ? `${pago.cuentaEmpresaNombre} - ${pago.cuentaEmpresaBanco}`
                              : "No asignada",
                          },
                          {
                            label: "Número de Cuenta",
                            value: pago.cuentaEmpresaNumero || "—",
                          },
                        ]
                          .filter(Boolean)
                          .filter((f: any) => {
                            if (f.rawValue !== undefined) {
                              return Number(f.rawValue) !== 0;
                            }
                            return true;
                          })
                          .map((f: any, i) => (
                            <div
                              key={i}
                              className="bg-gradient-to-br from-blue-50 to-white rounded-lg border-2 border-blue-100 p-3 hover:border-blue-300 transition"
                            >
                              <p className="text-blue-800 text-xs font-bold mb-1">
                                {f.label}
                              </p>
                              <p className="text-blue-900 font-semibold text-sm">
                                {f.value ?? "--"}
                              </p>
                            </div>
                          ))}
                      </div>

                      {/* Rubros de cancelación (solo reset) */}
                      {pago.validationStatus === "reset" && pago.cancelacion && (
                        <CancelacionRubros
                          cancelacion={pago.cancelacion}
                          pagoId={pago.pagoId}
                          onSuccess={() => refetch()}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Paginación */}
        <div className="flex flex-col sm:flex-row justify-between items-center mt-6 gap-4">
          <div className="flex items-center gap-2">
            <span className="text-blue-900 font-semibold">Ver</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="border-2 border-blue-500 rounded px-2 py-1 bg-white text-blue-900 font-semibold"
            >
              {[10, 20, 50, 100, 200, 300].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
            <span className="text-blue-900 font-semibold">por página</span>
          </div>

          <div className="flex items-center gap-4">
            <button
              className="flex items-center px-4 py-2 rounded bg-blue-100 text-blue-800 font-bold disabled:opacity-50"
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="mr-1" /> Anterior
            </button>

            <div className="text-blue-900 font-semibold">
              Página {page} de {totalPages || 1} ({data?.total ?? 0} pagos)
            </div>

            <button
              className="flex items-center px-4 py-2 rounded bg-blue-100 text-blue-800 font-bold disabled:opacity-50"
              disabled={page >= totalPages || totalPages === 0}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Siguiente <ChevronRight className="ml-1" />
            </button>
          </div>
        </div>
      </div>

      {/* Modal de inversionistas */}
      <ModalInversionistas
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        inversionistas={selectedInv}
      />

      {/* Modal de cuenta */}
      {modalCuentaOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={() => {
            if (!actualizandoCuenta) {
              setModalCuentaOpen(false);
              setPagoSeleccionado(null);
            }
          }}
        >
          <div
            className="bg-white rounded-xl p-6 max-w-md w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold text-blue-900 mb-2 flex items-center gap-2">
              <BadgeDollarSign className="w-6 h-6 text-blue-700" />
              Seleccionar Cuenta de Empresa
            </h3>
            <p className="text-sm text-blue-600 mb-4">
              Escogé la cuenta donde se recibió este pago
            </p>

            {/* Mostrar cuenta actual */}
            {pagoSeleccionado &&
              (() => {
                const pagoActual = pagos.find(
                  (p) => p.pagoId === pagoSeleccionado,
                );
                return pagoActual && tieneCuentaAsignada(pagoActual) ? (
                  <div className="mb-4 p-3 bg-blue-50 border-2 border-blue-300 rounded-lg">
                    <p className="text-xs text-blue-700 font-semibold mb-1">
                      Cuenta actual:
                    </p>
                    <p className="font-bold text-blue-900">
                      {pagoActual.cuentaEmpresaNombre}
                    </p>
                    <p className="text-sm text-blue-700">
                      {pagoActual.cuentaEmpresaBanco}
                    </p>
                    <p className="text-xs text-gray-600 font-mono">
                      N° {pagoActual.cuentaEmpresaNumero}
                    </p>
                  </div>
                ) : null;
              })()}

            {cargandoCuentas ? (
              <div className="text-center py-8">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto" />
                <p className="text-blue-700 font-semibold mt-2">
                  Cargando cuentas...
                </p>
              </div>
            ) : cuentas && cuentas.length > 0 ? (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {cuentas.map((cuenta: CuentaEmpresa) => {
                  const pagoActual = pagos.find(
                    (p) => p.pagoId === pagoSeleccionado,
                  );
                  const esCuentaActual =
                    pagoActual &&
                    pagoActual.cuentaEmpresaNombre === cuenta.nombreCuenta &&
                    pagoActual.cuentaEmpresaNumero === cuenta.numeroCuenta;

                  return (
                    <button
                      key={cuenta.cuentaId}
                      onClick={() => handleSeleccionarCuenta(cuenta.cuentaId)}
                      disabled={actualizandoCuenta}
                      className={`w-full text-left p-4 border-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all group ${
                        esCuentaActual
                          ? "border-green-400 bg-green-50"
                          : "border-blue-200 hover:bg-blue-50 hover:border-blue-400"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p
                            className={`font-bold text-lg ${
                              esCuentaActual
                                ? "text-green-900"
                                : "text-blue-900 group-hover:text-blue-700"
                            }`}
                          >
                            {cuenta.nombreCuenta}
                          </p>
                          <p
                            className={`text-sm font-semibold ${
                              esCuentaActual
                                ? "text-green-700"
                                : "text-blue-700"
                            }`}
                          >
                            {cuenta.banco}
                          </p>
                          <p className="text-xs text-gray-600 font-mono">
                            N° {cuenta.numeroCuenta}
                          </p>
                        </div>
                        {esCuentaActual && (
                          <Check className="w-6 h-6 text-green-600 flex-shrink-0" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-center text-gray-600 py-8">
                No hay cuentas disponibles
              </p>
            )}

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setModalCuentaOpen(false);
                  setPagoSeleccionado(null);
                }}
                disabled={actualizandoCuenta}
                className="flex-1 px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300 font-semibold disabled:opacity-50 transition-colors"
              >
                Cancelar
              </button>
            </div>

            {actualizandoCuenta && (
              <div className="mt-4 flex items-center justify-center gap-2 text-blue-700">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="font-semibold">Actualizando cuenta...</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 🆕 MODAL DE FACTURAS GENERADAS */}
      {modalFacturasOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={() => {
            setModalFacturasOpen(false);
            setFacturasGeneradas([]);
          }}
        >
          <div
            className="bg-white rounded-xl p-6 max-w-2xl w-full shadow-2xl max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-2xl font-bold text-green-900 mb-2 flex items-center gap-2">
              <Check className="w-7 h-7 text-green-600" />
              Facturas Generadas Exitosamente
            </h3>
            <p className="text-sm text-gray-600 mb-6">
              Se generaron {facturasGeneradas.length} factura(s) para este pago
            </p>

            <div className="space-y-4">
              {facturasGeneradas.map((factura, index) => (
                <div
                  key={index}
                  className="border-2 border-green-200 bg-green-50 rounded-lg p-4"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-lg font-bold text-green-900">
                        {factura.tipo}
                        {factura.inversionista && ` - ${factura.inversionista}`}
                      </p>
                      <p className="text-sm text-gray-700 font-mono">
                        Serie: {factura.serie} | Número: {factura.numero}
                      </p>
                      <p className="text-xs text-gray-600 font-mono mt-1">
                        UUID: {factura.uuid}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xl font-bold text-green-800">
                        {formatCurrency(factura.monto_total)}
                      </p>
                      <p className="text-xs text-gray-600">
                        IVA: {formatCurrency(factura.monto_iva)}
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <a
                      href={factura.pdfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      Descargar PDF
                    </a>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setModalFacturasOpen(false);
                  setFacturasGeneradas([]);
                }}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 🆕 MODAL DE VER FACTURAS */}
      <ModalFacturasPago
        open={modalVerFacturasOpen}
        onClose={() => {
          setModalVerFacturasOpen(false);
          setPagoIdParaVerFacturas(null);
        }}
        pagoId={pagoIdParaVerFacturas}
        onFacturasActualizadas={() => {
          refetch();
        }}
      />

    </div>
  );
}
