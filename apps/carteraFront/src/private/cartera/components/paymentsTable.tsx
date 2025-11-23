/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
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
  Badge,
  Download,
  Loader2,
  MoreVertical,
  Undo2,
} from "lucide-react";
import {
  useAplicarPago,
  usePagosConInversionistas,
} from "../hooks/reportPayments";
import {
  getPagosConInversionistasService,
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
  (_, i) => 2020 + i
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

  // Separar fecha y hora
  const [datePart, timePart] = d.split(" ");

  if (!datePart) return "--";

  const [year, month, day] = datePart.split("-");

  // Si hay hora, formatearla; si no, poner 00:00:00
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

// --- componente principal ---
export function PaymentsTable() {
  const { user } = useAuth();
  const { handleReverse, reversePago } = usePagoForm();
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isDownloadingExcel, setIsDownloadingExcel] = useState(false);
  const isMobile = useIsMobile();
  const { investors } = useCatalogs() as {
    investors: Investor[];
    advisors: any[];
    loading: boolean;
  };
  const { mutate: aplicarPago, isPending } = useAplicarPago();

  const [mes, setMes] = React.useState(new Date().getMonth() + 1);
  const [anio, setAnio] = React.useState(new Date().getFullYear());
  const [dia, setDia] = React.useState<number | undefined>(
    new Date().getDate()
  ); // 👈 ¡LISTO!
  const [sifco, setSifco] = React.useState("");
  const [usuarioNombre, setUsuarioNombre] = React.useState("");
  const [inversionistaId, setInversionistaId] = React.useState<
    number | undefined
  >();
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(10);
  const { data: cuentas, isLoading: cargandoCuentas } = useCuentasEmpresa();
  const { mutate: actualizarCuenta, isPending: actualizandoCuenta } =
    useActualizarCuentaPago();

  // Estados para el modal de cuenta
  const [modalCuentaOpen, setModalCuentaOpen] = useState(false);
  const [pagoSeleccionado, setPagoSeleccionado] = useState<number | null>(null);

  // Handler para abrir modal de cuenta
  const handleAbrirModalCuenta = (pagoId: number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setPagoSeleccionado(pagoId);
    setModalCuentaOpen(true);
  };

  // Handler para seleccionar cuenta
  // Handler para seleccionar cuenta - ACTUALIZADO
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
      }
    );
  };

  // Función para verificar si tiene cuenta asignada
  const tieneCuentaAsignada = (pago: PagoDataInvestor) => {
    return (
      pago.cuentaEmpresaNombre !== null ||
      pago.cuentaEmpresaBanco !== null ||
      pago.cuentaEmpresaNumero !== null
    );
  };
  const { data, isLoading,refetch } = usePagosConInversionistas({
    page,
    pageSize,
    numeroCredito: sifco || undefined,
    dia,
    mes,
    anio,
    inversionistaId,
    usuarioNombre: usuarioNombre || undefined,
  });

  const pagos: PagoDataInvestor[] = data?.data || [];
  const totalPages = data?.totalPages ?? 0;

  const [openIdx, setOpenIdx] = React.useState<number | null>(null);
  const [selectedInv, setSelectedInv] = React.useState<
    PagoDataInvestor["inversionistas"]
  >([]);
  const [modalOpen, setModalOpen] = React.useState(false);

  const handleOpenInversionistas = (
    inv: PagoDataInvestor["inversionistas"]
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
        dia,
        mes,
        anio,
        inversionistaId,
        usuarioNombre: usuarioNombre || undefined,
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
  const validationStatusToSpanish = (status: string): string => {
    const translations: Record<string, string> = {
      no_requiere: "No requiere validación",
      pendiente: "Pendiente",
      validated: "Validado",
      // Por si acaso vienen en inglés también
      no_required: "No requiere validación",
      pending: "Pendiente",
    };
    return translations[status];
  };

  // Si quieres también los colores para badges/chips
  const getValidationStatusColor = (status: string): string => {
    const colors: Record<string, string> = {
      no_requiere: "gray",
      no_required: "gray",
      pendiente: "yellow",
      pending: "yellow",
      validated: "green",
    };

    return colors[status] || "gray";
  };
  const handleOpenBoleta = (boleta?: any[] | { urlBoleta?: string } | null) => {
    if (!boleta) {
      alert("⚠️ No hay boleta disponible para este pago.");
      return;
    }

    let url;
    if (Array.isArray(boleta)) {
      if (boleta.length === 0) {
        alert("⚠️ No hay boleta disponible para este pago.");
        return;
      }
      const first = boleta[0];
      url = first.url || first;
    } else {
      // Handle BoletaPago object
      url = boleta.urlBoleta;
    }

    if (!url) {
      alert("⚠️ Boleta sin URL válida.");
      return;
    }
    window.open(url, "_blank");
  };
  return (
    <div className="   fixed inset-0 flex flex-col items-center justify-start bg-gradient-to-br from-blue-50 to-white px-2 overflow-auto pt-8 pb-8">
      <div className="bg-blue-50 rounded-xl shadow-md p-5 w-full max-w-6xl">
        <h2 className="text-2xl font-bold text-blue-900 mb-4 flex items-center gap-2">
          <BadgeDollarSign className="w-6 h-6 text-blue-700" />
          Pagos con Inversionistas
        </h2>

        {/* 🔹 Filtros */}
        <div className="flex flex-col sm:flex-row gap-4 mb-5 flex-wrap">
          {/* Año */}
          <div>
            <label className="block text-blue-900 font-semibold">Año</label>
            <select
              value={anio}
              onChange={(e) => setAnio(Number(e.target.value))}
              className="border-2 border-blue-600 rounded px-2 py-1 text-blue-900 font-semibold bg-white focus:ring-2 focus:ring-blue-400"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          {/* Mes */}
          <div>
            <label className="block text-blue-900 font-semibold">Mes</label>
            <select
              value={mes}
              onChange={(e) => setMes(Number(e.target.value))}
              className="border-2 border-blue-600 rounded px-2 py-1 text-blue-900 font-semibold bg-white focus:ring-2 focus:ring-blue-400"
            >
              {meses.map((m, i) => (
                <option key={i} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          {/* Día */}
          <div>
            <label className="block text-blue-900 font-semibold">Día</label>
            <Input
              type="number"
              min={1}
              max={31}
              value={dia ?? ""}
              onChange={(e) => setDia(Number(e.target.value))}
              placeholder="1-31"
              className="border-2 border-blue-600 text-blue-900 font-semibold bg-white w-[90px]"
            />
          </div>

          {/* N° Crédito SIFCO */}
          <div>
            <label className="block text-blue-900 font-semibold">
              N° Crédito SIFCO
            </label>
            <Input
              value={sifco}
              onChange={(e) => setSifco(e.target.value)}
              placeholder="Buscar SIFCO"
              className="border-2 border-blue-600 text-blue-900 font-semibold bg-white"
            />
          </div>

          {/* Nombre de Usuario */}
          <div>
            <label className="block text-blue-900 font-semibold">
              Nombre de Usuario
            </label>
            <Input
              value={usuarioNombre}
              onChange={(e) => {
                setUsuarioNombre(e.target.value);
                setPage(1);
              }}
              placeholder="Buscar usuario"
              className="border-2 border-blue-600 text-blue-900 font-semibold bg-white"
            />
          </div>

          {/* Inversionista */}
          <div>
            <label className="block text-blue-900 font-semibold">
              Inversionista
            </label>
            <select
              value={inversionistaId ?? ""}
              onChange={(e) => {
                const val = e.target.value ? Number(e.target.value) : undefined;
                setInversionistaId(val);
                setPage(1);
              }}
              className="border-2 border-blue-600 rounded px-2 py-1 text-blue-900 font-semibold bg-white w-[220px]"
            >
              <option value="">Todos los inversionistas</option>
              {investors.map((inv) => (
                <option key={inv.inversionista_id} value={inv.inversionista_id}>
                  {inv.nombre}
                </option>
              ))}
            </select>
          </div>

          {/* Botón limpiar filtro */}
          <button
            type="button"
            onClick={() => {
              setSifco("");
              setUsuarioNombre("");
              setMes(new Date().getMonth() + 1);
              setAnio(new Date().getFullYear());
              setDia(new Date().getDate());
              setInversionistaId(undefined);
              setPage(1);
            }}
            className="self-end px-3 py-2 rounded-lg bg-blue-100 border border-blue-400 text-blue-800 font-bold hover:bg-blue-200"
          >
            Limpiar filtro
          </button>
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
                  {/* 💙 Texto forzado a ser legible */}
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
                        { label: "Convenio", value: data.totales.totalConvenio },
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

                      {/* Total General */}
                    </div>

                    {/* Botón Excel */}
                    <div className="flex justify-end pt-4 border-t border-blue-100">
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
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}

        <br></br>

        {/* 🔹 Contenido principal */}
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
            {pagos.map((pago, idx) => (
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
                  <p className="text-blue-900 font-semibold">
                    {pago.usuario?.nombre}
                  </p>
                </div>

                {/* 🔘 Acciones */}
                <div className="flex gap-3 mt-3">
                  {/* 👁️ Este botón lo ven TODOS */}
                  <button
                    onClick={() => handleOpenBoleta(pago.boleta)}
                    className="text-blue-700 font-semibold flex items-center gap-1 hover:text-blue-900"
                  >
                    <FileText className="w-4 h-4" /> Ver Boleta
                  </button>

                  {/* 🔒 Inversionistas - Deshabilitado si NO es admin */}
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
                    title={user?.role !== "ADMIN" ? "Solo administradores" : ""}
                  >
                    <Users2 className="w-4 h-4" /> Inversionistas
                  </button>

                  {/* 🔒 Validar Pago - Deshabilitado si NO es admin O ya está validado */}
                  <button
                    onClick={() => aplicarPago(pago.pagoId)}
                    disabled={
                      user?.role !== "ADMIN" ||
                      isPending ||
                      pago.validationStatus === "validated" ||
                      !tieneCuentaAsignada(pago) // Deshabilitar si no tiene cuenta asignada
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
                          ? "Debe asignar una cuenta primero" // 👈 NUEVO
                          : pago.validationStatus === "validated"
                            ? "Ya validado"
                            : ""
                    }
                  >
                    <Check className="w-4 h-4" />
                    {pago.validationStatus === "validated"
                      ? "Ya Validado"
                      : !tieneCuentaAsignada(pago)
                        ? "Sin Cuenta" // 👈 NUEVO
                        : isPending
                          ? "Validando..."
                          : "Validar Pago"}
                  </button>
                  <button
                    className="bg-yellow-500 hover:bg-yellow-600 text-white px-3 py-1 rounded font-bold shadow"
                    onClick={() =>
                      handleReverse(pago.pagoId, pago.credito?.creditoId || 0,false)
                    }
                    disabled={reversePago.isPending || user?.role !== "ADMIN"}
                  >
                    {reversePago.isPending ? (
                      <>
                        <Loader2 className="animate-spin w-4 h-4 mr-1" />
                        Revirtiendo...
                      </>
                    ) : (
                      "Revertir Pago"
                    )}
                  </button>
                </div>

                {/* 🔽 Colapsable */}
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
                        label: "validationStatus",
                        value: (
                          <span
                            className={`badge badge-${getValidationStatusColor(pago.validationStatus)}`}
                          >
                            {validationStatusToSpanish(pago.validationStatus)}
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
                        ? { label: "Categoria", value: pago.usuario.Categoria }
                        : null,
                      { label: "Banco", value: pago.bancoNombre || "—" },
                      {
                        label: "numeroautorizacion",
                        value: pago.numeroautorizacion || "—",
                      },
                      {
                        label: "Registrado por",
                        value: pago.registerBy || "—",
                      },
                    ]
                      .filter(Boolean)
                      .filter((f: any) => {
                        // 👈 NUEVO: Ocultar si rawValue es 0 o "0.00"
                        if (f.rawValue !== undefined) {
                          return Number(f.rawValue) !== 0;
                        }
                        return true; // Mostrar campos sin rawValue
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
                </div>
              </div>
            ))}
          </div>
        ) : (
          // 💻 Vista escritorio
          <div className="overflow-x-hidden rounded-xl bg-white shadow border border-blue-100 w-full">
            <Table className="w-full border-separate border-spacing-y-1">
              <TableHeader>
                <TableRow className="bg-blue-100">
                  <TableHead></TableHead>
                  <TableHead className="text-center font-bold text-blue-800">
                    SIFCO
                  </TableHead>
                  <TableHead className="text-center font-bold text-blue-800">
                    Monto Boleta
                  </TableHead>
                  <TableHead className="text-center font-bold text-blue-800">
                    Fecha Pago
                  </TableHead>
                  <TableHead className="text-center font-bold text-blue-800">
                    Usuario
                  </TableHead>
                  <TableHead className="text-center font-bold text-blue-800">
                    Categoria
                  </TableHead>
                  <TableHead className="text-center font-bold text-blue-800">
                    Acciones
                  </TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {pagos.map((pago, idx) => (
                  <React.Fragment key={pago.pagoId}>
                    <TableRow
                      className={`hover:bg-blue-50 cursor-pointer ${
                        openIdx === idx ? "ring-2 ring-blue-300" : ""
                      }`}
                      onClick={() => setOpenIdx(openIdx === idx ? null : idx)}
                    >
                      <TableCell className="text-center">
                        {openIdx === idx ? <ChevronUp /> : <ChevronDown />}
                      </TableCell>
                      <TableCell className="text-center text-blue-700 font-bold">
                        {pago.credito?.numeroCreditoSifco}
                      </TableCell>
                      <TableCell className="text-center text-green-800 font-bold">
                        {formatCurrency(pago.montoBoleta)}
                      </TableCell>
                      <TableCell className="text-center text-blue-700 font-bold">
                        {formatDate(pago.fechaPago)}
                      </TableCell>
                      <TableCell className="text-center text-blue-900 font-semibold">
                        {pago.usuario?.nombre}
                      </TableCell>
                      <TableCell className="text-center text-blue-900 font-semibold">
                        {pago.usuario?.Categoria}
                      </TableCell>
                      <TableCell className="text-center">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="p-2 hover:bg-blue-50 rounded-full transition shadow-sm border border-gray-200">
                              <MoreVertical className="w-5 h-5 text-blue-600" />
                            </button>
                          </DropdownMenuTrigger>

                          <DropdownMenuContent
                            align="end"
                            side="top" // 👈 NUEVO: Abre hacia arriba
                            sideOffset={5} // 👈 NUEVO: Separación del botón
                            className="w-56 bg-white shadow-lg border border-gray-200"
                          >
                            {/* 👁️ Ver Boleta - TODOS pueden verla */}
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenBoleta(pago.boleta);
                              }}
                              className="cursor-pointer text-blue-700 hover:text-blue-900 hover:bg-blue-50 py-2.5 px-3 flex items-center" // 👈 flex items-center
                            >
                              <FileText className="w-4 h-4 mr-2 text-blue-600 flex-shrink-0" />{" "}
                              {/* 👈 flex-shrink-0 */}
                              <span className="font-semibold">Ver Boleta</span>
                            </DropdownMenuItem>

                            <DropdownMenuSeparator className="bg-gray-200" />
                            {/* 🏦 NUEVO - Seleccionar Cuenta */}
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAbrirModalCuenta(pago.pagoId, e);
                              }}
                              className="cursor-pointer text-blue-700 hover:text-blue-900 hover:bg-blue-50 py-2.5 px-3 flex items-center"
                            >
                              <BadgeDollarSign className="w-4 h-4 mr-2 text-blue-600 flex-shrink-0" />
                              <span className="font-semibold">
                                {pago.cuentaEmpresaNombre
                                  ? "Cambiar Cuenta"
                                  : "Asignar Cuenta"}
                              </span>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator className="bg-gray-200" />
                            {/* 🔒 Inversionistas - Solo ADMIN */}
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                if (user?.role === "ADMIN") {
                                  handleOpenInversionistas(pago.inversionistas);
                                }
                              }}
                              disabled={user?.role !== "ADMIN"}
                              className={`cursor-pointer py-2.5 px-3 flex items-center ${
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

                            <DropdownMenuSeparator className="bg-gray-200" />

                            {/* 🔒 Validar Pago - Solo ADMIN */}
                            {/* 🔒 Validar Pago - Solo ADMIN Y con cuenta asignada */}
                            <DropdownMenuItem
                              onClick={() => {
                                if (
                                  user?.role === "ADMIN" &&
                                  pago.validationStatus !== "validated" &&
                                  tieneCuentaAsignada(pago) // 👈 NUEVO
                                ) {
                                  aplicarPago(pago.pagoId);
                                }
                              }}
                              disabled={
                                user?.role !== "ADMIN" ||
                                isPending ||
                                pago.validationStatus === "validated" ||
                                !tieneCuentaAsignada(pago) // 👈 NUEVO
                              }
                              className={`cursor-pointer py-2.5 px-3 flex items-center ${
                                pago.validationStatus === "validated" ||
                                user?.role !== "ADMIN" ||
                                !tieneCuentaAsignada(pago) // 👈 NUEVO
                                  ? "opacity-50 text-gray-400 bg-gray-50"
                                  : "text-blue-700 hover:text-blue-900 hover:bg-blue-50"
                              }`}
                            >
                              <Check
                                className={`w-4 h-4 mr-2 flex-shrink-0 ${
                                  pago.validationStatus === "validated" ||
                                  user?.role !== "ADMIN" ||
                                  !tieneCuentaAsignada(pago) // 👈 NUEVO
                                    ? "text-gray-400"
                                    : "text-blue-600"
                                }`}
                              />
                              <span className="font-semibold">
                                {pago.validationStatus === "validated"
                                  ? "Ya Validado"
                                  : !tieneCuentaAsignada(pago) // 👈 NUEVO
                                    ? "Sin Cuenta"
                                    : isPending
                                      ? "Validando..."
                                      : "Validar Pago"}
                              </span>
                              {user?.role !== "ADMIN" && (
                                <span className="ml-auto text-xs text-gray-400 font-normal">
                                  Admin
                                </span>
                              )}
                            </DropdownMenuItem>

                            <DropdownMenuSeparator className="bg-gray-200" />

                            {/* 🔒 Revertir Pago - Solo ADMIN */}
                            <DropdownMenuItem
                              onClick={() => {
                                if (user?.role === "ADMIN") {
                                  handleReverse(
                                    pago.pagoId,
                                    pago.credito?.creditoId || 0,false
                                  );
                                }
                              }}
                              disabled={
                                reversePago.isPending || user?.role !== "ADMIN"
                              }
                              className={`cursor-pointer py-2.5 px-3 flex items-center ${
                                user?.role !== "ADMIN"
                                  ? "opacity-50 text-gray-400 bg-gray-50"
                                  : "text-blue-700 hover:text-blue-900 hover:bg-blue-50"
                              }`}
                            >
                              <Undo2
                                className={`w-4 h-4 mr-2 flex-shrink-0 ${user?.role !== "ADMIN" ? "text-gray-400" : "text-blue-600"}`}
                              />
                              <span className="font-semibold">
                                {reversePago.isPending
                                  ? "Revirtiendo..."
                                  : "Revertir Pago"}
                              </span>
                              {user?.role !== "ADMIN" && (
                                <span className="ml-auto text-xs text-gray-400 font-normal">
                                  Admin
                                </span>
                              )}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>

                    {/* 🔹 Colapso */}
                    <TableRow>
                      <TableCell colSpan={6} className="p-0">
                        <div
                          className={`transition-all duration-500 overflow-hidden ${
                            openIdx === idx
                              ? "max-h-[1000px] opacity-100"
                              : "max-h-0 opacity-0"
                          }`}
                        >
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-5 p-4 bg-blue-50 border-t border-blue-200">
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
                              {
                                label: "Estado de Validación",
                                value: (
                                  <span
                                    className={`badge badge-${getValidationStatusColor(pago.validationStatus)}`}
                                  >
                                    {validationStatusToSpanish(
                                      pago.validationStatus
                                    )}
                                  </span>
                                ),
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
                                    value: formatDate(
                                      pago.cuota.fechaVencimiento
                                    ),
                                  }
                                : null,
                              {
                                label: "Observaciones",
                                value: pago.observaciones || "—",
                              },
                              {
                                label: "Banco",
                                value: pago.bancoNombre || "—",
                              },
                              {
                                label: "numeroautorizacion",
                                value: pago.numeroautorizacion || "—",
                              },
                              {
                                label: "Registrado por",
                                value: pago.registerBy || "—",
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
                                // 👈 NUEVO: Ocultar si rawValue es 0 o "0.00"
                                if (f.rawValue !== undefined) {
                                  return Number(f.rawValue) !== 0;
                                }
                                return true; // Mostrar campos sin rawValue
                              })
                              .map((f: any, i) => (
                                <div
                                  key={i}
                                  className="bg-white rounded-lg border border-blue-100 p-3"
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
                        </div>
                      </TableCell>
                    </TableRow>
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* 🔹 Paginación */}
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
              {[10, 20, 50, 100].map((size) => (
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

      {/* 🔹 Modal de inversionistas */}
      <ModalInversionistas
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        inversionistas={selectedInv}
      />
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

      {/* 👇 NUEVO - Mostrar cuenta actual */}
      {pagoSeleccionado && (() => {
        const pagoActual = pagos.find(p => p.pagoId === pagoSeleccionado);
        return pagoActual && tieneCuentaAsignada(pagoActual) ? (
          <div className="mb-4 p-3 bg-blue-50 border-2 border-blue-300 rounded-lg">
            <p className="text-xs text-blue-700 font-semibold mb-1">Cuenta actual:</p>
            <p className="font-bold text-blue-900">{pagoActual.cuentaEmpresaNombre}</p>
            <p className="text-sm text-blue-700">{pagoActual.cuentaEmpresaBanco}</p>
            <p className="text-xs text-gray-600 font-mono">N° {pagoActual.cuentaEmpresaNumero}</p>
          </div>
        ) : null;
      })()}

      {cargandoCuentas ? (
        <div className="text-center py-8">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto" />
          <p className="text-blue-700 font-semibold mt-2">Cargando cuentas...</p>
        </div>
      ) : cuentas && cuentas.length > 0 ? (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {cuentas.map((cuenta: CuentaEmpresa) => {
            // 👇 NUEVO - Destacar cuenta actual
            const pagoActual = pagos.find(p => p.pagoId === pagoSeleccionado);
            const esCuentaActual = pagoActual && 
              pagoActual.cuentaEmpresaNombre === cuenta.nombreCuenta &&
              pagoActual.cuentaEmpresaNumero === cuenta.numeroCuenta;

            return (
              <button
                key={cuenta.cuentaId}
                onClick={() => handleSeleccionarCuenta(cuenta.cuentaId)}
                disabled={actualizandoCuenta}
                className={`w-full text-left p-4 border-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all group ${
                  esCuentaActual
                    ? "border-green-400 bg-green-50" // 👈 Resaltar cuenta actual
                    : "border-blue-200 hover:bg-blue-50 hover:border-blue-400"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className={`font-bold text-lg ${
                      esCuentaActual ? "text-green-900" : "text-blue-900 group-hover:text-blue-700"
                    }`}>
                      {cuenta.nombreCuenta}
                    </p>
                    <p className={`text-sm font-semibold ${
                      esCuentaActual ? "text-green-700" : "text-blue-700"
                    }`}>
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
    </div>
  );
}
