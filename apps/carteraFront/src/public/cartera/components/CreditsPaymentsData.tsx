/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRef, useState } from "react";
import { X } from "lucide-react";
import { useCreditosPaginadosWithFilters } from "../hooks/credits";
import { Button } from "@/components/ui/button";
import { Eye, Pencil, XCircle } from "lucide-react";

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
import InfoEstadoCredito from "./infoCredit";
export function ListaCreditosPagos() {
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const navigate = useNavigate();
  const {
    data,
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
            {[5, 10, 20, 50].map((n) => (
              <option key={n} value={n}>
                {n} por página
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Tabla, sin scroll horizontal, diseño responsivo */}

      {isMobile ? (
        <div className="space-y-4">
          {data.data.map((item, idx) => (
            <div
              key={item.creditos.credito_id}
              className="border rounded-xl p-4 shadow bg-white"
            >
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-blue-800 font-bold text-lg">
                  #{item.creditos.numero_credito_sifco}
                </h3>
                <Button
                  onClick={() =>
                    setExpandedRow(expandedRow === idx ? null : idx)
                  }
                  className="text-blue-600 text-sm"
                  variant="ghost"
                >
                  {expandedRow === idx ? "Ocultar" : "Ver más"}
                </Button>
              </div>
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
                          : item.creditos.statusCredit ===
                              "PENDIENTE_CANCELACION"
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
              {/* Mostrar el botón solo para créditos con estado INCOBRABLE o CANCELADO */}
              {(item.creditos.statusCredit === "INCOBRABLE" ||
                item.creditos.statusCredit === "CANCELADO" ||
                item.creditos.statusCredit === "PENDIENTE_CANCELACION") && (
                <Button
                  variant="outline"
                  onClick={() => setOpenInfoCancelation(true)}
                >
                  Estado y reportes
                </Button>
              )}

              <InfoEstadoCredito
                cancelacion={item.cancelacion}
                incobrable={item.incobrable}
                numeroSifco={item.creditos.numero_credito_sifco}
                open={openInfoCancelation}
                onOpenChange={setOpenInfoCancelation}
              />

              {/* ✅ Reemplazo completo del bloque con Dropdown por acciones inline (responsive) */}
              <div
                className="flex justify-end mt-2"
                // Evita que los clicks lleguen al TableRow (que expande/colapsa)
                onPointerDownCapture={(e) => e.stopPropagation()}
                onMouseDownCapture={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                {(() => {
                  type CreditStatus =
                    | "ACTIVO"
                    | "PENDIENTE_CANCELACION"
                    | "CANCELADO"
                    | "INCOBRABLE";
                  const status = (item.creditos.statusCredit ||
                    "ACTIVO") as CreditStatus;

                  const onKey = (e: React.KeyboardEvent, fn: () => void) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      fn();
                    }
                  };

                  const canEdit = status === "ACTIVO";
                  const canCancel = status === "ACTIVO";
                  const canActivate = status === "PENDIENTE_CANCELACION";
                  const canViewPayments = true; // siempre

                  return (
                    <nav
                      aria-label="Acciones de crédito"
                      className="inline-flex flex-wrap items-center justify-end gap-2"
                    >
                      {/* Ver pagos (siempre) */}
                      {canViewPayments && (
                        <a
                          role="link"
                          tabIndex={0}
                          title="Ver pagos"
                          onClick={() =>
                            navigate(
                              `/pagos/${item.creditos.numero_credito_sifco}`
                            )
                          }
                          onKeyDown={(e) =>
                            onKey(e, () =>
                              navigate(
                                `/pagos/${item.creditos.numero_credito_sifco}`
                              )
                            )
                          }
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-sm font-semibold text-blue-700 hover:bg-blue-100 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 cursor-pointer"
                        >
                          <Eye className="w-4 h-4 shrink-0" />
                          <span className="hidden sm:inline">Ver pagos</span>
                        </a>
                      )}

                      {/* Editar (solo ACTIVO) */}
                      {canEdit && (
                        <a
                          role="link"
                          tabIndex={0}
                          title="Editar crédito"
                          onClick={() =>
                            handleOpenEdit(item.creditos, item.inversionistas)
                          }
                          onKeyDown={(e) =>
                            onKey(e, () =>
                              handleOpenEdit(item.creditos, item.inversionistas)
                            )
                          }
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-sm font-semibold text-yellow-700 hover:bg-yellow-100 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-300 cursor-pointer"
                        >
                          <Pencil className="w-4 h-4 shrink-0" />
                          <span className="hidden sm:inline">Editar</span>
                        </a>
                      )}

                      {/* Cancelar (solo ACTIVO) */}
                      {canCancel && (
                        <a
                          role="link"
                          tabIndex={0}
                          title="Cancelar crédito"
                          onClick={() =>
                            handleOpenModal(item.creditos.credito_id)
                          }
                          onKeyDown={(e) =>
                            onKey(e, () =>
                              handleOpenModal(item.creditos.credito_id)
                            )
                          }
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-sm font-semibold text-red-700 hover:bg-red-100 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 cursor-pointer"
                        >
                          <XCircle className="w-4 h-4 shrink-0" />
                          <span className="hidden sm:inline">Cancelar</span>
                        </a>
                      )}

                      {/* Activar (solo PENDIENTE_CANCELACION) */}
                      {canActivate && (
                        <a
                          role="link"
                          tabIndex={0}
                          title="Activar crédito"
                          onClick={() =>
                            activateCreditMutation.mutate(
                              {
                                creditId: item.creditos.credito_id,
                                accion: "ACTIVAR",
                              },
                              {
                                onSuccess: (data) => {
                                  alert(
                                    data.message ||
                                      "Crédito activado correctamente"
                                  );
                                  queryClient.invalidateQueries({
                                    queryKey: [
                                      "creditos-paginados",
                                      mes,
                                      anio,
                                      page,
                                      perPage,
                                    ],
                                  });
                                },
                                onError: (error: any) => {
                                  alert(
                                    error.message ||
                                      "No se pudo activar el crédito"
                                  );
                                },
                              }
                            )
                          }
                          onKeyDown={(e) =>
                            onKey(e, () =>
                              activateCreditMutation.mutate({
                                creditId: item.creditos.credito_id,
                                accion: "ACTIVAR",
                              })
                            )
                          }
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-sm font-semibold text-green-700 hover:bg-green-100 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-300 cursor-pointer"
                        >
                          <RefreshCw className="w-4 h-4 shrink-0" />
                          <span className="hidden sm:inline">Activar</span>
                        </a>
                      )}
                    </nav>
                  );
                })()}
              </div>

              {expandedRow === idx && (
                <div className="mt-4">
                  <div className="space-y-4">
                    <div className="bg-blue-50 rounded-2xl p-4">
                      <h4 className="text-xl font-extrabold text-blue-800 mb-2 uppercase tracking-wide drop-shadow text-center">
                        Detalles del crédito
                      </h4>
                      <div className="flex flex-wrap justify-center gap-4">
                        {[
                          [
                            "Capital",
                            `Q${Number(item.creditos.capital).toLocaleString(
                              "es-GT",
                              {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              }
                            )}`,
                          ],
                          [
                            "Porcentaje Interés",
                            `${item.creditos.porcentaje_interes}%`,
                          ],
                          [
                            "Deuda Total",
                            `Q${Number(item.creditos.deudatotal).toLocaleString(
                              "es-GT",
                              {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              }
                            )}`,
                          ],
                          [
                            "Cuota",
                            `Q${Number(item.creditos.cuota).toLocaleString(
                              "es-GT",
                              {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              }
                            )}`,
                          ],
                          [
                            "Cuota Interés",
                            `Q${Number(
                              item.creditos.cuota_interes
                            ).toLocaleString("es-GT", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}`,
                          ],
                          [
                            "IVA 12%",
                            `Q${Number(item.creditos.iva_12).toLocaleString(
                              "es-GT",
                              {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              }
                            )}`,
                          ],
                          [
                            "Seguro 10 Cuotas",
                            `Q${Number(
                              item.creditos.seguro_10_cuotas
                            ).toLocaleString("es-GT", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}`,
                          ],
                          [
                            "GPS",
                            `Q${Number(item.creditos.gps).toLocaleString(
                              "es-GT",
                              {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              }
                            )}`,
                          ],
                          [
                            "Membresías",
                            `Q${Number(item.creditos.membresias).toLocaleString(
                              "es-GT",
                              {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              }
                            )}`,
                          ],
                          [
                            "Membresías Pago",
                            `Q${Number(
                              item.creditos.membresias_pago
                            ).toLocaleString("es-GT", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}`,
                          ],
                          [
                            "Royalti",
                            `Q${Number(item.creditos.royalti).toLocaleString(
                              "es-GT"
                            )}`,
                          ],
                          [
                            "Porcentaje Royalti",
                            `${item.creditos.porcentaje_royalti}%`,
                          ],
                          ["Plazo", item.creditos.plazo],
                          ["Tipo de Crédito", item.creditos.tipoCredito],
                          [
                            "Otros", // Changed key to avoid Element as key
                            <details className="cursor-pointer">
                              <summary>
                                Q
                                {Number(item.creditos.otros).toLocaleString(
                                  "es-GT",
                                  {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  }
                                )}
                              </summary>
                              <ul className="ml-4 mt-1 list-disc text-gray-700">
                                {item.rubros?.map((r, idx) => (
                                  <li key={idx}>
                                    {r.nombre_rubro} - Q
                                    {Number(r.monto).toLocaleString("es-GT")}
                                  </li>
                                ))}
                              </ul>
                            </details>,
                          ],

                          ["Formato Crédito", item.creditos.formato_credito],
                          [
                            "Observaciones",
                            item.creditos.observaciones || "--",
                          ],
                          [
                            "Mora",
                            `Q${Number(item.creditos.mora).toLocaleString(
                              "es-GT",
                              {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              }
                            )}`,
                          ],
                        ].map(([label, value]) => (
                          <div
                            
                            className="flex flex-col items-center mb-1"
                          >
                            <span className="font-bold text-blue-700 text-base leading-tight">
                              {label}:
                            </span>{" "}
                            <span className="font-semibold text-gray-900 text-sm break-words whitespace-normal text-left max-w-xs">
                              {value}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="bg-blue-50 rounded-2xl p-4">
                      <h4 className="text-xl font-extrabold text-blue-800 mb-2 uppercase tracking-wide text-center">
                        Información del usuario
                      </h4>
                      <div className="flex flex-wrap justify-center gap-8">
                        <div className="flex flex-col items-center">
                          <span className="font-bold text-blue-700">
                            Nombre:
                          </span>
                          <span className="font-semibold text-gray-900">
                            {item.usuarios.nombre}
                          </span>
                        </div>
                        <div className="flex flex-col items-center">
                          <span className="font-bold text-blue-700">NIT:</span>
                          <span className="font-semibold text-gray-900">
                            {item.usuarios.nit}
                          </span>
                        </div>
                        <div className="flex flex-col items-center">
                          <span className="font-bold text-blue-700">
                            Categoría:
                          </span>
                          <span className="font-semibold text-gray-900">
                            {item.usuarios.categoria}
                          </span>
                        </div>
                        <div className="flex flex-col items-center">
                          <span className="font-bold text-blue-700">
                            Saldo a favor:
                          </span>
                          <span className="font-semibold text-gray-900">
                            Q
                            {Number(item.usuarios.saldo_a_favor).toLocaleString(
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
                    <div className="bg-blue-50 rounded-2xl p-4">
                      <h4 className="text-xl font-extrabold text-blue-800 mb-2 uppercase tracking-wide text-center">
                        Resumen general
                      </h4>
                      <div className="flex flex-wrap justify-center gap-8">
                        {[
                          [
                            "Total Cash In Monto",
                            `Q${Number(
                              item.resumen.total_cash_in_monto
                            ).toLocaleString("es-GT", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}`,
                          ],
                          [
                            "Total Cash In IVA",
                            `Q${Number(
                              item.resumen.total_cash_in_iva
                            ).toLocaleString("es-GT", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}`,
                          ],
                          [
                            "Total Monto del inversionista",
                            `Q${Number(
                              item.resumen.total_inversionistas_monto
                            ).toLocaleString("es-GT", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}`,
                          ],
                          [
                            "Total Inversión IVA",
                            `Q${Number(
                              item.resumen.total_inversionistas_iva
                            ).toLocaleString("es-GT", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}`,
                          ],
                        ].map(([label, value]) => (
                          <div
                            key={label}
                            className="flex flex-col items-center mb-1"
                          >
                            <span className="font-bold text-blue-700">
                              {label}:
                            </span>
                            <span className="font-semibold text-gray-900">
                              {value}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="bg-blue-50 rounded-2xl p-4">
                      <h4 className="text-xl font-extrabold text-blue-800 mb-3 uppercase tracking-wide text-center">
                        Inversionistas asociados
                      </h4>
                      <div className="grid grid-cols-1 gap-5">
                        {item.inversionistas.map((inv: any, idx: number) => (
                          <div
                            key={idx}
                            className="border border-blue-200 bg-white rounded-2xl shadow-md p-5 text-base text-gray-800 hover:shadow-xl transition"
                          >
                            <div className="font-bold text-blue-700 mb-2 text-lg">
                              {inv.nombre}
                            </div>
                            {[
                              [
                                "Emite Factura",
                                inv.emite_factura ? "Sí" : "No",
                              ],
                              [
                                "Monto Aportado",
                                `Q${Number(inv.monto_aportado).toLocaleString(
                                  "es-GT",
                                  {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  }
                                )}`,
                              ],
                              [
                                "Monto Cash In",
                                `Q${Number(inv.monto_cash_in).toLocaleString(
                                  "es-GT",
                                  {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  }
                                )}`,
                              ],
                              [
                                "Monto Inversionista",
                                `Q${Number(
                                  inv.monto_inversionista
                                ).toLocaleString("es-GT", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}`,
                              ],
                              [
                                "IVA Cash In",
                                `Q${Number(inv.iva_cash_in).toLocaleString(
                                  "es-GT",
                                  {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  }
                                )}`,
                              ],
                              [
                                "IVA Inversionista",
                                `Q${Number(
                                  inv.iva_inversionista
                                ).toLocaleString("es-GT", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}`,
                              ],
                              [
                                "Porcentaje Inversionista",
                                `%${inv.porcentaje_participacion_inversionista}`,
                              ],
                              ["cuota ", `Q${inv.cuota_inversionista}`],
                              [
                                "Porcentaje Cash In",
                                `%${inv.porcentaje_cash_in}`,
                              ],
                            ].map(([label, value]) => (
                              <div
                                key={label}
                                className="flex flex-col items-start mb-1"
                              >
                                <span className="font-bold text-blue-700">
                                  {label}:
                                </span>
                                <span className="font-semibold text-gray-900">
                                  {value}
                                </span>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
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
                    onClick={() =>
                      setExpandedRow(expandedRow === idx ? null : idx)
                    }
                    style={{ transition: "box-shadow 0.2s" }}
                  >
                    <TableCell className="text-blue-700 font-semibold text-center underline hover:text-blue-900 transition">
                      {item.creditos.numero_credito_sifco}
                    </TableCell>
                    <TableCell className="text-indigo-700 font-bold text-center">
                      {item.usuarios.nombre}
                    </TableCell>
                    <TableCell className="text-green-600 font-bold text-center">
                      Q
                      {Number(item.creditos.deudatotal).toLocaleString(
                        "es-GT",
                        {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        }
                      )}
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
                        ? new Date(
                            item.creditos.fecha_creacion
                          ).toLocaleDateString("es-ES", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })
                        : "--"}
                    </TableCell>

                    <TableCell
                      data-action-cell
                      className="text-center"
                      onPointerDownCapture={(e) => e.stopPropagation()}
                      onMouseDownCapture={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {(() => {
                        const status = (item.creditos.statusCredit ||
                          "ACTIVO") as CreditStatus;

                        return (
                          <nav
                            aria-label="Acciones de crédito"
                            className="inline-flex flex-wrap items-center justify-center gap-2"
                          >
                            {/* Ver pagos (siempre permitido) */}
                            {canViewPayments(status) && (
                              <a
                                role="link"
                                tabIndex={0}
                                title="Ver pagos"
                                onClick={() =>
                                  navigate(
                                    `/pagos/${item.creditos.numero_credito_sifco}`
                                  )
                                }
                                onKeyDown={(e) =>
                                  (e.key === "Enter" || e.key === " ") &&
                                  navigate(
                                    `/pagos/${item.creditos.numero_credito_sifco}`
                                  )
                                }
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-sm font-semibold text-blue-700 hover:bg-blue-100 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 cursor-pointer"
                              >
                                <Eye className="w-4 h-4" />
                                <span className="hidden sm:inline">
                                  Ver pagos
                                </span>
                              </a>
                            )}

                            {/* Editar (solo ACTIVO) */}
                            {canEdit(status) && (
                              <a
                                role="link"
                                tabIndex={0}
                                title="Editar crédito"
                                onClick={() =>
                                  handleOpenEdit(
                                    item.creditos,
                                    item.inversionistas
                                  )
                                }
                                onKeyDown={(e) =>
                                  (e.key === "Enter" || e.key === " ") &&
                                  handleOpenEdit(
                                    item.creditos,
                                    item.inversionistas
                                  )
                                }
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-sm font-semibold text-yellow-700 hover:bg-yellow-100 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-300 cursor-pointer"
                              >
                                <Pencil className="w-4 h-4" />
                                <span className="hidden sm:inline">Editar</span>
                              </a>
                            )}

                            {/* Cancelar (solo ACTIVO) */}
                            {canCancel(status) && (
                              <a
                                role="link"
                                tabIndex={0}
                                title="Cancelar crédito"
                                onClick={() =>
                                  handleOpenModal(item.creditos.credito_id)
                                }
                                onKeyDown={(e) =>
                                  (e.key === "Enter" || e.key === " ") &&
                                  handleOpenModal(item.creditos.credito_id)
                                }
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-sm font-semibold text-red-700 hover:bg-red-100 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 cursor-pointer"
                              >
                                <XCircle className="w-4 h-4" />
                                <span className="hidden sm:inline">
                                  Cancelar
                                </span>
                              </a>
                            )}

                            {/* Activar (solo PENDIENTE_CANCELACION) */}
                            {canActivate(status) && (
                              <a
                                role="link"
                                tabIndex={0}
                                title="Activar crédito"
                                onClick={() =>
                                  activateCreditMutation.mutate(
                                    {
                                      creditId: item.creditos.credito_id,
                                      accion: "ACTIVAR",
                                    },
                                    {
                                      onSuccess: (data) => {
                                        alert(
                                          data.message ||
                                            "Crédito activado correctamente"
                                        );
                                        queryClient.invalidateQueries({
                                          queryKey: [
                                            "creditos-paginados",
                                            mes,
                                            anio,
                                            page,
                                            perPage,
                                          ],
                                        });
                                      },
                                      onError: (error: any) => {
                                        alert(
                                          error.message ||
                                            "No se pudo activar el crédito"
                                        );
                                      },
                                    }
                                  )
                                }
                                onKeyDown={(e) =>
                                  (e.key === "Enter" || e.key === " ") &&
                                  activateCreditMutation.mutate({
                                    creditId: item.creditos.credito_id,
                                    accion: "ACTIVAR",
                                  })
                                }
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-sm font-semibold text-green-700 hover:bg-green-100 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-300 cursor-pointer"
                              >
                                <RefreshCw className="w-4 h-4" />
                                <span className="hidden sm:inline">
                                  Activar
                                </span>
                              </a>
                            )}
                          </nav>
                        );
                      })()}
                    </TableCell>
                  </TableRow>
                  {/* Row expandida */}
                  {expandedRow === idx && (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="p-0 bg-blue-50 rounded-b-2xl"
                      >
                        {/* DETALLES DEL CRÉDITO */}
                        <div className="p-8 pb-4 grid grid-cols-1 md:grid-cols-3 gap-x-16 gap-y-4 text-base text-gray-900 bg-blue-50 rounded-b-2xl place-items-center">
                          <div className="col-span-full mb-2 text-center">
                            <h4 className="text-2xl font-extrabold text-blue-800 mb-2 uppercase tracking-wide drop-shadow">
                              Detalles del crédito
                            </h4>
                          </div>
                          <div className="col-span-full flex justify-center mb-3">
                            {item.creditos.statusCredit === "ACTIVO" && (
                              <span className="inline-flex items-center px-4 py-1 rounded-full bg-green-100 text-green-800 font-bold text-base shadow border border-green-200 uppercase tracking-wide">
                                <span className="mr-2 animate-pulse text-green-500 text-lg">
                                  ●
                                </span>
                                Crédito Activo
                              </span>
                            )}
                            {item.creditos.statusCredit === "CANCELADO" && (
                              <span className="inline-flex items-center px-4 py-1 rounded-full bg-red-100 text-red-800 font-bold text-base shadow border border-red-200 uppercase tracking-wide">
                                <span className="mr-2 animate-pulse text-red-500 text-lg">
                                  ●
                                </span>
                                Crédito Cancelado
                              </span>
                            )}
                            {item.creditos.statusCredit === "INCOBRABLE" && (
                              <span className="inline-flex items-center px-4 py-1 rounded-full bg-yellow-100 text-yellow-800 font-bold text-base shadow border border-yellow-200 uppercase tracking-wide">
                                <span className="mr-2 animate-pulse text-yellow-500 text-lg">
                                  ●
                                </span>
                                Crédito Incobrable
                              </span>
                            )}
                            {item.creditos.statusCredit ===
                              "PENDIENTE_CANCELACION" && (
                              <span className="inline-flex items-center px-4 py-1 rounded-full bg-yellow-100 text-yellow-800 font-bold text-base shadow border border-yellow-200 uppercase tracking-wide">
                                <span className="mr-2 animate-pulse text-yellow-500 text-lg">
                                  ●
                                </span>
                                Pendiente de Cancelación
                              </span>
                            )}
                            {/* Puedes agregar más estados si tienes otros */}
                          </div>
                          {(item.creditos.statusCredit ===
                            "PENDIENTE_CANCELACION" ||
                            item.creditos.statusCredit === "INCOBRABLE" ||
                            item.creditos.statusCredit === "CANCELADO") && (
                            <Button
                              variant="default"
                              className="bg-green-600 hover:bg-green-700 text-white"
                              onClick={() => setOpenInfoCancelation(true)}
                            >
                              Estado y reportes
                            </Button>
                          )}

                          <InfoEstadoCredito
                            cancelacion={item.cancelacion}
                            incobrable={item.incobrable}
                            numeroSifco={item.creditos.numero_credito_sifco}
                            open={openInfoCancelation}
                            onOpenChange={setOpenInfoCancelation}
                          />
                          {[
                            [
                              "Capital",
                              `Q${Number(item.creditos.capital).toLocaleString(
                                "es-GT",
                                {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                }
                              )}`,
                            ],
                            [
                              "Porcentaje Interés",
                              `${item.creditos.porcentaje_interes}%`,
                            ],
                            [
                              "Deuda Total",
                              `Q${Number(
                                item.creditos.deudatotal
                              ).toLocaleString("es-GT", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}`,
                            ],
                            [
                              "Cuota",
                              `Q${Number(item.creditos.cuota).toLocaleString(
                                "es-GT",
                                {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                }
                              )}`,
                            ],
                            [
                              "Cuota Interés",
                              `Q${Number(
                                item.creditos.cuota_interes
                              ).toLocaleString("es-GT", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}`,
                            ],
                            [
                              "IVA 12%",
                              `Q${Number(item.creditos.iva_12).toLocaleString(
                                "es-GT",
                                {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                }
                              )}`,
                            ],
                            [
                              "Seguro 10 Cuotas",
                              `Q${Number(
                                item.creditos.seguro_10_cuotas
                              ).toLocaleString("es-GT", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}`,
                            ],
                            [
                              "GPS",
                              `Q${Number(item.creditos.gps).toLocaleString(
                                "es-GT",
                                {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                }
                              )}`,
                            ],
                            [
                              "Membresías",
                              `Q${Number(
                                item.creditos.membresias
                              ).toLocaleString("es-GT", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}`,
                            ],
                            [
                              "Membresías Pago",
                              `Q${Number(
                                item.creditos.membresias_pago
                              ).toLocaleString("es-GT", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}`,
                            ],
                            [
                              "Royalti",
                              `Q${Number(item.creditos.royalti).toLocaleString(
                                "es-GT"
                              )}`,
                            ],
                            [
                              "Porcentaje Royalti",
                              `${item.creditos.porcentaje_royalti}%`,
                            ],
                            ["Plazo", item.creditos.plazo],
                            ["Tipo de Crédito", item.creditos.tipoCredito],
                            // Use a string key to avoid type error
                            [
                              "Otros-details", // Changed key to avoid Element as key
                              <details className="cursor-pointer">
                                <summary>
                                  Q
                                  {Number(item.creditos.otros).toLocaleString(
                                    "es-GT",
                                    {
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 2,
                                    }
                                  )}
                                </summary>
                                <ul className="ml-4 mt-1 list-disc text-gray-700">
                                  {item.rubros?.map(
                                    (
                                      r: {
                                        nombre_rubro:
                                          | string
                                          | number
                                          | bigint
                                          | boolean
                                          | React.ReactElement<
                                              unknown,
                                              | string
                                              | React.JSXElementConstructor<any>
                                            >
                                          | Iterable<React.ReactNode>
                                          | React.ReactPortal
                                          | Promise<
                                              | string
                                              | number
                                              | bigint
                                              | boolean
                                              | React.ReactPortal
                                              | React.ReactElement<
                                                  unknown,
                                                  | string
                                                  | React.JSXElementConstructor<any>
                                                >
                                              | Iterable<React.ReactNode>
                                              | null
                                              | undefined
                                            >
                                          | null
                                          | undefined;
                                        monto: any;
                                      },
                                      idx: React.Key | null | undefined
                                    ) => (
                                      <li key={idx}>
                                        {r.nombre_rubro} - Q
                                        {Number(r.monto).toLocaleString(
                                          "es-GT"
                                        )}
                                      </li>
                                    )
                                  )}
                                </ul>
                              </details>,
                            ],
                            ["Asesor", item.asesores.nombre],
                            ["Formato Crédito", item.creditos.formato_credito],

                            [
                              "Observaciones",
                              item.creditos.observaciones || "--",
                            ],
                            [
                              "Mora",
                              `Q${Number(item.creditos.mora).toLocaleString(
                                "es-GT",
                                {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                }
                              )}`,
                            ],
                          ].map(([label, value]) => (
                            <div
                              key={label}
                              className="flex flex-col items-center mb-1"
                            >
                              <span className="font-bold text-blue-700 text-base leading-tight">
                                {label}:
                              </span>{" "}
                              <span className="font-semibold text-gray-900 text-sm break-words whitespace-normal text-left max-w-xs">
                                {value}
                              </span>
                            </div>
                          ))}
                        </div>
                        {/* INFORMACIÓN DEL USUARIO */}
                        <div className="px-8 py-3 flex flex-col items-center bg-blue-50 rounded-b-2xl">
                          <h4 className="text-2xl font-extrabold text-blue-800 mb-2 mt-4 uppercase tracking-wide">
                            Información del usuario
                          </h4>
                          <div className="flex flex-wrap justify-center gap-8">
                            <div className="flex flex-col items-center">
                              <span className="font-bold text-blue-700">
                                Nombre:
                              </span>
                              <span className="font-semibold text-gray-900">
                                {item.usuarios.nombre}
                              </span>
                            </div>
                            <div className="flex flex-col items-center">
                              <span className="font-bold text-blue-700">
                                NIT:
                              </span>
                              <span className="font-semibold text-gray-900">
                                {item.usuarios.nit}
                              </span>
                            </div>
                            <div className="flex flex-col items-center">
                              <span className="font-bold text-blue-700">
                                Categoría:
                              </span>
                              <span className="font-semibold text-gray-900">
                                {item.usuarios.categoria}
                              </span>
                            </div>
                            <div className="flex flex-col items-center">
                              <span className="font-bold text-blue-700">
                                Saldo a favor:
                              </span>
                              <span className="font-semibold text-gray-900">
                                Q
                                {Number(
                                  item.usuarios.saldo_a_favor
                                ).toLocaleString("es-GT", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </span>
                            </div>
                          </div>
                        </div>
                        {/* RESUMEN GENERAL */}
                        <div className="px-8 py-4 flex flex-col items-center bg-blue-50 rounded-b-2xl">
                          <h4 className="text-2xl font-extrabold text-blue-800 mb-2 mt-4 uppercase tracking-wide">
                            Resumen general
                          </h4>
                          <div className="flex flex-wrap justify-center gap-8">
                            {[
                              [
                                "Total Cash In Monto",
                                `Q${Number(
                                  item.resumen.total_cash_in_monto
                                ).toLocaleString("es-GT", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}`,
                              ],
                              [
                                "Total Cash In IVA",
                                `Q${Number(
                                  item.resumen.total_cash_in_iva
                                ).toLocaleString("es-GT", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}`,
                              ],
                              [
                                "Total Monto del inversionista",
                                `Q${Number(
                                  item.resumen.total_inversion_monto
                                ).toLocaleString("es-GT", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}`,
                              ],
                              [
                                "Total Inversión IVA",
                                `Q${Number(
                                  item.resumen.total_inversion_iva
                                ).toLocaleString("es-GT", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}`,
                              ],
                            ].map(([label, value]) => (
                              <div
                                key={label}
                                className="flex flex-col items-center mb-1"
                              >
                                <span className="font-bold text-blue-700">
                                  {label}:
                                </span>
                                <span className="font-semibold text-gray-900">
                                  {value}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                        {/* INVERSIONISTAS */}
                        <div className="px-8 pb-8">
                          <h4 className="text-2xl font-extrabold text-blue-800 mb-3 mt-6 uppercase tracking-wide">
                            Inversionistas asociados
                          </h4>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            {item.inversionistas.map(
                              (inv: any, idx: number) => (
                                <div
                                  key={idx}
                                  className="border border-blue-200 bg-white rounded-2xl shadow-md p-5 text-base text-gray-800 hover:shadow-xl transition"
                                >
                                  <div className="font-bold text-blue-700 mb-2 text-lg">
                                    {inv.nombre}
                                  </div>
                                  {[
                                    [
                                      "Emite Factura",
                                      inv.emite_factura ? "Sí" : "No",
                                    ],
                                    [
                                      "Monto Aportado",
                                      `Q${Number(
                                        inv.monto_aportado
                                      ).toLocaleString("es-GT", {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2,
                                      })}`,
                                    ],
                                    [
                                      "Monto Cash In",
                                      `Q${Number(
                                        inv.monto_cash_in
                                      ).toLocaleString("es-GT", {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2,
                                      })}`,
                                    ],
                                    [
                                      "Monto Inversionista",
                                      `Q${Number(
                                        inv.monto_inversionista
                                      ).toLocaleString("es-GT", {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2,
                                      })}`,
                                    ],
                                    [
                                      "IVA Cash In",
                                      `Q${Number(
                                        inv.iva_cash_in
                                      ).toLocaleString("es-GT", {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2,
                                      })}`,
                                    ],
                                    [
                                      "IVA Inversionista",
                                      `Q${Number(
                                        inv.iva_inversionista
                                      ).toLocaleString("es-GT", {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2,
                                      })}`,
                                    ],
                                    [
                                      "Porcentaje Inversionista",
                                      `%${inv.porcentaje_participacion_inversionista}`,
                                    ],
                                    [
                                      "Porcentaje Cash In",
                                      `%${inv.porcentaje_cash_in}`,
                                    ],
                                    ["cuota  ", `Q${inv.cuota_inversionista}`],
                                  ].map(([label, value]) => (
                                    <div
                                      key={label}
                                      className="flex flex-col items-start mb-1"
                                    >
                                      <span className="font-bold text-blue-700">
                                        {label}:
                                      </span>{" "}
                                      <span className="font-semibold text-gray-900">
                                        {value}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )
                            )}
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
    </div>
  );
}
