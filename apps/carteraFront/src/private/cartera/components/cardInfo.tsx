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
}: {
  credito: any;
  usuario: any;
  cuotaActual: number;
  cuotaActualPagada?: boolean;
  cuotasAtrasadasInfo?: { cuotas: { numero_cuota: number }[] };
  cuotaSeleccionada?: number;
  onCuotaSeleccionadaChange?: (cuota: number) => void;
  cuotasPendientesInfo?: { cuotas: { numero_cuota: number }[] };
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
      console.log("Filtrando cuota:", cuota, "con índice:", idx);
      // Si no hay búsqueda, muestra solo las primeras 10
      return idx < 1;
      // Si hay búsqueda, muestra solo coincidencias exactas
    }) ?? [];

  return (
    <div className="w-full flex justify-center">
      <Card className="bg-blue-50 border border-blue-200 rounded-2xl shadow-xl px-6 py-5 w-full max-w-[800px] relative mb-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-16 gap-y-6 w-full">

          {/* Número de crédito */}
          <div className="flex flex-col">
            <span className="font-bold text-blue-700 text-lg">Crédito SIFCO</span>
          <span className="text-gray-900 text-xl font-semibold tracking-wider">
            {credito.numero_credito_sifco}
          </span>
        </div>

        {/* Usuario */}
        <div className="flex flex-col">
          <span className="font-bold text-blue-700 text-lg">Usuario</span>
          <span className="text-gray-800">{usuario.nombre}</span>
        </div>

        {/* Deuda Total */}
        <div className="flex flex-col">
          <span className="font-bold text-blue-700 text-lg">Deuda Total</span>
          <span className="text-green-700 font-bold text-xl">
            Q{Number(credito.deudatotal).toLocaleString()}
          </span>
        </div>

        {/* Cuota mensual */}
        <div className="flex flex-col">
          <span className="font-bold text-blue-700 text-lg">Cuota Mensual</span>
          <span className="text-indigo-700 font-bold text-xl">
            Q{Number(credito.cuota).toLocaleString()}
          </span>
        </div>

        {/* Cuota actual y estado + Selector */}
        <div className="flex flex-col">
          <span className="font-bold text-blue-700 text-lg">Cuota Actual</span>
          <div className="flex items-center gap-2">
            <span className="text-gray-900 text-lg font-medium">
              #{cuotaActual}
            </span>
            {cuotaActualPagada ? (
              <span className="flex items-center text-green-700 font-bold">
                <BadgeCheck className="w-5 h-5 mr-1" /> Pagada
              </span>
            ) : (
              <span className="flex items-center text-orange-600 font-bold">
                <AlertTriangle className="w-5 h-5 mr-1" /> Pendiente
              </span>
            )}
          </div>
              <div className="flex flex-col">
          {/* Selector de cuotas atrasadas con Select */}
          {cuotasPendientesInfo &&
            cuotasPendientesInfo.cuotas &&
            cuotasPendientesInfo.cuotas.length > 0 && (
              <div className="mt-2 flex flex-col items-center">
                <span className="font-bold text-blue-700 text-lg">
                  Elige la cuota a pagar:
                </span>
                <Select
                  value={String(localCuotaSeleccionada)}
                  onValueChange={handleChange}
                >
                  <SelectTrigger className="w-[180px] h-11 bg-white border-blue-200 rounded-lg flex items-center">
                    <span
                      className={
                        localCuotaSeleccionada
                          ? "text-blue-700 font-bold text-xl"
                          : "text-gray-500"
                      }
                    >
                      {localCuotaSeleccionada ?? "Selecciona cuota"}
                    </span>
                  </SelectTrigger>
                  <SelectContent className="z-[9999] bg-white">
                    {cuotasFiltradas.length > 0 ? (
                      cuotasFiltradas.map((cuota) => (
                        <SelectItem
                          key={cuota.numero_cuota}
                          value={String(cuota.numero_cuota)}
                          className="
    text-blue-700 font-semibold text-base
    data-[state=checked]:bg-blue-100
    data-[state=checked]:text-blue-900
    data-[state=checked]:font-bold
  "
                        >
                          {cuota.numero_cuota}
                        </SelectItem>
                      ))
                    ) : (
                      <div className="px-2 py-2 text-gray-500 text-sm">
                        No hay coincidencias
                      </div>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}</div>
        </div>

        {/* Cuotas pendientes */}
        <div className="flex flex-col">
          <span className="font-bold text-blue-700 text-lg">
            Cuotas Atrasadas
          </span>
          <span
            className={
              "text-lg font-bold " +
              ((cuotasAtrasadasInfo?.cuotas.length ?? 0) > 0
                ? "text-red-600 animate-pulse"
                : "text-gray-600")
            }
          >
            {cuotasAtrasadasInfo?.cuotas.length ?? 0}
          </span>

          {/* Mostrar detalles SOLO si hay cuotas atrasadas */}
          {(cuotasAtrasadasInfo?.cuotas.length ?? 0) > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              <span className="font-semibold text-sm text-red-500">
                Pendientes:
              </span>
              {/* Mostrar solo las primeras 3 */}
              {cuotasAtrasadasInfo!.cuotas.slice(0, 3).map((cuota, idx) => (
                <span
                  key={cuota.numero_cuota ?? idx}
                  className="text-xs text-red-400 pl-2"
                >
                  Cuota #{cuota.numero_cuota}
                </span>
              ))}
              {/* Si hay más de 3, mostrar leyenda */}
              {cuotasAtrasadasInfo!.cuotas.length > 3 && (
                <span className="text-xs text-gray-400 pl-2">
                  ...y {cuotasAtrasadasInfo!.cuotas.length - 3} más
                </span>
              )}
            </div>
          )}      
            <div className="flex flex-col">
  <span className="font-semibold text-blue-800 text-base">
    Saldo a favor:
  </span>
  <span className="text-green-600 font-bold text-xl">
    Q{Number(usuario.saldo_a_favor ?? 0).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
  </span>
</div>

        </div>
           </div>
      </Card>
    </div>
  );
}
