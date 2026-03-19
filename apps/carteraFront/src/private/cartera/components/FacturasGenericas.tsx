/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState } from "react";
import { useFormik, FieldArray, FormikProvider } from "formik";
import * as Yup from "yup";
import { toast } from "sonner";
import {
  Receipt,
  Plus,
  Trash2,
  Loader2,
  ChevronLeft,
  ChevronRight,
  FileText,
  X,
  DollarSign,
  Calendar,
  CalendarRange,
  User,
  Download,
  AlertTriangle,
  Building2,
  Search,
  FileSpreadsheet,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/Provider/authProvider";
import { useFacturarGenerico, useFacturasGenericas, useAnularFactura, useExportFacturasExcel } from "../hooks/cofidi";
import { DatePickerMUI } from "./calendar";
import type { FacturaGenericaItem, EmisorKey, TipoFacturaGenerica } from "../services/services";

// --- Utilidades ---
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
  const date = new Date(d);
  return date.toLocaleDateString("es-GT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

// --- Validación NIT Guatemala (mínimo 5 dígitos o CF) ---
const validarNIT = (nit: string): boolean => {
  if (!nit) return false;

  // CF es válido
  if (nit.toUpperCase() === "CF") return true;

  // Solo números, mínimo 5 dígitos
  const nitLimpio = nit.replace(/[-\s]/g, "");
  if (!/^\d+$/.test(nitLimpio)) return false;

  // Debe tener mínimo 5 dígitos
  return nitLimpio.length >= 5;
};

// --- Opciones de emisor ---
const EMISORES_OPTIONS: { value: EmisorKey; label: string }[] = [
  { value: "CUBE", label: "CUBE" },
  { value: "SE_PRESTA", label: "Se Presta" },
  { value: "AMJK", label: "AMJK" },
  { value: "CREACION_IMAGEN", label: "Creación Imagen" },
  { value: "GRUPO_BATRO", label: "Grupo Batro" },
  { value: "AUTOCASH", label: "AutoCash" },
];

// --- Schema de validación con Yup ---
const validationSchema = Yup.object({
  nit: Yup.string()
    .required("El NIT es requerido")
    .test("nit-valido", "NIT inválido (mínimo 5 dígitos o CF)", (value) =>
      validarNIT(value || "")
    ),
  emisor: Yup.string()
    .required("El emisor es requerido")
    .oneOf(EMISORES_OPTIONS.map((e) => e.value), "Emisor inválido"),
  items: Yup.array()
    .of(
      Yup.object({
        rubro: Yup.string()
          .required("El rubro es requerido")
          .min(3, "Mínimo 3 caracteres"),
        monto: Yup.number()
          .required("El monto es requerido")
          .min(0.01, "El monto debe ser mayor a 0"),
      })
    )
    .min(1, "Debe agregar al menos un item"),
});

// --- Componente Principal ---
export function FacturasGenericas() {
  const { user } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [nitBusqueda, setNitBusqueda] = useState("");
  const [nitFiltro, setNitFiltro] = useState("");
  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaFin, setFechaFin] = useState("");
  const [fechaInicioFiltro, setFechaInicioFiltro] = useState("");
  const [fechaFinFiltro, setFechaFinFiltro] = useState("");
  const [tipoFactura, setTipoFactura] = useState<TipoFacturaGenerica | "">("");
  const [tipoFacturaFiltro, setTipoFacturaFiltro] = useState<TipoFacturaGenerica | "">("");

  // Estados para anulación
  const [facturaParaAnular, setFacturaParaAnular] = useState<string | null>(null);
  const [motivoAnulacion, setMotivoAnulacion] = useState("");

  // Hooks
  const { mutate: facturar, isPending: isFacturando } = useFacturarGenerico();
  const anularFactura = useAnularFactura();
  const exportExcel = useExportFacturasExcel();
  const { data, isLoading, refetch } = useFacturasGenericas({
    nit: nitFiltro || undefined,
    fecha_inicio: fechaInicioFiltro || undefined,
    fecha_fin: fechaFinFiltro || undefined,
    tipo: tipoFacturaFiltro || undefined,
    page,
    limit,
  });

  const facturas: FacturaGenericaItem[] = data?.data?.facturas || [];
  const pagination = data?.data?.pagination;

  // Función para anular factura
  const handleAnular = () => {
    if (!motivoAnulacion.trim()) {
      toast.error("Debes escribir un motivo de anulación");
      return;
    }

    if (!facturaParaAnular || !user?.id) {
      toast.error("Error: datos incompletos");
      return;
    }

    toast.loading("Anulando factura...", { id: "anulando-factura" });

    anularFactura.mutate(
      {
        uuid: facturaParaAnular,
        motivo: motivoAnulacion,
        userId: user.id,
        xmlAnulacion: "",
      },
      {
        onSuccess: (response) => {
          if (response.success) {
            toast.success("Factura anulada exitosamente", { id: "anulando-factura" });
            setFacturaParaAnular(null);
            setMotivoAnulacion("");
            refetch();
          } else {
            toast.error(response.mensaje || "Error al anular factura", { id: "anulando-factura" });
          }
        },
        onError: (error: any) => {
          toast.error(error?.message || "Error al anular factura", { id: "anulando-factura" });
        },
      }
    );
  };

  // Formik
  const formik = useFormik({
    initialValues: {
      nit: "",
      emisor: "" as EmisorKey | "",
      items: [{ rubro: "", monto: 0 }],
    },
    validationSchema,
    onSubmit: (values, { resetForm }) => {
      if (!user?.id) {
        toast.error("Error: Usuario no autenticado");
        return;
      }

      facturar(
        {
          nit: values.nit.toUpperCase(),
          items: values.items.map((item) => ({
            rubro: item.rubro,
            monto: Number(item.monto),
          })),
          created_by: user.id,
          emisor: values.emisor as EmisorKey,
        },
        {
          onSuccess: (response) => {
            if (response.success) {
              resetForm();
              setModalOpen(false);
              refetch();
            }
          },
        }
      );
    },
  });

  // Calcular total del formulario
  const totalFormulario = formik.values.items.reduce(
    (sum, item) => sum + (Number(item.monto) || 0),
    0
  );

  return (
    <div className="fixed inset-x-0 top-16 xl:top-20 bottom-0 flex flex-col items-center justify-start bg-gradient-to-br from-purple-50 to-white px-4 sm:px-6 lg:px-8 overflow-auto pt-8 pb-8">
      <div className="bg-purple-50 rounded-xl shadow-md p-5 w-full max-w-6xl">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <h2 className="text-2xl font-bold text-purple-900 flex items-center gap-2">
            <Receipt className="w-6 h-6 text-purple-700" />
            Facturas Genéricas
          </h2>

          <Button
            onClick={() => setModalOpen(true)}
            className="bg-purple-600 hover:bg-purple-700 text-white gap-2"
          >
            <Plus className="w-5 h-5" />
            Nueva Factura
          </Button>
        </div>

        {/* Filtros */}
        <div className="mb-4 bg-white rounded-xl border border-purple-200 shadow-sm overflow-hidden">
          {/* Header filtros */}
          <div className="bg-gradient-to-r from-purple-50 to-indigo-50 px-4 py-2.5 border-b border-purple-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Search className="w-4 h-4 text-purple-600" />
                <span className="font-semibold text-purple-800 text-sm">Filtros</span>
              </div>
              {(nitFiltro || fechaInicioFiltro || fechaFinFiltro || tipoFacturaFiltro) && (
                <button
                  type="button"
                  onClick={() => {
                    setNitBusqueda("");
                    setNitFiltro("");
                    setFechaInicio("");
                    setFechaFin("");
                    setFechaInicioFiltro("");
                    setFechaFinFiltro("");
                    setTipoFactura("");
                    setTipoFacturaFiltro("");
                    setPage(1);
                  }}
                  className="text-xs font-semibold text-purple-600 hover:text-purple-800 hover:underline transition"
                >
                  Limpiar filtros
                </button>
              )}
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              setNitFiltro(nitBusqueda.trim());
              setFechaInicioFiltro(fechaInicio);
              setFechaFinFiltro(fechaFin);
              setTipoFacturaFiltro(tipoFactura);
              setPage(1);
            }}
            className="p-4 space-y-4"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
              {/* NIT */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-purple-700 mb-1.5">
                  <User className="w-3.5 h-3.5" />
                  NIT del Receptor
                </label>
                <Input
                  placeholder="Ej: 12345678"
                  value={nitBusqueda}
                  onChange={(e) => setNitBusqueda(e.target.value)}
                  className="border-purple-200 text-gray-900 focus:border-purple-500 focus:ring-purple-500/20"
                />
              </div>

              {/* Tipo */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-purple-700 mb-1.5">
                  <FileText className="w-3.5 h-3.5" />
                  Tipo
                </label>
                <select
                  value={tipoFactura}
                  onChange={(e) => setTipoFactura(e.target.value as TipoFacturaGenerica | "")}
                  className="w-full h-10 rounded-md border border-purple-200 bg-white px-3 text-sm text-gray-900 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition"
                >
                  <option value="">Todas</option>
                  <option value="pago">Pago de cuota</option>
                  <option value="credito_nuevo">Crédito nuevo</option>
                </select>
              </div>

              {/* Fecha Inicio */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-purple-700 mb-1.5">
                  <CalendarRange className="w-3.5 h-3.5" />
                  Desde
                </label>
                <DatePickerMUI
                  value={fechaInicio}
                  onChange={(value) => setFechaInicio(value)}
                  disableFuture={false}
                />
              </div>

              {/* Fecha Fin */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-purple-700 mb-1.5">
                  <CalendarRange className="w-3.5 h-3.5" />
                  Hasta
                </label>
                <DatePickerMUI
                  value={fechaFin}
                  onChange={(value) => setFechaFin(value)}
                  disableFuture={false}
                />
              </div>

              {/* Botón Buscar */}
              <div>
                <Button
                  type="submit"
                  className="w-full bg-purple-600 hover:bg-purple-700 text-white gap-2 h-10"
                >
                  <Search className="w-4 h-4" />
                  Buscar
                </Button>
              </div>
            </div>

            {/* Chips de filtros activos + Exportar Excel */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pt-1">
              {/* Chips */}
              <div className="flex flex-wrap gap-2">
                {nitFiltro && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-semibold">
                    NIT: {nitFiltro}
                    <button
                      type="button"
                      onClick={() => { setNitBusqueda(""); setNitFiltro(""); setPage(1); }}
                      className="hover:text-purple-900"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )}
                {tipoFacturaFiltro && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-semibold">
                    Tipo: {tipoFacturaFiltro === "pago" ? "Pago de cuota" : "Crédito nuevo"}
                    <button
                      type="button"
                      onClick={() => { setTipoFactura(""); setTipoFacturaFiltro(""); setPage(1); }}
                      className="hover:text-amber-900"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )}
                {fechaInicioFiltro && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-100 text-indigo-700 rounded-full text-xs font-semibold">
                    Desde: {fechaInicioFiltro}
                    <button
                      type="button"
                      onClick={() => { setFechaInicio(""); setFechaInicioFiltro(""); setPage(1); }}
                      className="hover:text-indigo-900"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )}
                {fechaFinFiltro && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-100 text-indigo-700 rounded-full text-xs font-semibold">
                    Hasta: {fechaFinFiltro}
                    <button
                      type="button"
                      onClick={() => { setFechaFin(""); setFechaFinFiltro(""); setPage(1); }}
                      className="hover:text-indigo-900"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )}
              </div>

              {/* Exportar Excel */}
              <Button
                type="button"
                onClick={() =>
                  exportExcel.mutate({
                    nit: nitFiltro || undefined,
                    fecha_inicio: fechaInicioFiltro || undefined,
                    fecha_fin: fechaFinFiltro || undefined,
                    tipo: tipoFacturaFiltro || undefined,
                  })
                }
                disabled={exportExcel.isPending}
                className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 shadow-sm"
              >
                {exportExcel.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generando...
                  </>
                ) : (
                  <>
                    <FileSpreadsheet className="w-4 h-4" />
                    Exportar Excel
                  </>
                )}
              </Button>
            </div>
          </form>
        </div>

        {/* Resumen */}
        {pagination && (
          <div className="mb-4 p-4 bg-white rounded-lg border border-purple-200">
            <div className="flex flex-wrap gap-4">
              <div className="bg-purple-50 rounded-lg p-3 border border-purple-100">
                <p className="text-xs text-purple-600 font-semibold">
                  Total Facturas
                </p>
                <p className="text-xl font-bold text-purple-900">
                  {pagination.total_items}
                </p>
              </div>
              <div className="bg-green-50 rounded-lg p-3 border border-green-100">
                <p className="text-xs text-green-600 font-semibold">
                  Monto Página
                </p>
                <p className="text-xl font-bold text-green-900">
                  {formatCurrency(data?.data?.monto_total_pagina)}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Tabla de Facturas */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
            <span className="ml-2 text-purple-700 font-semibold">
              Cargando facturas...
            </span>
          </div>
        ) : facturas.length === 0 ? (
          <div className="text-center py-12">
            <Receipt className="w-16 h-16 text-purple-300 mx-auto mb-4" />
            <p className="text-purple-700 font-semibold text-lg">
              No tienes facturas genéricas aún
            </p>
            <p className="text-purple-500 text-sm mt-1">
              Crea tu primera factura usando el botón "Nueva Factura"
            </p>
          </div>
        ) : (
          <>
            {/* Vista Desktop */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full bg-white rounded-lg overflow-hidden shadow">
                <thead className="bg-purple-600 text-white">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">
                      Serie-Número
                    </th>
                    <th className="px-4 py-3 text-left font-semibold">
                      Receptor
                    </th>
                    <th className="px-4 py-3 text-left font-semibold">NIT</th>
                    <th className="px-4 py-3 text-right font-semibold">Monto</th>
                    <th className="px-4 py-3 text-left font-semibold">Fecha</th>
                    <th className="px-4 py-3 text-center font-semibold">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {facturas.map((factura, idx) => (
                    <tr
                      key={factura.factura_id}
                      className={`border-b border-purple-100 hover:bg-purple-50 transition ${
                        idx % 2 === 0 ? "bg-white" : "bg-purple-25"
                      }`}
                    >
                      <td className="px-4 py-3">
                        <span className="font-bold text-purple-900">
                          {factura.serie}-{factura.numero}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-purple-800 font-medium">
                          {factura.receptor_nombre}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-purple-700 font-mono text-sm">
                          {factura.receptor_nit}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-bold text-green-700">
                          {formatCurrency(factura.monto_total)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-purple-600 text-sm">
                          {formatDate(factura.fecha_emision)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <a
                            href={factura.link_pdf || factura.pdf_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition"
                          >
                            <Download className="w-4 h-4" />
                            PDF
                          </a>
                          <button
                            onClick={() => setFacturaParaAnular(factura.uuid)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold transition"
                          >
                            <Trash2 className="w-4 h-4" />
                            Anular
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Vista Mobile */}
            <div className="md:hidden space-y-4">
              {facturas.map((factura) => (
                <div
                  key={factura.factura_id}
                  className="bg-white border-2 border-purple-200 rounded-xl p-4 shadow-sm"
                >
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <p className="font-bold text-purple-900 text-lg">
                        {factura.serie}-{factura.numero}
                      </p>
                      <p className="text-purple-600 text-sm">
                        {factura.receptor_nombre}
                      </p>
                    </div>
                    <span className="font-bold text-green-700 text-lg">
                      {formatCurrency(factura.monto_total)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                    <div className="flex items-center gap-1 text-purple-700">
                      <User className="w-4 h-4" />
                      <span className="font-mono">{factura.receptor_nit}</span>
                    </div>
                    <div className="flex items-center gap-1 text-purple-600">
                      <Calendar className="w-4 h-4" />
                      <span>{formatDate(factura.fecha_emision)}</span>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <a
                      href={factura.link_pdf || factura.pdf_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition"
                    >
                      <Download className="w-4 h-4" />
                      PDF
                    </a>
                    <button
                      onClick={() => setFacturaParaAnular(factura.uuid)}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold transition"
                    >
                      <Trash2 className="w-4 h-4" />
                      Anular
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Paginación */}
            {pagination && (
              <div className="flex flex-col sm:flex-row justify-between items-center mt-6 gap-4">
                {/* Selector de elementos por página */}
                <div className="flex items-center gap-2">
                  <span className="text-purple-900 font-semibold">Ver</span>
                  <select
                    value={limit}
                    onChange={(e) => {
                      setLimit(Number(e.target.value));
                      setPage(1);
                    }}
                    className="border-2 border-purple-500 rounded px-2 py-1 bg-white text-purple-900 font-semibold"
                  >
                    {[10, 20, 50, 100].map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                  <span className="text-purple-900 font-semibold">por página</span>
                </div>

                {/* Info y botones */}
                <div className="flex items-center gap-4">
                  <button
                    disabled={!pagination.has_prev}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="flex items-center px-4 py-2 rounded bg-purple-100 text-gray-900 font-bold disabled:opacity-50 hover:bg-purple-200 transition"
                  >
                    <ChevronLeft className="w-4 h-4 mr-1" /> Anterior
                  </button>

                  <div className="text-purple-900 font-semibold">
                    Página {pagination.current_page} de {pagination.total_pages || 1} ({pagination.total_items} facturas)
                  </div>

                  <button
                    disabled={!pagination.has_next}
                    onClick={() =>
                      setPage((p) => Math.min(pagination.total_pages, p + 1))
                    }
                    className="flex items-center px-4 py-2 rounded bg-purple-100 text-gray-900 font-bold disabled:opacity-50 hover:bg-purple-200 transition"
                  >
                    Siguiente <ChevronRight className="w-4 h-4 ml-1" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ==================== MODAL CREAR FACTURA ==================== */}
      {modalOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={() => !isFacturando && setModalOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header Modal */}
            <div className="sticky top-0 bg-gradient-to-r from-purple-600 to-indigo-600 p-5 rounded-t-2xl">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                  <Receipt className="w-6 h-6" />
                  Nueva Factura Genérica
                </h3>
                <button
                  onClick={() => !isFacturando && setModalOpen(false)}
                  disabled={isFacturando}
                  className="p-2 hover:bg-white/20 rounded-lg transition disabled:opacity-50"
                >
                  <X className="w-5 h-5 text-white" />
                </button>
              </div>
            </div>

            {/* Formulario */}
            <FormikProvider value={formik}>
              <form onSubmit={formik.handleSubmit} className="p-5 space-y-5">
                {/* NIT */}
                <div>
                  <label className="block text-purple-900 font-semibold mb-2">
                    NIT del Cliente *
                  </label>
                  <Input
                    name="nit"
                    placeholder="Ej: 12345 o CF"
                    value={formik.values.nit}
                    onChange={formik.handleChange}
                    onBlur={formik.handleBlur}
                    className={`border-2 text-gray-900 ${
                      formik.touched.nit && formik.errors.nit
                        ? "border-red-400 bg-red-50"
                        : "border-purple-300 focus:border-purple-500"
                    }`}
                  />
                  {formik.touched.nit && formik.errors.nit && (
                    <p className="text-red-500 text-sm mt-1 font-medium">
                      {formik.errors.nit}
                    </p>
                  )}
                  <p className="text-purple-500 text-xs mt-1">
                    Ingresa mínimo 5 dígitos o "CF" para consumidor final
                  </p>
                </div>

                {/* Emisor */}
                <div>
                  <label className="block text-purple-900 font-semibold mb-2">
                    <Building2 className="w-4 h-4 inline-block mr-1 -mt-0.5" />
                    Emisor *
                  </label>
                  <select
                    name="emisor"
                    value={formik.values.emisor}
                    onChange={formik.handleChange}
                    onBlur={formik.handleBlur}
                    className={`w-full rounded-md px-3 py-2 border-2 text-gray-900 bg-white ${
                      formik.touched.emisor && formik.errors.emisor
                        ? "border-red-400 bg-red-50"
                        : "border-purple-300 focus:border-purple-500"
                    }`}
                  >
                    <option value="">Selecciona un emisor...</option>
                    {EMISORES_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  {formik.touched.emisor && formik.errors.emisor && (
                    <p className="text-red-500 text-sm mt-1 font-medium">
                      {formik.errors.emisor}
                    </p>
                  )}
                </div>

                {/* Items */}
                <div>
                  <label className="block text-purple-900 font-semibold mb-2">
                    Items de la Factura *
                  </label>

                  <FieldArray name="items">
                    {({ push, remove }) => (
                      <div className="space-y-3">
                        {formik.values.items.map((item, index) => (
                          <div
                            key={index}
                            className="bg-purple-50 border-2 border-purple-200 rounded-lg p-4"
                          >
                            <div className="flex items-center justify-between mb-3">
                              <span className="text-purple-700 font-semibold text-sm">
                                Item #{index + 1}
                              </span>
                              {formik.values.items.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => remove(index)}
                                  className="p-1.5 text-red-500 hover:bg-red-100 rounded-lg transition"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>

                            <div className="space-y-3">
                              {/* Rubro */}
                              <div>
                                <label className="block text-purple-800 text-sm font-medium mb-1">
                                  Descripción / Rubro
                                </label>
                                <Input
                                  name={`items.${index}.rubro`}
                                  placeholder="Ej: Servicio de consultoría"
                                  value={item.rubro}
                                  onChange={formik.handleChange}
                                  onBlur={formik.handleBlur}
                                  className="border-purple-300 text-gray-900"
                                />
                                {formik.touched.items?.[index]?.rubro &&
                                  (formik.errors.items as any)?.[index]
                                    ?.rubro && (
                                    <p className="text-red-500 text-xs mt-1">
                                      {(formik.errors.items as any)[index].rubro}
                                    </p>
                                  )}
                              </div>

                              {/* Monto */}
                              <div>
                                <label className="block text-purple-800 text-sm font-medium mb-1">
                                  Monto (Q)
                                </label>
                                <div className="relative">
                                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-purple-400" />
                                  <Input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    name={`items.${index}.monto`}
                                    placeholder="0.00"
                                    value={item.monto || ""}
                                    onChange={formik.handleChange}
                                    onBlur={formik.handleBlur}
                                    className="pl-9 border-purple-300 text-gray-900"
                                  />
                                </div>
                                {formik.touched.items?.[index]?.monto &&
                                  (formik.errors.items as any)?.[index]
                                    ?.monto && (
                                    <p className="text-red-500 text-xs mt-1">
                                      {(formik.errors.items as any)[index].monto}
                                    </p>
                                  )}
                              </div>
                            </div>
                          </div>
                        ))}

                        {/* Botón agregar item */}
                        <button
                          type="button"
                          onClick={() => push({ rubro: "", monto: 0 })}
                          className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-purple-300 rounded-lg text-purple-600 font-semibold hover:bg-purple-50 hover:border-purple-400 transition"
                        >
                          <Plus className="w-5 h-5" />
                          Agregar otro item
                        </button>
                      </div>
                    )}
                  </FieldArray>

                  {typeof formik.errors.items === "string" && (
                    <p className="text-red-500 text-sm mt-2 font-medium">
                      {formik.errors.items}
                    </p>
                  )}
                </div>

                {/* Total */}
                <div className="bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-200 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-green-800 font-semibold">
                      Total a Facturar:
                    </span>
                    <span className="text-2xl font-bold text-green-700">
                      {formatCurrency(totalFormulario)}
                    </span>
                  </div>
                  <p className="text-green-600 text-xs mt-1">
                    IVA incluido en el monto
                  </p>
                </div>

                {/* Botones */}
                <div className="flex gap-3 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setModalOpen(false)}
                    disabled={isFacturando}
                    className="flex-1"
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    disabled={isFacturando || !formik.isValid}
                    className="flex-1 bg-purple-600 hover:bg-purple-700 text-white gap-2"
                  >
                    {isFacturando ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Generando...
                      </>
                    ) : (
                      <>
                        <FileText className="w-4 h-4" />
                        Generar Factura
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </FormikProvider>
          </div>
        </div>
      )}

      {/* ==================== MODAL CONFIRMAR ANULACIÓN ==================== */}
      {facturaParaAnular && (
        <div
          className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-[60] p-4"
          onClick={() => {
            if (!anularFactura.isPending) {
              setFacturaParaAnular(null);
              setMotivoAnulacion("");
            }
          }}
        >
          <div
            className="bg-white border-2 border-red-500 rounded-xl p-6 max-w-md w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold text-gray-900 mb-2 flex items-center gap-2">
              <AlertTriangle className="w-6 h-6 text-red-600" />
              Anular Factura
            </h3>
            <p className="text-gray-700 mb-4">
              Esta acción es <span className="font-bold text-red-600">IRREVERSIBLE</span>.
              Ingresa el motivo de anulación:
            </p>

            <textarea
              value={motivoAnulacion}
              onChange={(e) => setMotivoAnulacion(e.target.value)}
              placeholder="Ej: Error en datos del cliente, Factura duplicada, etc."
              className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 focus:border-red-500 focus:ring-2 focus:ring-red-500 mb-4"
              rows={4}
              disabled={anularFactura.isPending}
            />

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setFacturaParaAnular(null);
                  setMotivoAnulacion("");
                }}
                disabled={anularFactura.isPending}
                className="flex-1 px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg font-semibold transition disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleAnular}
                disabled={anularFactura.isPending || !motivoAnulacion.trim()}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold transition disabled:opacity-50"
              >
                {anularFactura.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Anulando...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Confirmar Anulación
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
