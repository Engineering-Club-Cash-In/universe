/* eslint-disable @typescript-eslint/no-unused-expressions */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/rules-of-hooks */
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { BadgeCheck, AlertTriangle, FileText, ChevronDown, ChevronUp, Calendar } from "lucide-react";
import { useState, useEffect } from "react";

export function MiniCardCredito({
  credito,
  usuario,
  cuotaActual,
  cuotaActualPagada,
  cuotaActualStatus,
  cuotasAtrasadasInfo,
  cuotaSeleccionada,
  onCuotaSeleccionadaChange,
  cuotasPendientesInfo,
  mora,
  convenioActivoInfo,
  cuotaMensualAPagar,
}: {
  credito: any;
  usuario: any;
  cuotaActual: number;
  cuotaActualPagada?: boolean;
  cuotaActualStatus?:
    | "no_required"
    | "pending"
    | "validated"
    | "capital"
    | "reset";
  cuotasAtrasadasInfo?: {
    cuotas: {
      numero_cuota: number;
      validationStatus:
        | "no_required"
        | "pending"
        | "validated"
        | "capital"
        | "reset";
    }[];
  };
  cuotaSeleccionada?: number;
  onCuotaSeleccionadaChange?: (cuota: number) => void;
  cuotasPendientesInfo?: {
    cuotas: {
      numero_cuota: number;
      validationStatus:
        | "no_required"
        | "pending"
        | "validated"
        | "capital"
        | "reset";
    }[];
  };
  mora: number;
 convenioActivoInfo?: {
  convenio_id: number;
  credito_id: number;
  monto_total_convenio: string;
  numero_meses?: number; // 👈 Opcional
  cuota_mensual: string;
  fecha_convenio?: string; // 👈 Opcional
  monto_pagado?: string; // 👈 Opcional
  monto_pendiente?: string; // 👈 Opcional
  pagos_realizados: number;
  pagos_pendientes: number;
  activo: boolean;
  completado: boolean;
  motivo?: string | null; // 👈 Opcional
  observaciones?: string | null; // 👈 Opcional
  created_by?: number; // 👈 Opcional
  created_at?: string; // 👈 Opcional
  updated_at?: string; // 👈 Opcional
  cuotasEnConvenio: any[];
  cuotasConvenioMensuales: {
    cuota_convenio_id: number;
    numero_cuota: number;
    fecha_vencimiento: string;
    fecha_pago: string | null;
  }[];
  cuotaConvenioAPagar: string;
  pagosConvenio?: any[]; // 👈 Opcional
} | null;
  cuotaMensualAPagar?: string;
}) {
  if (!credito || !usuario) return null;

  const [localCuotaSeleccionada, setLocalCuotaSeleccionada] = useState<number | undefined>(undefined);
  const [convenioExpanded, setConvenioExpanded] = useState(true);

  useEffect(() => {
    if (cuotaSeleccionada !== undefined) {
      setLocalCuotaSeleccionada(cuotaSeleccionada);
    }
  }, [cuotaSeleccionada]);

  const handleChange = (value: string) => {
    const num = Number(value);
    setLocalCuotaSeleccionada(num);
    if (onCuotaSeleccionadaChange) onCuotaSeleccionadaChange(num);
  };

  const cuotasFiltradas =
    cuotasPendientesInfo?.cuotas?.filter((cuota, idx) => idx < 1) ?? [];

  return (
    <div className="w-full flex flex-col items-center gap-4">
      {/* Card de Convenio Activo - Colapsable */}
      {convenioActivoInfo && (
        <Card className="bg-gradient-to-br from-purple-50 to-indigo-50 border-2 border-purple-300 rounded-2xl shadow-2xl px-6 py-6 w-full max-w-[900px] relative">
          {/* Header Clickeable */}
          <div 
            className="cursor-pointer hover:bg-purple-50/50 transition-all rounded-lg p-2 -m-2 mb-4"
            onClick={() => setConvenioExpanded(!convenioExpanded)}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FileText className="w-6 h-6 text-purple-700" />
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-xl font-bold text-purple-900">
                      📋 Convenio de Pago
                    </h3>
                    <span className="bg-green-500 text-white px-2 py-0.5 rounded-full font-bold text-xs">
                      Activo
                    </span>
                  </div>
                  <p className="text-purple-600 text-xs mt-1">
                    {convenioExpanded ? 'Click para ocultar detalles' : 'Click para ver detalles'}
                  </p>
                </div>
              </div>
              
              {/* Preview cuando está colapsado */}
              <div className="flex items-center gap-4">
                {!convenioExpanded && (
                  <div className="flex items-center gap-4">
                    <div className="text-right bg-white rounded-lg px-3 py-2 border border-purple-200">
                      <p className="text-[10px] text-purple-600 font-semibold">Progreso</p>
                      <p className="font-bold text-purple-900">
                        {convenioActivoInfo.pagos_realizados}/{convenioActivoInfo.numero_meses}
                      </p>
                    </div>
                    <div className="text-right bg-white rounded-lg px-3 py-2 border border-orange-200">
                      <p className="text-[10px] text-orange-600 font-semibold">Pendiente</p>
                      <p className="font-bold text-orange-700">
                        Q{Number(convenioActivoInfo.monto_pendiente).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                  </div>
                )}
                
                <button className="bg-purple-200 hover:bg-purple-300 p-2 rounded-lg transition-all">
                  {convenioExpanded ? (
                    <ChevronUp className="w-5 h-5 text-purple-700" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-purple-700" />
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Contenido expandible */}
          <div 
            className={`overflow-hidden transition-all duration-300 ${
              convenioExpanded ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
            }`}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
              {/* Monto Total */}
              <div className="bg-white rounded-lg p-4 shadow-sm border border-purple-100">
                <span className="text-sm font-bold text-purple-700 block mb-1">
                  Monto Total
                </span>
                <span className="text-xl font-bold text-purple-900">
                  Q{Number(convenioActivoInfo.monto_total_convenio).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                </span>
              </div>

              {/* Cuota Mensual del Convenio */}
              <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-lg p-4 shadow-sm border border-indigo-200">
                <span className="text-sm font-bold text-indigo-700 block mb-1">
                  Cuota Mensual
                </span>
                <span className="text-xl font-bold text-indigo-700">
                  Q{Number(convenioActivoInfo.cuota_mensual).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                </span>
              </div>

              {/* Cuota a Pagar */}
              <div className="bg-gradient-to-br from-yellow-50 to-amber-50 rounded-lg p-4 shadow-sm border-2 border-yellow-300">
                <span className="text-sm font-bold text-yellow-700 block mb-1">
                  💰 A Pagar Este Mes
                </span>
                <span className="text-2xl font-black text-yellow-800">
                  Q{Number(convenioActivoInfo.cuotaConvenioAPagar).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                </span>
                {Number(convenioActivoInfo.cuotaConvenioAPagar) === 0 && (
                  <span className="text-xs text-green-600 block mt-1">✅ Ya pagaste</span>
                )}
              </div>

              {/* Progreso */}
              <div className="bg-white rounded-lg p-4 shadow-sm border border-purple-100">
                <span className="text-sm font-bold text-purple-700 block mb-1">
                  Progreso
                </span>
                <span className="text-xl font-bold text-purple-900 block mb-2">
                  {convenioActivoInfo.pagos_realizados} / {convenioActivoInfo.numero_meses}
                </span>
                {/* Barra de progreso */}
                <div className="bg-gray-200 rounded-full h-2 overflow-hidden">
                  <div 
                    className="bg-gradient-to-r from-purple-500 to-indigo-500 h-full rounded-full transition-all duration-500"
                    style={{ width: `${(convenioActivoInfo.pagos_realizados / (convenioActivoInfo.numero_meses || 1)) * 100}%` }}
                  />
                </div>
              </div>

              {/* Monto Pagado */}
              <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-4 shadow-sm border border-green-200">
                <span className="text-sm font-bold text-green-700 block mb-1">
                  Monto Pagado
                </span>
                <span className="text-xl font-bold text-green-700">
                  Q{Number(convenioActivoInfo.monto_pagado).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                </span>
              </div>

              {/* Monto Pendiente */}
              <div className="bg-gradient-to-br from-orange-50 to-red-50 rounded-lg p-4 shadow-sm border border-orange-200">
                <span className="text-sm font-bold text-orange-700 block mb-1">
                  Monto Pendiente
                </span>
                <span className="text-xl font-bold text-orange-700">
                  Q{Number(convenioActivoInfo.monto_pendiente).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            {/* 🔥 NUEVO: Calendario de Cuotas del Convenio */}
            {convenioActivoInfo.cuotasConvenioMensuales && convenioActivoInfo.cuotasConvenioMensuales.length > 0 && (
              <div className="mt-6 bg-white rounded-lg p-4 shadow-sm border border-purple-100">
                <div className="flex items-center gap-2 mb-3">
                  <Calendar className="w-5 h-5 text-purple-700" />
                  <span className="text-sm font-bold text-purple-700">
                    Calendario de Cuotas
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {convenioActivoInfo.cuotasConvenioMensuales.map((cuota) => (
                    <div 
                      key={cuota.cuota_convenio_id}
                      className={`p-3 rounded-lg border-2 transition-all ${
                        cuota.fecha_pago 
                          ? 'bg-green-50 border-green-300' 
                          : 'bg-orange-50 border-orange-300'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-gray-700">
                          Cuota #{cuota.numero_cuota}
                        </span>
                        <span className={`text-lg ${cuota.fecha_pago ? '✅' : '⏳'}`}>
                          {cuota.fecha_pago ? '✅' : '⏳'}
                        </span>
                      </div>
                      <span className="text-[10px] text-gray-600 block">
                        Vence: {new Date(cuota.fecha_vencimiento).toLocaleDateString('es-GT')}
                      </span>
                      {cuota.fecha_pago && (
                        <span className="text-[10px] text-green-600 block">
                          Pagada: {new Date(cuota.fecha_pago).toLocaleDateString('es-GT')}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Motivo */}
            {convenioActivoInfo.motivo && (
              <div className="mt-6 bg-white rounded-lg p-4 shadow-sm border border-purple-100">
                <span className="text-sm font-bold text-purple-700 block mb-1">
                  Motivo
                </span>
                <p className="text-gray-700">{convenioActivoInfo.motivo}</p>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Card principal del crédito */}
      <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-300 rounded-2xl shadow-2xl px-6 py-6 w-full max-w-[900px] relative">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
          {/* Número de crédito */}
          <div className="flex flex-col bg-white rounded-lg p-4 shadow-sm border border-blue-100">
            <span className="font-bold text-blue-700 text-sm mb-1">
              Crédito SIFCO
            </span>
            <span className="text-gray-900 text-xl font-bold tracking-wider">
              {credito.numero_credito_sifco}
            </span>
          </div>

          {/* Usuario */}
          <div className="flex flex-col bg-white rounded-lg p-4 shadow-sm border border-blue-100">
            <span className="font-bold text-blue-700 text-sm mb-1">
              Usuario
            </span>
            <span className="text-gray-800 font-semibold text-base">
              {usuario.nombre}
            </span>
          </div>

          {/* Deuda Total */}
          <div className="flex flex-col bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-4 shadow-sm border border-green-200">
            <span className="font-bold text-green-700 text-sm mb-1">
              Deuda Total
            </span>
            <span className="text-green-700 font-bold text-xl">
              Q{Number(credito.deudatotal).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
            </span>
          </div>

          {/* Cuota mensual */}
          <div className="flex flex-col bg-gradient-to-br from-indigo-50 to-purple-50 rounded-lg p-4 shadow-sm border border-indigo-200">
            <span className="font-bold text-indigo-700 text-sm mb-1">
              Cuota Mensual Normal
            </span>
            <span className="text-indigo-700 font-bold text-xl">
              Q{Number(cuotaMensualAPagar || credito.cuota).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
            </span>
            {cuotaActualPagada && (
              <span className="text-xs text-green-600 mt-1">✅ Cuota actual pagada</span>
            )}
          </div>

          {/* Cuota actual y estado */}
          <div className="flex flex-col bg-white rounded-lg p-4 shadow-sm border border-blue-100">
            <span className="font-bold text-blue-700 text-sm mb-2">
              Cuota Actual
            </span>
            <div className="flex items-center gap-2">
              <span className="text-gray-900 text-xl font-bold">
                #{cuotaActual}
              </span>
              {cuotaActualPagada ? (
                <span className="flex items-center text-green-700 font-bold text-sm">
                  <BadgeCheck className="w-4 h-4 mr-1" /> Pagada
                </span>
              ) : (
                <>
                  <span className="flex items-center text-orange-600 font-bold text-sm">
                    <AlertTriangle className="w-4 h-4 mr-1" /> Pendiente
                  </span>
                  {cuotaActualStatus === "pending" && (
                    <span className="ml-2 text-orange-500 font-semibold text-xs">
                      (Pendiente de revisión)
                    </span>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Cuotas Atrasadas con MORA */}
          <div className="flex flex-col bg-white rounded-lg p-4 shadow-sm border border-blue-100 relative">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-bold text-blue-700 text-sm">
                Cuotas Atrasadas
              </span>
              {(cuotasAtrasadasInfo?.cuotas.length ?? 0) > 0 && (
                <span className="px-2 py-0.5 bg-red-500 text-white text-[10px] font-extrabold rounded-full shadow-md animate-pulse">
                  🚨 MORA
                </span>
              )}
            </div>

            <div className="flex items-baseline gap-2">
              <span
                className={
                  "text-2xl font-bold " +
                  ((cuotasAtrasadasInfo?.cuotas.length ?? 0) > 0
                    ? "text-red-600"
                    : "text-gray-600")
                }
              >
                {cuotasAtrasadasInfo?.cuotas.length ?? 0}
              </span>
              {mora > 0 && (
                <span className="text-xs font-semibold text-red-500">
                  mora(Q
                  {mora.toLocaleString("es-GT", { minimumFractionDigits: 2 })})
                </span>
              )}
            </div>

            {(cuotasAtrasadasInfo?.cuotas.length ?? 0) > 0 && (
              <div className="mt-2 pt-2 border-t border-gray-200">
                <span className="font-semibold text-xs text-red-600 block mb-1">
                  Pendientes:
                </span>
                <div className="flex flex-col gap-0.5">
                  {cuotasAtrasadasInfo!.cuotas.slice(0, 3).map((cuota, idx) => (
                    <span
                      key={cuota.numero_cuota ?? idx}
                      className="text-xs text-red-500 pl-2"
                    >
                      • Cuota #{cuota.numero_cuota}
                      {cuota.validationStatus === "pending" && (
                        <span className="ml-1 text-orange-500">
                          (Pendiente de revisión)
                        </span>
                      )}
                    </span>
                  ))}
                  {cuotasAtrasadasInfo!.cuotas.length > 3 && (
                    <span className="text-xs text-gray-500 pl-2 italic">
                      ...y {cuotasAtrasadasInfo!.cuotas.length - 3} más
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Total a Pagar */}
          <div className="flex flex-col bg-gradient-to-br from-yellow-50 to-amber-50 rounded-lg p-4 shadow-sm border border-yellow-200">
            <span className="font-bold text-yellow-700 text-sm mb-1">
              {convenioActivoInfo ? "💰 Total a Pagar" : "Saldo a Favor"}
            </span>
            
            {convenioActivoInfo ? (
              <>
                <div className="flex flex-col gap-2">
                  {/* Cuota Convenio */}
                  <div className="flex items-center justify-between pb-2 border-b border-yellow-200">
                    <span className="text-xs text-gray-600">Convenio:</span>
                    <span className="text-sm font-bold text-purple-700">
                      Q{Number(convenioActivoInfo.cuotaConvenioAPagar).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  
                  {/* Cuota Normal */}
                  <div className="flex items-center justify-between pb-2 border-b border-yellow-200">
                    <span className="text-xs text-gray-600">Normal:</span>
                    <span className="text-sm font-bold text-indigo-700">
                      Q{Number(cuotaMensualAPagar || credito.cuota).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  
                  {/* Saldo a favor */}
                  {Number(usuario.saldo_a_favor ?? 0) > 0 && (
                    <div className="flex items-center justify-between pb-2 border-b border-yellow-200">
                      <span className="text-xs text-gray-600">Saldo a favor:</span>
                      <span className="text-sm font-bold text-green-600">
                        -Q{Number(usuario.saldo_a_favor).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  )}
                  
                  {/* Total */}
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-sm font-bold text-gray-700">TOTAL:</span>
                    <span className="text-2xl font-black text-blue-700">
                      Q{(() => {
                        const cuotaConvenio = Number(convenioActivoInfo.cuotaConvenioAPagar);
                        const cuotaNormal = Number(cuotaMensualAPagar || credito.cuota);
                        const saldoFavor = Number(usuario.saldo_a_favor ?? 0);
                        const total = cuotaConvenio + cuotaNormal - saldoFavor;
                        return total.toLocaleString("es-GT", { minimumFractionDigits: 2 });
                      })()}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <>
                <span className="text-green-700 font-bold text-xl">
                  Q{Number(usuario.saldo_a_favor ?? 0).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                </span>

                {(() => {
                  const cuotaMensual = Number(cuotaMensualAPagar || credito.cuota);
                  const saldoFavor = Number(usuario.saldo_a_favor ?? 0);
                  const montoRestante = Math.max(0, cuotaMensual - saldoFavor);

                  if (saldoFavor > 0) {
                    return (
                      <div className="mt-2 pt-2 border-t border-yellow-300">
                        <span className="text-xs text-gray-600 block mb-0.5">
                          A pagar con saldo:
                        </span>
                        <span className="text-indigo-700 font-bold text-lg">
                          Q{montoRestante.toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    );
                  }
                  return null;
                })()}
              </>
            )}
          </div>

          {/* Selector de cuotas */}
          {cuotasPendientesInfo &&
            cuotasPendientesInfo.cuotas &&
            cuotasPendientesInfo.cuotas.length > 0 && (
              <div className="lg:col-span-2 flex flex-col bg-white rounded-lg p-4 shadow-sm border-2 border-indigo-300">
                <span className="font-bold text-indigo-700 text-sm mb-3 text-center">
                  📋 Elige la cuota a pagar:
                </span>
                <Select
                  value={String(localCuotaSeleccionada)}
                  onValueChange={handleChange}
                >
                  <SelectTrigger className="w-full h-12 bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-indigo-300 rounded-lg flex items-center justify-center hover:border-indigo-400 transition">
                    <span
                      className={
                        localCuotaSeleccionada
                          ? "text-indigo-700 font-bold text-xl"
                          : "text-gray-500 text-base"
                      }
                    >
                      {localCuotaSeleccionada
                        ? `Cuota #${localCuotaSeleccionada}`
                        : "Selecciona una cuota"}
                    </span>
                  </SelectTrigger>
                  <SelectContent className="z-[9999] bg-white">
                    {cuotasFiltradas.length > 0 ? (
                      cuotasFiltradas.map((cuota) => (
                        <SelectItem
                          key={cuota.numero_cuota}
                          value={String(cuota.numero_cuota)}
                          className="text-blue-700 font-semibold text-base data-[state=checked]:bg-blue-100 data-[state=checked]:text-blue-900 data-[state=checked]:font-bold hover:bg-blue-50 cursor-pointer"
                        >
                          Cuota #{cuota.numero_cuota}
                        </SelectItem>
                      ))
                    ) : (
                      <div className="px-3 py-2 text-gray-500 text-sm text-center">
                        No hay cuotas disponibles
                      </div>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}
        </div>
      </Card>
    </div>
  );
}