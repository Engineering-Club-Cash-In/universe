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
import { BadgeCheck, AlertTriangle, FileText, ChevronDown, ChevronUp, Calendar, Eye } from "lucide-react";
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import type { RubroPendiente } from "../services/services";
import { sumaQ } from "@/lib/moneda";

export function MiniCardCredito({
  credito,
  usuario,
  cuotaActual,
  cuotaActualPagada,
  cuotaActualStatus,
  cuotasAtrasadasInfo,
  cuotasEnValidacionInfo,
  cuotaSeleccionada,
  onCuotaSeleccionadaChange,
  cuotasPendientesInfo,
  mora,
  rubros,
  rubrosActual,
  convenioActivoInfo,
  cuotaMensualAPagar,
  abonosParciales,
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
  // Cuotas vencidas ya cubiertas por boletas pendientes de validar por
  // contabilidad: no son atraso, pero el asesor debe saberlo.
  cuotasEnValidacionInfo?: {
    total: number;
    cuotas: { numero_cuota: number }[];
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
  // Rubros pendientes (tarjeta de circulación, placas, traspaso...). Ausentes
  // en la enorme mayoría de créditos: el desglose solo aparece si hay algo que
  // desglosar.
  rubros?: RubroPendiente[];
  rubrosActual?: number;
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
  abonosParciales?: {
    abono_capital: number;
    abono_interes: number;
    abono_iva_12: number;
    abono_seguro: number;
    abono_gps: number;
    abono_membresias: number;
    total: number;
  } | null;
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

  // Cuotas atrasadas LÓGICAS: el back preserva una fila por pago (parciales,
  // duplicadas), así que contador, detalle y truncado deben deduplicar por
  // numero_cuota CON LA MISMA lista — si cada uno cuenta lo suyo, la tarjeta
  // puede decir "1" y abajo listar "#1" repetido o "...y N más" con filas
  // fantasma (además de duplicar keys de React). Una cuota queda "pendiente
  // de revisión" si ALGUNA de sus filas está pending.
  const cuotasAtrasadasUnicas = [
    ...(cuotasAtrasadasInfo?.cuotas ?? [])
      .reduce((porNumero, c) => {
        const previa = porNumero.get(c.numero_cuota);
        porNumero.set(c.numero_cuota, {
          numero_cuota: c.numero_cuota,
          tienePending:
            (previa?.tienePending ?? false) || c.validationStatus === "pending",
        });
        return porNumero;
      }, new Map<number, { numero_cuota: number; tienePending: boolean }>())
      .values(),
  ].sort((a, b) => a.numero_cuota - b.numero_cuota);

  const cuotasFiltradas = [
    // Las atrasadas ya vienen filtradas por COBERTURA desde el back: son
    // pagables aunque su fila sea un pago validated parcial (ocultarlas por
    // status hacía imposible cobrar el faltante de la cuota).
    ...(cuotasAtrasadasInfo?.cuotas ?? []),
    // En pendientes sí se ocultan las validadas/cerradas; los `pending`
    // siguen seleccionables para abonos complementarios.
    ...(cuotasPendientesInfo?.cuotas ?? []).filter(
      (c) =>
        c.validationStatus !== "validated" &&
        c.validationStatus !== "capital_validated",
    ),
  ]
    // Limitado a la cuota pagable más antigua para no saltar deuda anterior.
    .sort((a, b) => a.numero_cuota - b.numero_cuota)
    .slice(0, 1);

  // La mora llega del back como STRING cuando existe y como number 0 cuando no
  // (defecto conocido del endpoint). Sin este `Number()` sumarla concatenaría
  // texto en vez de sumar plata.
  // `mora` viene del endpoint como STRING cuando hay mora y como number 0
  // cuando no. La prop está declarada `number`, así que TypeScript no avisa,
  // y `String.prototype.toLocaleString` IGNORA las opciones: una mora de
  // Q12,345.67 se mostraba "12345.67", sin separador de miles. Todo lo que
  // muestre o sume mora usa `moraNum`, nunca `mora` crudo.
  const moraNum = Number(mora || 0);
  const rubrosNum = Number(rubrosActual ?? 0);
  const cuotaNum = Number(cuotaMensualAPagar || credito.cuota) || 0;
  const convenioNum = Number(convenioActivoInfo?.cuotaConvenioAPagar ?? 0) || 0;
  const abonosNum = abonosParciales?.total ?? 0;

  // El motor de pagos cobra en cascada: otros → mora → RUBROS → convenio →
  // cuotas. El asesor tiene que ver UNA sola cifra y que esa cifra contemple
  // todo lo que la boleta se va a llevar; si no, cobra de menos. `sumaQ` suma
  // en centavos enteros para no descuadrar contra el `Big` del backend.
  const totalACobrar = Math.max(
    0,
    sumaQ([moraNum, rubrosNum, convenioNum, cuotaNum, -abonosNum]),
  );
  // Sin mora, sin rubros y sin convenio no hay nada que combinar: la tarjeta
  // amarilla sigue siendo la de "Abonos Realizados" de siempre (el 99% de la
  // cartera se ve exactamente igual que antes de este cambio).
  const mostrarTotalCombinado =
    !!convenioActivoInfo || moraNum > 0 || rubrosNum > 0;

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
            <Link
              to={`/pagos/${credito.numero_credito_sifco}`}
              title="Ver historial de pagos"
              className="group inline-flex items-center gap-1.5 text-blue-700 text-xl font-bold tracking-wider hover:text-blue-900 hover:underline underline-offset-2 transition-colors w-fit"
            >
              {credito.numero_credito_sifco}
              <Eye className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
            </Link>
          </div>

          {/* Usuario */}
          <div className="flex flex-col bg-white rounded-lg p-4 shadow-sm border border-blue-100">
            <span className="font-bold text-blue-700 text-sm mb-1">
              Usuario
            </span>
            <Link
              to={`/pagos/${credito.numero_credito_sifco}`}
              title="Ver historial de pagos"
              className="group inline-flex items-center gap-1.5 text-blue-700 font-semibold text-base hover:text-blue-900 hover:underline underline-offset-2 transition-colors w-fit"
            >
              {usuario.nombre}
              <Eye className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
            </Link>
          </div>

          {/* Deuda Total */}
          <div className="flex flex-col bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-4 shadow-sm border border-green-200">
            <span className="font-bold text-green-700 text-sm mb-1">
            Capital
            </span>
            <span className="text-green-700 font-bold text-xl">
              Q{Number(credito.capital).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
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
              {mora > 0&& (
                <span className="px-2 py-0.5 bg-red-500 text-white text-[10px] font-extrabold rounded-full shadow-md animate-pulse">
                  🚨 MORA
                </span>
              )}
            </div>

            <div className="flex items-baseline gap-2">
              <span
                className={
                  "text-2xl font-bold " +
                  (cuotasAtrasadasUnicas.length > 0
                    ? "text-red-600"
                    : "text-gray-600")
                }
              >
                {/* Cuotas únicas: hay una fila por pago y los parciales inflarían el número */}
                {cuotasAtrasadasUnicas.length}
              </span>
              {mora > 0 && (
                <span className="text-xs font-semibold text-red-500">
                  mora(Q
                  {moraNum.toLocaleString("es-GT", { minimumFractionDigits: 2 })})
                </span>
              )}
            </div>

            {(cuotasEnValidacionInfo?.total ?? 0) > 0 && (
              <div className="mt-1 px-2 py-1 bg-amber-50 border border-amber-300 rounded text-[11px] font-semibold text-amber-700">
                ⏳ {cuotasEnValidacionInfo!.total}{" "}
                {cuotasEnValidacionInfo!.total === 1
                  ? "cuota pagada pendiente"
                  : "cuotas pagadas pendientes"}{" "}
                de validación por contabilidad (
                {[...new Set(cuotasEnValidacionInfo!.cuotas.map((c) => c.numero_cuota))]
                  .sort((a, b) => a - b)
                  .map((n) => `#${n}`)
                  .join(", ")}
                )
              </div>
            )}

            {mora > 0 && cuotasAtrasadasUnicas.length === 0 && (
              <div className="mt-1 px-2 py-1 bg-red-50 border border-red-300 rounded text-[11px] font-semibold text-red-700">
                ⚠️ Tiene mora activa de Q
                {moraNum.toLocaleString("es-GT", { minimumFractionDigits: 2 })} sin
                cuotas atrasadas visibles
                {(cuotasEnValidacionInfo?.total ?? 0) > 0
                  ? " — se generó mientras sus boletas esperan validación de contabilidad; normalmente se libera al validarlas. Si persiste, revisar con contabilidad."
                  : " — revisar con contabilidad antes de cobrarla."}
              </div>
            )}

            {cuotasAtrasadasUnicas.length > 0 && (
              <div className="mt-2 pt-2 border-t border-gray-200">
                <span className="font-semibold text-xs text-red-600 block mb-1">
                  Pendientes:
                </span>
                <div className="flex flex-col gap-0.5">
                  {cuotasAtrasadasUnicas.slice(0, 3).map((cuota) => (
                    <span
                      key={cuota.numero_cuota}
                      className="text-xs text-red-500 pl-2"
                    >
                      • Cuota #{cuota.numero_cuota}
                      {cuota.tienePending && (
                        <span className="ml-1 text-orange-500">
                          (Pendiente de revisión)
                        </span>
                      )}
                    </span>
                  ))}
                  {cuotasAtrasadasUnicas.length > 3 && (
                    <span className="text-xs text-gray-500 pl-2 italic">
                      ...y {cuotasAtrasadasUnicas.length - 3} más
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Rubros pendientes (tarjeta de circulación, placas, traspaso...).
              El motor de pagos los cobra ANTES que la cuota, así que el
              asesor tiene que verlos desglosados: un total combinado sin
              explicar de qué está hecho oculta que parte de la boleta se va
              a un cobro que no es la cuota. Si no hay rubros, esta tarjeta
              no se renderiza y nada cambia (el 99% de la cartera). */}
          {rubros && rubros.length > 0 && (
            <div className="flex flex-col bg-white rounded-lg p-4 shadow-sm border border-blue-100 lg:col-span-2">
              <div className="flex items-center gap-2 mb-2">
                <span className="font-bold text-blue-700 text-sm">
                  Rubros ({rubros.length})
                </span>
                <span className="px-2 py-0.5 bg-amber-500 text-white text-[10px] font-extrabold rounded-full shadow-md">
                  💳 COBRO ADICIONAL
                </span>
              </div>

              <div className="flex flex-col gap-2 mb-2">
                {rubros.map((r) => {
                  // `disponible` es lo que ESTA boleta puede cobrar (el saldo
                  // menos lo que otras boletas ya apartaron esperando
                  // contabilidad); puede ser 0 aunque el saldo siga vivo.
                  const disponibleNum = Number(r.disponible || 0);
                  const yaApartado = disponibleNum === 0;
                  return (
                    <div
                      key={r.rubro_id}
                      className="flex flex-col border-b border-gray-100 pb-2 last:border-0 last:pb-0"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-gray-800 font-semibold">
                          · {r.tipo_nombre}
                          {r.obligatorio && (
                            <span className="ml-1.5 px-1.5 py-0.5 bg-red-100 text-red-700 text-[9px] font-bold rounded align-middle">
                              OBLIGATORIO
                            </span>
                          )}
                        </span>
                        <span
                          className={
                            "text-xs font-bold " +
                            (yaApartado ? "text-gray-400" : "text-amber-700")
                          }
                        >
                          Q
                          {disponibleNum.toLocaleString("es-GT", {
                            minimumFractionDigits: 2,
                          })}
                        </span>
                      </div>
                      {r.descripcion && (
                        <span className="text-[11px] text-gray-500 pl-3">
                          {r.descripcion}
                        </span>
                      )}
                      {yaApartado && (
                        <div className="mt-1 px-2 py-1 bg-amber-50 border border-amber-300 rounded text-[11px] font-semibold text-amber-700 self-start">
                          ⏳ Ya apartado por otra boleta (esperando validación
                          de contabilidad)
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Subtotal de rubros, NO el total a cobrar. Esta tarjeta antes
                  cerraba con un "Total a cobrar" = cuota + rubros que ignoraba
                  mora y convenio, así que en un crédito con rubros Y convenio
                  el asesor veía dos cifras distintas presentadas como "el
                  total" y podía cobrar de menos. El único total vive ahora en
                  la tarjeta amarilla de abajo, que sí contempla la cascada
                  completa; acá queda solo el desglose. */}
              <div className="mt-1 pt-2 border-t border-blue-100 flex items-center justify-between text-xs text-gray-600">
                <span>Suma de rubros ({rubros.length}):</span>
                <span className="font-semibold text-amber-700">
                  Q
                  {(rubrosActual ?? 0).toLocaleString("es-GT", {
                    minimumFractionDigits: 2,
                  })}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-gray-500 italic">
                Incluido en el total a cobrar de abajo.
              </div>
            </div>
          )}

          {/* Total a Pagar */}
          <div className="flex flex-col bg-gradient-to-br from-yellow-50 to-amber-50 rounded-lg p-4 shadow-sm border border-yellow-200">
            <span className="font-bold text-yellow-700 text-sm mb-1">
              {mostrarTotalCombinado ? "💰 Total a Cobrar" : "Abonos Realizados"}
            </span>

            {mostrarTotalCombinado ? (
              <>
                {/* Desglose en el ORDEN de la cascada del backend (mora →
                    rubros → convenio → cuota). Nunca se muestra el total sin
                    decir de qué está hecho. */}
                <div className="flex flex-col gap-2">
                  {moraNum > 0 && (
                    <div className="flex items-center justify-between pb-2 border-b border-yellow-200">
                      <span className="text-xs text-gray-600">Mora:</span>
                      <span className="text-sm font-bold text-red-600">
                        Q{moraNum.toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  )}

                  {/* Los rubros ya apartados por otra boleta valen Q0.00 en
                      `disponible` y por eso no inflan este renglón. */}
                  {rubrosNum > 0 && (
                    <div className="flex items-center justify-between pb-2 border-b border-yellow-200">
                      <span className="text-xs text-gray-600">
                        Rubros{rubros && rubros.length > 0 ? ` (${rubros.length})` : ""}:
                      </span>
                      <span className="text-sm font-bold text-amber-700">
                        Q{rubrosNum.toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  )}

                  {/* Cuota Convenio */}
                  {convenioActivoInfo && (
                    <div className="flex items-center justify-between pb-2 border-b border-yellow-200">
                      <span className="text-xs text-gray-600">Convenio:</span>
                      <span className="text-sm font-bold text-purple-700">
                        Q{convenioNum.toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  )}

                  {/* Cuota Normal */}
                  <div className="flex items-center justify-between pb-2 border-b border-yellow-200">
                    <span className="text-xs text-gray-600">Normal:</span>
                    <span className="text-sm font-bold text-indigo-700">
                      Q{cuotaNum.toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                    </span>
                  </div>

                  {/* Abonos realizados */}
                  {abonosNum > 0 && (
                    <div className="flex items-center justify-between pb-2 border-b border-yellow-200">
                      <span className="text-xs text-gray-600">Abonos realizados:</span>
                      <span className="text-sm font-bold text-green-600">
                        -Q{abonosNum.toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  )}

                  {/* Total: la ÚNICA cifra de la pantalla presentada como total */}
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-sm font-bold text-gray-700">TOTAL:</span>
                    <span className="text-2xl font-black text-blue-700">
                      Q{totalACobrar.toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <>
                <span className="text-green-700 font-bold text-xl">
                  Q{(abonosParciales?.total ?? 0).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                </span>

                {(() => {
                  const cuotaMensual = Number(cuotaMensualAPagar || credito.cuota);
                  const abonosTotal = abonosParciales?.total ?? 0;
                  const montoRestante = Math.max(0, cuotaMensual - abonosTotal);

                  if (abonosTotal > 0) {
                    return (
                      <div className="mt-2 pt-2 border-t border-yellow-300">
                        <span className="text-xs text-gray-600 block mb-0.5">
                          Restante de cuota:
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
          {cuotasFiltradas.length > 0 && (
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