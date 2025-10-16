/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRef, useState } from "react";
import { X } from "lucide-react";
import { useCreditosPaginadosWithFilters } from "../hooks/credits";
import { Button } from "@/components/ui/button";
import { Eye, Pencil, XCircle, MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import React from "react";
import {
  CalendarDays,
  Hash,
  Info,
  Layers3,
  ListOrdered,
  RefreshCw,
} from "lucide-react";
import { useMemo } from "react";
import { AlertCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ModalEditCredit } from "./ModalEditCredit";
import { useCatalogs } from "../hooks/catalogs";
import type { Investor } from "../services/services";
import { useQueryClient } from "@tanstack/react-query";
import { ModalCancelCredit } from "./modalCreditCancel";
import { useActivateCredit } from "../hooks/cancelCredit";
import { useIsMobile } from "../hooks/useIsMobile"; 
import { useAuth } from "@/Provider/authProvider";
import { ModalCreateMora } from "./createMoraModal";
export function ListaCreditosPagos() {
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const navigate = useNavigate();
  const {
    data,
    refetch,
    isLoading,
    isError,
    error,
    isFetching,
    mes,
    anio,
    page,
    perPage,
    creditoSifco,
    meses,
    years,
    handleMes,
    handleAnio,
    handleSifco,
    handlePerPage,
    setPage,
    clearSifco,
    setEstado,
    estado,
    estados,
    handleExcel,
  } = useCreditosPaginadosWithFilters();
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [creditToEdit, setCreditToEdit] = useState<any | null>(null);
  const [investorsToEdit, setInvestorsToEdit] = useState<any[]>([]);
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const estadoSeleccionado = useMemo(
    () => estados.find((e) => e.value === estado),
    [estado]
  );
  type CreditStatus =
    | "ACTIVO"
    | "PENDIENTE_CANCELACION"
    | "CANCELADO"
    | "INCOBRABLE";

  // Helpers de permisos
  const canEdit = (s: CreditStatus) => s === "ACTIVO";
  const canCancel = (s: CreditStatus) => s === "ACTIVO";
  const canActivate = (s: CreditStatus) => s === "PENDIENTE_CANCELACION";
  const canViewPayments = (_s: CreditStatus) => true;
  const [openInfoCancelation, setOpenInfoCancelation] = React.useState(false);
  const handleOpenEdit = (credit: any, inversionistas: any) => {
    console.log(inversionistas);
    setCreditToEdit({
      capital: credit.capital,
      porcentaje_interes: credit.porcentaje_interes,
      plazo: credit.plazo,
      no_poliza: credit.no_poliza,
      observaciones: credit.observaciones,
      mora: Number(credit.mora ?? 0),
      credito_id: credit.credito_id,
      cuota: credit.cuota,
      numero_credito_sifco: credit.numero_credito_sifco,
      otros: credit.otros ?? 0,
      seguro_10_cuotas: credit.seguro_10_cuotas ?? 0,
      membresias_pago: credit.membresias_pago ?? 0,
      gps: credit.gps ?? 0,
      // agrega aquí cualquier otro campo nuevo que quieras editar
    });

    setInvestorsToEdit(
      inversionistas.map((inv: any) => ({
        inversionista_id: inv.inversionista_id,
        porcentaje_participacion: inv.porcentaje_participacion,
        monto_aportado: inv.monto_aportado,
        porcentaje_cash_in: inv.porcentaje_cash_in,
        porcentaje_inversion: inv.porcentaje_participacion_inversionista,
        cuota_inversionista: inv.cuota_inversionista ?? 0,
      }))
    );

    setEditModalOpen(true);
  };
  const inputRef = useRef<HTMLInputElement>(null);
  const { investors, advisors } = useCatalogs() as {
    investors: Investor[];
    advisors: any[];
    loading: boolean;
  };
  const [openMoraModal, setOpenMoraModal] = useState(false);
  const [selectedCreditMora, setSelectedCreditMora] = useState<any | null>(
    null
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedCreditId, setSelectedCreditId] = useState<number | null>(null);
  const activateCreditMutation = useActivateCredit();

  // Cuando das click en el botón, setea el crédito a cancelar y abre el modal
  const handleOpenModal = (creditId: number) => {
    setSelectedCreditId(creditId);
    setModalOpen(true);
  };

  // Cuando cierras el modal, resetea ambos states (opcional)
  const handleCloseModal = () => {
    setModalOpen(false);
    setSelectedCreditId(null);
  };
  const { user } = useAuth();
  if (isLoading) return <div>Cargando...</div>;
  if (isError)
    return <div className="text-red-500">{(error as any)?.message}</div>;

  if (!data || data.data.length === 0) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-start bg-gradient-to-br from-blue-50 to-white px-2 overflow-auto pt-8 pb-8">
        <span className="bg-blue-100 p-5 rounded-full mb-4 flex items-center justify-center shadow">
          <Info className="text-blue-500 w-12 h-12" />
        </span>
        <p className="text-blue-700 text-xl font-bold text-center">
          No se encontraron resultados.
        </p>
        <p className="text-gray-500 text-base mt-2 text-center">
          Prueba cambiando los filtros o verifica tu búsqueda.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-8 flex items-center gap-2 px-6 py-2 rounded-xl bg-blue-600 text-white font-bold shadow hover:bg-blue-700 transition-all"
        >
          <RefreshCw className="w-5 h-5" /> Reintentar
        </button>
      </div>
    );
  }

  return (
    <div
      className={`
   fixed inset-0 flex flex-col items-center justify-start bg-gradient-to-br from-blue-50 to-white px-2 overflow-auto pt-8 pb-8
    ${isMobile ? "" : "overflow-x-auto"}
  `}
    >
      {/* Título */}
      <div className="flex flex-col items-center mb-6">
        <h1 className="text-3xl font-extrabold text-blue-700 text-center">
          Créditos
        </h1>
        <p className="text-lg text-gray-600 leading-relaxed text-center max-w-xl mt-2">
          Consulta aquí el detalle y estado de todos los créditos registrados,
          junto con su información más relevante y pagos asociados.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-white/80 border border-blue-100 shadow-md rounded-2xl px-4 py-4 w-full max-w-4xl mx-auto mb-6">
        {/* Filtros */}
        {/* ...los filtros como los tienes... */}
        {/* ...tu código de filtros aquí... */}
        {/* (igual que antes, sin cambios) */}
        <label className="flex items-center gap-2 font-medium text-blue-800">
          <CalendarDays className="w-5 h-5" />
          <select
            className="border border-blue-200 rounded-lg px-3 py-2 bg-blue-50 text-blue-800 focus:ring-2 focus:ring-blue-400"
            value={mes}
            onChange={handleMes}
          >
            {meses.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 font-medium text-blue-800">
          <Layers3 className="w-5 h-5" />
          <select
            className="border border-blue-200 rounded-lg px-3 py-2 bg-blue-50 text-blue-800 focus:ring-2 focus:ring-blue-400"
            value={anio}
            onChange={handleAnio}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 font-medium text-blue-800">
          <Hash className="w-5 h-5" />
          <input
            ref={inputRef}
            className="border border-blue-200 rounded-lg px-3 py-2 bg-blue-50 text-blue-800 focus:ring-2 focus:ring-blue-400"
            type="text"
            placeholder="Buscar # Crédito SIFCO"
            defaultValue={creditoSifco}
            onBlur={(e) => {
              if (e.target.value !== creditoSifco) {
                handleSifco(e.target.value);
                setPage(1);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (
                  inputRef.current &&
                  inputRef.current.value !== creditoSifco
                ) {
                  handleSifco(inputRef.current.value);
                  setPage(1);
                }
              }
            }}
          />
          <button
            type="button"
            className="ml-2 px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 transition"
            onClick={() => {
              if (inputRef.current && inputRef.current.value !== creditoSifco) {
                handleSifco(inputRef.current.value);
                setPage(1);
              }
            }}
          >
            Buscar
          </button>
          {creditoSifco && (
            <button
              type="button"
              className="ml-1 p-1 rounded-full bg-blue-100 text-blue-600 hover:bg-blue-200 transition"
              onClick={clearSifco}
              title="Limpiar filtro"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </label>
        <label className="flex items-center gap-2 font-medium text-blue-800">
          <AlertCircle className="w-5 h-5" />
          <div className="relative w-full">
            <select
              className={`border border-blue-200 rounded-lg px-3 py-2 bg-blue-50 text-blue-800 focus:ring-2 focus:ring-blue-400 w-full appearance-none pr-8`}
              value={estado}
              onChange={(e) => {
                setEstado(
                  e.target.value as
                    | "ACTIVO"
                    | "CANCELADO"
                    | "INCOBRABLE"
                    | "PENDIENTE_CANCELACION"
                    | "MOROSO"
                    
                );
                setPage(1);
              }}
              style={{
                background:
                  estadoSeleccionado?.color?.includes("bg-") && estado
                    ? undefined
                    : undefined,
              }}
            >
              <option value="">Seleccionar estado</option>
              {estados.map((est) => (
                <option
                  key={est.value}
                  value={est.value}
                  // Esto aplica color al option solo en Chrome y navegadores modernos.
                  style={{
                    backgroundColor: est.color.includes("bg-green")
                      ? "#bbf7d0"
                      : est.color.includes("bg-red")
                        ? "#fecaca"
                        : est.color.includes("bg-yellow")
                          ? "#fef9c3"
                          : est.color.includes("bg-blue")
                            ? "#dbeafe"
                            : undefined,
                    color: est.color.includes("text-green")
                      ? "#166534"
                      : est.color.includes("text-red")
                        ? "#991b1b"
                        : est.color.includes("text-yellow")
                          ? "#a16207"
                          : est.color.includes("text-blue")
                            ? "#1e40af"
                            : undefined,
                  }}
                >
                  {est.label}
                </option>
              ))}
            </select>
            {estado && (
              <span
                className={`absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs font-bold pointer-events-none ${
                  estadoSeleccionado?.color || ""
                }`}
              >
                {estadoSeleccionado?.label}
              </span>
            )}
          </div>
        </label>
        <label className="flex items-center gap-2 font-medium text-blue-800">
          <ListOrdered className="w-5 h-5" />
          <select
            className="border border-blue-200 rounded-lg px-3 py-2 bg-blue-50 text-blue-800 focus:ring-2 focus:ring-blue-400"
            value={perPage}
            onChange={handlePerPage}
          >
            {[5, 10, 20, 50, 100, 200].map((n) => (
              <option key={n} value={n}>
                {n} por página
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={async () => {
            try {
              // Pedimos el Excel al backend
              handleExcel(true); // 👈 activamos
              const response = await refetch();

              if (response.data && "excelUrl" in response.data) {
                const url = (response.data as any).excelUrl;
                window.open(url, "_blank");
              } else {
                alert("No se pudo generar el Excel 😢");
              }
            } catch (err) {
              console.error("❌ Error generando Excel:", err);
              alert("Error al generar el Excel");
            } finally {
              handleExcel(false); // 👈 volvemos a normal
            }
          }}
          className="mt-4 px-6 py-2 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700 transition shadow-md"
        >
          📊 Descargar Excel
        </button>
      </div>

      {/* Tabla, sin scroll horizontal, diseño responsivo */}

      {isMobile ? (
<div className="space-y-4">
  {data.data.map((item: any, idx: number) => (
    <div
      key={item.creditos.credito_id}
      className="border rounded-xl p-4 shadow bg-white"
    >
      {/* Header */}
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-blue-800 font-bold text-lg">
          #{item.creditos.numero_credito_sifco}
        </h3>
        <Button
          onClick={() => setExpandedRow(expandedRow === idx ? null : idx)}
          className="text-blue-600 text-sm"
          variant="ghost"
        >
          {expandedRow === idx ? "Ocultar" : "Ver más"}
        </Button>
      </div>

      {/* Estado */}
      <p className="text-sm text-gray-700">
        <strong>Usuario:</strong> {item.usuarios.nombre}
      </p>
      <p className="text-sm text-gray-700">
        <strong>Deuda Total:</strong> Q
        {Number(item.creditos.deudatotal).toLocaleString("es-GT", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </p>
      <p className="text-sm text-gray-700">
        <strong>Cuota:</strong> Q
        {Number(item.creditos.cuota).toLocaleString("es-GT", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </p>
      <p className="text-sm text-gray-700">
        <strong>Estado:</strong>{" "}
        <span
          className={`font-bold ${
            item.creditos.statusCredit === "ACTIVO"
              ? "text-green-600"
              : item.creditos.statusCredit === "CANCELADO"
              ? "text-red-600"
              : item.creditos.statusCredit === "INCOBRABLE"
              ? "text-purple-700"
              : item.creditos.statusCredit === "PENDIENTE_CANCELACION"
              ? "text-yellow-500"
              : "text-gray-500"
          }`}
        >
          {item.creditos.statusCredit === "PENDIENTE_CANCELACION"
            ? "Pendiente de Cancelación"
            : item.creditos.statusCredit === "INCOBRABLE"
            ? "Incobrable"
            : item.creditos.statusCredit}
        </span>
      </p>

      {/* Acciones */}
        <div className="flex justify-center flex-wrap gap-2 mt-3">
        <Button
          variant="outline"
          className="text-blue-700 border-blue-300 hover:bg-blue-50"
          onClick={() =>
            navigate(`/pagos/${item.creditos.numero_credito_sifco}`)
          }
        >
          <Eye className="w-4 h-4 mr-1" /> Ver pagos
        </Button>
        {user?.role === "ADMIN" && (
          <>
            <Button
              variant="outline"
              className="text-yellow-700 border-yellow-300 hover:bg-yellow-50"
              onClick={() =>
                handleOpenEdit(item.creditos, item.inversionistas)
              }
            >
              <Pencil className="w-4 h-4 mr-1" /> Editar
            </Button>
            <Button
              variant="outline"
              className="text-red-700 border-red-300 hover:bg-red-50"
              onClick={() => handleOpenModal(item.creditos.credito_id)}
            >
              <XCircle className="w-4 h-4 mr-1" /> Cancelar
            </Button>
            <Button
              variant="outline"
              className="text-purple-700 border-purple-300 hover:bg-purple-50"
              onClick={() => {
                setSelectedCreditMora(item.creditos);
                setOpenMoraModal(true);
              }}
            >
              ➕ Mora
            </Button>
          </>
        )}
      </div>

      {/* Expandible */}
      {expandedRow === idx && (
        <div className="mt-4 space-y-4">
          {/* Detalles del crédito */}
          <div className="bg-blue-50 rounded-2xl p-4">
            <h4 className="text-xl font-extrabold text-blue-800 mb-2 text-center uppercase">
              Detalles del crédito
            </h4>
            <div className="grid grid-cols-2 gap-3 text-center">
              {[
                ["Capital", item.creditos.capital],
                ["Porcentaje Interés", `${item.creditos.porcentaje_interes}%`],
                ["Deuda Total", item.creditos.deudatotal],
                ["Cuota", item.creditos.cuota],
                ["Cuota Interés", item.creditos.cuota_interes],
                ["IVA 12%", item.creditos.iva_12],
                ["Seguro 10 Cuotas", item.creditos.seguro_10_cuotas],
                ["GPS", item.creditos.gps],
                ["Membresías", item.creditos.membresias],
                ["Royalti", item.creditos.royalti],
                ["Plazo", item.creditos.plazo],
                ["Formato Crédito", item.creditos.formato_credito],
              ].map(([label, value]) => (
                 <div
                  key={label}
                  className="p-3 rounded-lg bg-white border shadow-sm flex flex-col items-center"
                >
                  <span className="font-bold text-blue-700">{label}:</span>
                  <span className="text-gray-900 font-semibold">
                    {typeof value === "number"
                      ? `Q${Number(value).toLocaleString("es-GT", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}`
                      : value}
                  </span>
                </div>
              ))}
            </div>

            {/* Observaciones */}
            <div className="mt-4">
              <span className="font-bold text-blue-700">Observaciones:</span>
              <div className="text-sm text-gray-800 p-2 border rounded-md bg-gray-50">
                <details>
                  <summary className="cursor-pointer text-blue-600 font-semibold">
                    {item.creditos.observaciones
                      ? "Ver observaciones"
                      : "No hay observaciones"}
                  </summary>
                  {item.creditos.observaciones && (
                    <p className="mt-2 whitespace-pre-line">
                      {item.creditos.observaciones}
                    </p>
                  )}
                </details>
              </div>
            </div>
          </div>

       {/* ?='===== Mora ====== */}
{item?.mora?.activa && (
  <div className="bg-yellow-50 rounded-2xl p-4">
    <h4 className="text-lg font-extrabold text-yellow-800 mb-3 text-center">
      Detalles de Mora
    </h4>
    <div className="grid grid-cols-2 gap-3 text-center">
      <div className="p-3 bg-white border rounded-lg shadow-sm">
        <span className="font-bold text-yellow-700 block">Monto Mora</span>
        <span className="text-gray-900 font-semibold">
          Q
          {Number(item.mora?.monto_mora || 0).toLocaleString("es-GT", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </span>
      </div>
      <div className="p-3 bg-white border rounded-lg shadow-sm">
        <span className="font-bold text-yellow-700 block">% Mora</span>
        <span className="text-gray-900 font-semibold">
          {item.mora?.porcentaje_mora}%
        </span>
      </div>
      <div className="p-3 bg-white border rounded-lg shadow-sm col-span-2">
        <span className="font-bold text-yellow-700 block">
          Cuotas atrasadas
        </span>
        <span className="text-gray-900 font-semibold">
          {item.mora?.cuotas_atrasadas}
        </span>
      </div>
    </div>
  </div>
)}

{/* ====== Incobrable ====== */}
{item.incobrable && (
  <div className="bg-purple-50 rounded-2xl p-4">
    <h4 className="text-lg font-extrabold text-purple-800 mb-3 text-center">
      Información de Incobrable
    </h4>
    <div className="grid grid-cols-2 gap-3 text-center">
      <div className="p-3 bg-white border rounded-lg shadow-sm">
        <span className="font-bold text-purple-700 block">Motivo</span>
        <span className="text-gray-900 font-semibold">
          {item.incobrable.motivo}
        </span>
      </div>
      <div className="p-3 bg-white border rounded-lg shadow-sm">
        <span className="font-bold text-purple-700 block">Monto</span>
        <span className="text-gray-900 font-semibold">
          Q
          {Number(item.incobrable.monto_incobrable).toLocaleString("es-GT", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </span>
      </div>
      <div className="p-3 bg-white border rounded-lg shadow-sm col-span-2">
        <span className="font-bold text-purple-700 block">Fecha Registro</span>
        <span className="text-gray-900 font-semibold">
          {new Date(item.incobrable.fecha_registro).toLocaleDateString("es-ES", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })}
        </span>
      </div>
      <div className="col-span-2">
        <span className="font-bold text-purple-700">Observaciones:</span>
        <details className="cursor-pointer mt-1">
          <summary className="text-purple-700 font-semibold select-none">
            Ver observaciones
          </summary>
          <p className="mt-2 text-sm text-gray-900 leading-relaxed whitespace-pre-line">
            {item.incobrable.observaciones || "--"}
          </p>
        </details>
      </div>
    </div>
  </div>
)}

{/* ====== Cancelación ====== */}
{item.cancelacion && (
  <div className="bg-red-50 rounded-2xl p-4">
    <h4 className="text-lg font-extrabold text-red-800 mb-3 text-center">
      Información de Cancelación
    </h4>
    <div className="grid grid-cols-2 gap-3 text-center">
      <div className="p-3 bg-white border rounded-lg shadow-sm">
        <span className="font-bold text-red-700 block">Motivo</span>
        <span className="text-gray-900 font-semibold">
          {item.cancelacion.motivo}
        </span>
      </div>
      <div className="p-3 bg-white border rounded-lg shadow-sm">
        <span className="font-bold text-red-700 block">Monto</span>
        <span className="text-gray-900 font-semibold">
          Q
          {Number(item.cancelacion.monto_cancelacion).toLocaleString("es-GT", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </span>
      </div>
      <div className="p-3 bg-white border rounded-lg shadow-sm col-span-2">
        <span className="font-bold text-red-700 block">Fecha</span>
        <span className="text-gray-900 font-semibold">
          {new Date(item.cancelacion.fecha_cancelacion).toLocaleDateString(
            "es-ES",
            {
              day: "2-digit",
              month: "short",
              year: "numeric",
            }
          )}
        </span>
      </div>
      <div className="col-span-2">
        <span className="font-bold text-red-700">Observaciones:</span>
        <details className="cursor-pointer mt-1">
          <summary className="text-red-700 font-semibold select-none">
            Ver observaciones
          </summary>
          <p className="mt-2 text-sm text-gray-900 leading-relaxed whitespace-pre-line">
            {item.cancelacion.observaciones || "--"}
          </p>
        </details>
      </div>
    </div>
  </div>
)}


          {/* Usuario */}
             <div className="bg-blue-50 rounded-2xl p-4">
            <h4 className="text-xl font-extrabold text-blue-800 mb-3 text-center">
              Información del usuario
            </h4>
            <div className="grid grid-cols-2 gap-4 text-center">
              <div>
                <span className="font-bold text-blue-700">Nombre:</span>
                <p className="text-gray-900">{item.usuarios.nombre}</p>
              </div>
              <div>
                <span className="font-bold text-blue-700">NIT:</span>
                <p className="text-gray-900">{item.usuarios.nit}</p>
              </div>
              <div>
                <span className="font-bold text-blue-700">Categoría:</span>
                <p className="text-gray-900">{item.usuarios.categoria}</p>
              </div>
              <div>
                <span className="font-bold text-blue-700">Saldo a favor:</span>
                <p className="text-gray-900">
                  Q
                  {Number(item.usuarios.saldo_a_favor).toLocaleString("es-GT", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
              </div>
            </div>
          </div>

          {/* Inversionistas */}
           <div className="bg-blue-50 rounded-2xl p-4">
            <h4 className="text-xl font-extrabold text-blue-800 mb-3 text-center">
              Inversionistas asociados
            </h4>
            <div className="space-y-4">
              {item.inversionistas.map((inv: any, idx: number) => (
            <div
                  key={idx}
                  className="border border-blue-200 bg-white rounded-xl p-4 shadow-sm"
                >
                  <h5 className="font-bold text-blue-700 mb-2 text-center">
                    {inv.nombre}
                  </h5>
                  <div className="grid grid-cols-2 gap-3 text-sm text-center">    
                    {[
                      ["Emite Factura", inv.emite_factura ? "Sí" : "No"],
                      ["Monto Aportado", inv.monto_aportado],
                      ["Monto Cash In", inv.monto_cash_in],
                      ["Monto Inversión", inv.monto_inversionista],
                      ["IVA Cash In", inv.iva_cash_in],
                      ["IVA Inversión", inv.iva_inversionista],
                      [
                        "% Inversión",
                        inv.porcentaje_participacion_inversionista,
                      ],
                      ["% Cash In", inv.porcentaje_cash_in],
                      ["Cuota", inv.cuota_inversionista],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="p-2 rounded-md bg-gray-50 shadow-sm"
                      >
                        <span className="font-bold text-blue-700 block">
                          {label}
                        </span>
                        <span className="text-gray-900 font-semibold">
                          {typeof value === "number"
                            ? `Q${Number(value).toLocaleString("es-GT", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}`
                            : value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  ))}
</div>

      ) : (
      <div>
  <Table className="w-full min-w-[1200px] border-separate border-spacing-y-1">
    <TableHeader>
      <TableRow className="bg-blue-50 border-b-2 border-blue-200 rounded-t-xl">
        <TableHead className="text-gray-900 font-bold text-center">
          Crédito SIFCO
        </TableHead>
        <TableHead className="text-gray-900 font-bold text-center">
          Usuario
        </TableHead>
        <TableHead className="text-gray-900 font-bold text-center">
          Deuda Total
        </TableHead>
        <TableHead className="text-gray-900 font-bold text-center">
          Cuota
        </TableHead>
        <TableHead className="text-gray-900 font-bold text-center">
          Fecha de Creación
        </TableHead>
        <TableHead className="text-gray-900 font-bold text-center">
          Acciones
        </TableHead>
      </TableRow>
    </TableHeader>

    <TableBody>
      {data.data.map((item: any, idx: any) => (
        <React.Fragment key={item.creditos.credito_id}>
          {/* Row principal */}
          <TableRow
            className={`hover:bg-blue-50 cursor-pointer transition duration-200 rounded-lg ${
              expandedRow === idx ? "ring-2 ring-blue-300" : ""
            }`}
            onClick={() => setExpandedRow(expandedRow === idx ? null : idx)}
          >
            <TableCell className="text-blue-700 font-semibold text-center underline hover:text-blue-900 transition">
              {item.creditos.numero_credito_sifco}
            </TableCell>
            <TableCell className="text-indigo-700 font-bold text-center">
              {item.usuarios.nombre}
            </TableCell>
            <TableCell className="text-green-600 font-bold text-center">
              Q
              {Number(item.creditos.deudatotal).toLocaleString("es-GT", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </TableCell>
            <TableCell className="text-indigo-700 font-bold text-center">
              Q
              {Number(item.creditos.cuota).toLocaleString("es-GT", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </TableCell>
            <TableCell className="text-indigo-700 font-bold text-center">
              {item.creditos?.fecha_creacion
                ? new Date(item.creditos.fecha_creacion).toLocaleDateString(
                    "es-ES",
                    {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    }
                  )
                : "--"}
            </TableCell>

            {/* Acciones */}
            <TableCell className="text-center">
              <div className="flex flex-col items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-gray-700 border-gray-300"
                  onClick={() =>
                    setExpandedRow(expandedRow === idx ? null : idx)
                  }
                >
                  {expandedRow === idx ? "Ocultar acciones" : "Ver acciones"}
                </Button>

                {expandedRow === idx && (
                  <div className="flex flex-wrap justify-center gap-2 p-2 border rounded-md bg-gray-50 shadow-sm w-full md:w-auto">
                    {canViewPayments(item.creditos.statusCredit) && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex items-center gap-1 text-blue-700 border-blue-300 hover:bg-blue-50"
                        onClick={() =>
                          navigate(
                            `/pagos/${item.creditos.numero_credito_sifco}`
                          )
                        }
                      >
                        <Eye className="w-4 h-4" />
                        Ver pagos
                      </Button>
                    )}

                    {canEdit(item.creditos.statusCredit) &&
                      user?.role === "ADMIN" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex items-center gap-1 text-yellow-700 border-yellow-300 hover:bg-yellow-50"
                          onClick={() =>
                            handleOpenEdit(item.creditos, item.inversionistas)
                          }
                        >
                          <Pencil className="w-4 h-4" />
                          Editar
                        </Button>
                      )}

                    {canCancel(item.creditos.statusCredit) &&
                      user?.role === "ADMIN" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex items-center gap-1 text-red-700 border-red-300 hover:bg-red-50"
                          onClick={() =>
                            handleOpenModal(item.creditos.credito_id)
                          }
                        >
                          <XCircle className="w-4 h-4" />
                          Cancelar
                        </Button>
                      )}

                    {canEdit(item.creditos.statusCredit) &&
                      user?.role === "ADMIN" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex items-center gap-1 text-purple-700 border-purple-300 hover:bg-purple-50"
                          onClick={() => {
                            setSelectedCreditMora(item.creditos);
                            setOpenMoraModal(true);
                          }}
                        >
                          ➕ Mora
                        </Button>
                      )}

                    {canActivate(item.creditos.statusCredit) &&
                      user?.role === "ADMIN" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex items-center gap-1 text-green-700 border-green-300 hover:bg-green-50"
                          onClick={() =>
                            activateCreditMutation.mutate({
                              creditId: item.creditos.credito_id,
                              accion: "ACTIVAR",
                            })
                          }
                        >
                          <RefreshCw className="w-4 h-4" />
                          Activar
                        </Button>
                      )}

                    {(canEdit(item.creditos.statusCredit) ||
                      canCancel(item.creditos.statusCredit) ||
                      canActivate(item.creditos.statusCredit)) &&
                      user?.role !== "ADMIN" && (
                        <span className="text-gray-400 italic">
                          Sin permisos
                        </span>
                      )}
                  </div>
                )}
              </div>
            </TableCell>
          </TableRow>

          {/* Row expandida */}
          {expandedRow === idx && (
            <TableRow>
              <TableCell colSpan={6} className="p-0 bg-blue-50 rounded-b-2xl">
                <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6 text-gray-900">
                  {/* ====== Detalles del crédito ====== */}
                  <div className="col-span-full">
                    <h4 className="text-xl font-bold text-blue-800 border-b pb-2 mb-4">
                      Detalles del crédito
                    </h4>
                  </div>

                  {[
                    ["Capital", item.creditos.capital],
                    ["Porcentaje Interés", `${item.creditos.porcentaje_interes}%`],
                    ["Deuda Total", item.creditos.deudatotal],
                    ["Cuota", item.creditos.cuota],
                       ["Cuota Interés", item.creditos.cuota_interes],
                    ["IVA 12%", item.creditos.iva_12],
                    ["Seguro", item.creditos.seguro_10_cuotas],
                    ["GPS", item.creditos.gps],
                    ["Membresías", item.creditos.membresias],
                    ["Royalti", item.creditos.royalti],
                    ["Plazo", item.creditos.plazo],
                    ["Tipo", item.creditos.tipoCredito],
                    ["Formato", item.creditos.formato_credito],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="p-3 rounded-lg bg-white border shadow-sm hover:shadow-md transition"
                    >
                      <span className="font-bold text-blue-700">{label}:</span>
                      <p className="text-gray-800">
                        {typeof value === "number"
                          ? `Q${Number(value).toLocaleString("es-GT", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}`
                          : value}
                      </p>
                    </div>
                  ))}

                  {/* Observaciones */}
                  <div className="col-span-full">
                    <span className="font-bold text-blue-700">
                      Observaciones:
                    </span>
                    <div className="text-sm text-gray-800 p-2 border rounded-md bg-gray-50 break-words">
                      <details className="cursor-pointer">
                        <summary className="text-blue-600 font-semibold select-none">
                          {item.creditos.observaciones
                            ? "Ver observaciones"
                            : "No hay observaciones"}
                        </summary>
                        {item.creditos.observaciones && (
                          <p className="mt-2 whitespace-pre-line leading-relaxed">
                            {item.creditos.observaciones}
                          </p>
                        )}
                      </details>
                    </div>
                  </div>

                  {/* Mora */}
                  {item?.mora?.activa && (
                    <div className="col-span-full">
                      <h5 className="text-lg font-bold text-red-700 border-b pb-1 mb-2">
                        Detalles de Mora
                      </h5>
                      <p>
                        <span className="font-bold">Monto:</span> Q
                        {Number(item.mora.monto_mora).toLocaleString("es-GT", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                      <p>
                        <span className="font-bold">Porcentaje:</span>{" "}
                        {item.mora.porcentaje_mora}%
                      </p>
                      <p>
                        <span className="font-bold">Cuotas atrasadas:</span>{" "}
                        {item.mora.cuotas_atrasadas}
                      </p>
                     
                    </div>
                  )}

                  {/* Rubros */}
                  <div className="col-span-full">
                    <h5 className="text-lg font-bold text-blue-700 border-b pb-1 mb-2">
                      Otros Rubros
                    </h5>
                    <details className="cursor-pointer">
                      <summary>
                        Q
                        {Number(item.creditos.otros).toLocaleString("es-GT", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </summary>
                      <ul className="ml-4 mt-1 list-disc text-gray-700">
                        {item.rubros?.map((r: any, idx: number) => (
                          <li key={idx}>
                            {r.nombre_rubro} - Q
                            {Number(r.monto).toLocaleString("es-GT")}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </div>

                  {/* Incobrable */}
                  {item.incobrable && (
                    <div className="col-span-full mt-6">
                      <h4 className="text-xl font-bold text-blue-800 border-b pb-2 mb-4">
                        Información de Incobrable
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="p-3 rounded-lg bg-white border shadow-sm">
                          <span className="font-bold text-blue-700">Motivo:</span>
                          <p className="text-gray-800">
                            {item.incobrable.motivo}
                          </p>
                        </div>
                        <div className="p-3 rounded-lg bg-white border shadow-sm">
                          <span className="font-bold text-blue-700">
                            Fecha Registro:
                          </span>
                          <p className="text-gray-800">
                            {new Date(
                              item.incobrable.fecha_registro
                            ).toLocaleDateString("es-ES", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })}
                          </p>
                        </div>
                        <div className="p-3 rounded-lg bg-white border shadow-sm">
                          <span className="font-bold text-blue-700">
                            Monto Incobrable:
                          </span>
                          <p className="text-gray-800">
                            Q
                            {Number(item.incobrable.monto_incobrable).toLocaleString(
                              "es-GT",
                              {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              }
                            )}
                          </p>
                        </div>
                        <div className="p-3 rounded-lg bg-white border shadow-sm col-span-full">
                          <span className="font-bold text-blue-700">
                            Observaciones:
                          </span>
                          <div className="max-h-24 overflow-y-auto text-sm text-gray-800 p-2 border rounded-md bg-gray-50 break-words">
                            {item.incobrable.observaciones || "--"}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Cancelación */}
                  {item.cancelacion && (
                    <div className="col-span-full mt-6">
                      <h4 className="text-xl font-bold text-blue-800 border-b pb-2 mb-4">
                        Información de Cancelación
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="p-3 rounded-lg bg-white border shadow-sm">
                          <span className="font-bold text-blue-700">Motivo:</span>
                          <p className="text-gray-800">
                            {item.cancelacion.motivo}
                          </p>
                        </div>
                        <div className="p-3 rounded-lg bg-white border shadow-sm">
                          <span className="font-bold text-blue-700">Fecha:</span>
                          <p className="text-gray-800">
                            {new Date(
                              item.cancelacion.fecha_cancelacion
                            ).toLocaleDateString("es-ES", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })}
                          </p>
                        </div>
                        <div className="p-3 rounded-lg bg-white border shadow-sm">
                          <span className="font-bold text-blue-700">
                            Monto Cancelación:
                          </span>
                          <p className="text-gray-800">
                            Q
                            {Number(item.cancelacion.monto_cancelacion).toLocaleString(
                              "es-GT",
                              {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              }
                            )}
                          </p>
                        </div>
                        <div className="p-3 rounded-lg bg-white border shadow-sm col-span-full">
                          <span className="font-bold text-blue-700">
                            Observaciones:
                          </span>
                          <div className="max-h-24 overflow-y-auto text-sm text-gray-800 p-2 border rounded-md bg-gray-50 break-words">
                            {item.cancelacion.observaciones || "--"}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Usuario */}
                  <div className="col-span-full mt-6">
                    <h4 className="text-xl font-bold text-blue-800 border-b pb-2 mb-4">
                      Información del usuario
                    </h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <span className="font-bold text-blue-700">Nombre:</span>
                        <p>{item.usuarios.nombre}</p>
                      </div>
                      <div>
                        <span className="font-bold text-blue-700">NIT:</span>
                        <p>{item.usuarios.nit}</p>
                      </div>
                      <div>
                        <span className="font-bold text-blue-700">Categoría:</span>
                        <p>{item.usuarios.categoria}</p>
                      </div>
                      <div>
                        <span className="font-bold text-blue-700">
                          Saldo a favor:
                        </span>
                        <p>
                          Q
                          {Number(item.usuarios.saldo_a_favor).toLocaleString(
                            "es-GT",
                            {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            }
                          )}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Inversionistas */}
                  <div className="col-span-full mt-6">
                    <h4 className="text-xl font-bold text-blue-800 border-b pb-2 mb-4">
                      Inversionistas asociados
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {item.inversionistas.map((inv: any, idx: number) => (
                        <div
                          key={idx}
                          className="border border-blue-200 bg-gradient-to-br from-white to-blue-50 rounded-xl p-5 shadow-sm hover:shadow-md transition"
                        >
                          <div className="flex items-center justify-between mb-4">
                            <h5 className="text-lg font-bold text-blue-700">
                              {inv.nombre}
                            </h5>
                            <span
                              className={`px-2 py-1 text-xs font-semibold rounded-full ${
                                inv.emite_factura
                                  ? "bg-green-100 text-green-700 border border-green-200"
                                  : "bg-gray-100 text-gray-600 border border-gray-200"
                              }`}
                            >
                              {inv.emite_factura ? "Emite Factura" : "Sin Factura"}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-3 text-sm">
                            <div>
                              <span className="font-bold text-blue-700 block">
                                Monto Aportado
                              </span>
                              <span className="text-gray-900 font-semibold">
                                Q
                                {Number(inv.monto_aportado).toLocaleString("es-GT", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </span>
                            </div>
                            <div>
                              <span className="font-bold text-blue-700 block">
                                Monto Cash In
                              </span>
                              <span className="text-gray-900 font-semibold">
                                Q
                                {Number(inv.monto_cash_in).toLocaleString("es-GT", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </span>
                            </div>
                            <div>
                              <span className="font-bold text-blue-700 block">
                                Monto Inversión
                              </span>
                              <span className="text-gray-900 font-semibold">
                                Q
                                {Number(inv.monto_inversionista).toLocaleString(
                                  "es-GT",
                                  {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  }
                                )}
                              </span>
                            </div>
                            <div>
                              <span className="font-bold text-blue-700 block">
                                IVA Cash In
                              </span>
                              <span className="text-gray-900 font-semibold">
                                Q
                                {Number(inv.iva_cash_in).toLocaleString("es-GT", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </span>
                            </div>
                            <div>
                              <span className="font-bold text-blue-700 block">
                                IVA Inversión
                              </span>
                              <span className="text-gray-900 font-semibold">
                                Q
                                {Number(inv.iva_inversionista).toLocaleString(
                                  "es-GT",
                                  {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  }
                                )}
                              </span>
                            </div>
                            <div>
                              <span className="font-bold text-blue-700 block">
                                % Inversión
                              </span>
                              <span className="text-gray-900 font-semibold">
                                {inv.porcentaje_participacion_inversionista}%
                              </span>
                            </div>
                            <div>
                              <span className="font-bold text-blue-700 block">
                                % Cash In
                              </span>
                              <span className="text-gray-900 font-semibold">
                                {inv.porcentaje_cash_in}%
                              </span>
                            </div>
                            <div>
                              <span className="font-bold text-blue-700 block">
                                Cuota
                              </span>
                              <span className="text-gray-900 font-semibold">
                                Q
                                {Number(inv.cuota_inversionista).toLocaleString(
                                  "es-GT",
                                  {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  }
                                )}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
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

      {/* Paginación */}
      <div className="flex justify-between items-center mt-6 px-1">
        <button
          className="px-5 py-2 rounded-xl bg-gray-100 text-gray-700 font-bold disabled:opacity-50 transition"
          onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
          disabled={page <= 1 || isFetching}
        >
          Anterior
        </button>
        <span className="text-gray-800 font-bold text-lg">
          Página {data.page} de {data.totalPages}
        </span>
        <button
          className="px-5 py-2 rounded-xl bg-gray-100 text-gray-700 font-bold disabled:opacity-50 transition"
          onClick={() =>
            setPage((prev) => Math.min(prev + 1, data.totalPages ?? 1))
          }
          disabled={page >= (data.totalPages ?? 1) || isFetching}
        >
          Siguiente
        </button>
      </div>
      {isFetching && (
        <div className="text-blue-500 mt-2">Cargando página...</div>
      )}
      <ModalEditCredit
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        initialValues={creditToEdit}
        investorsInitial={investorsToEdit}
        onSuccess={() => {
          setEditModalOpen(false);
          queryClient.invalidateQueries({
            queryKey: ["creditos-paginados", mes, anio, page, perPage],
          });
        }}
        investorsOptions={investors}
      />
      <ModalCancelCredit
        open={modalOpen}
        onClose={handleCloseModal}
        creditId={selectedCreditId ?? 0}
        onSuccess={() => {
          queryClient.invalidateQueries({
            queryKey: ["creditos-paginados", mes, anio, page, perPage],
          });
        }}
      />
      <ModalCreateMora
        open={openMoraModal}
        onClose={() => setOpenMoraModal(false)}
        creditoId={selectedCreditMora?.credito_id}
        numeroCreditoSifco={selectedCreditMora?.numero_credito_sifco}
        onSuccess={() => {
          queryClient.invalidateQueries({
            queryKey: ["creditos-paginados", mes, anio, page, perPage],
          });
        }}
      />
    </div>
  );
}
