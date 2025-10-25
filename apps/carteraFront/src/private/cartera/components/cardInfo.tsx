/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/rules-of-hooks */
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { BadgeCheck, AlertTriangle } from "lucide-react";
import { useState, useEffect } from "react";

export function MiniCardCredito({
  credito,
  usuario,
  cuotaActual,
  cuotaActualPagada,
  cuotasAtrasadasInfo,
  cuotaSeleccionada,
  onCuotaSeleccionadaChange,
  cuotasPendientesInfo,
  mora,
}: {
  credito: any;
  usuario: any;
  cuotaActual: number;
  cuotaActualPagada?: boolean;
  cuotasAtrasadasInfo?: { cuotas: { numero_cuota: number }[] };
  cuotaSeleccionada?: number;
  onCuotaSeleccionadaChange?: (cuota: number) => void;
  cuotasPendientesInfo?: { cuotas: { numero_cuota: number }[] };
  mora: number;
}) {
  if (!credito || !usuario) return null;

  const [localCuotaSeleccionada, setLocalCuotaSeleccionada] = useState<
    number | undefined
  >(undefined);

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
    cuotasPendientesInfo?.cuotas?.filter((cuota, idx) => { 
      return idx < 1;
    }) ?? [];

  return (
    <div className="w-full flex justify-center">
      <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-300 rounded-2xl shadow-2xl px-6 py-6 w-full max-w-[900px] relative mb-8">
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
              Q{Number(credito.deudatotal).toLocaleString()}
            </span>
          </div>

          {/* Cuota mensual */}
          <div className="flex flex-col bg-gradient-to-br from-indigo-50 to-purple-50 rounded-lg p-4 shadow-sm border border-indigo-200">
            <span className="font-bold text-indigo-700 text-sm mb-1">
              Cuota Mensual
            </span>
            <span className="text-indigo-700 font-bold text-xl">
              Q{Number(credito.cuota).toLocaleString()}
            </span>
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
                <span className="flex items-center text-orange-600 font-bold text-sm">
                  <AlertTriangle className="w-4 h-4 mr-1" /> Pendiente
                </span>
              )}
            </div>
          </div>

          {/* Cuotas Atrasadas con MORA */}
          <div className="flex flex-col bg-white rounded-lg p-4 shadow-sm border border-blue-100 relative">
            {/* Header con badge de MORA */}
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

            {/* Cantidad con monto de mora */}
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
                  mora(Q{mora.toLocaleString("es-GT", { minimumFractionDigits: 2 })})
                </span>
              )}
            </div>

            {/* Detalles de cuotas pendientes */}
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

          {/* Saldo a favor */}
          <div className="flex flex-col bg-gradient-to-br from-yellow-50 to-amber-50 rounded-lg p-4 shadow-sm border border-yellow-200">
            <span className="font-bold text-yellow-700 text-sm mb-1">
              Saldo a Favor
            </span>
            <span className="text-green-700 font-bold text-xl">
              Q{Number(usuario.saldo_a_favor ?? 0).toLocaleString("es-GT", { 
                minimumFractionDigits: 2 
              })}
            </span>
          </div>

          {/* Selector de cuotas - Ocupa 2 columnas en pantallas grandes */}
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