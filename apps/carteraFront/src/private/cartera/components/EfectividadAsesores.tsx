"use client";
import { useState, useMemo } from "react";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChevronDown, ChevronRight, Search, CalendarDays, TrendingUp } from "lucide-react";
import { useEfectividadAsesores } from "../hooks/useEfectividadAsesores";

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function getDaysInMonth(mes: number, anio: number) {
  return new Date(anio, mes, 0).getDate();
}

export default function EfectividadAsesores() {
  const now = new Date();
  const [mes, setMes] = useState(now.getMonth() + 1);
  const [anio, setAnio] = useState(now.getFullYear());
  const [dia, setDia] = useState<number | "">(now.getDate());
  const [openAsesor, setOpenAsesor] = useState<number | null>(null);

  const diasEnMes = useMemo(() => getDaysInMonth(mes, anio), [mes, anio]);

  const { data, isLoading, error, refetch } = useEfectividadAsesores({
    ...(dia !== "" && { dia }),
    mes,
    anio,
  });

  const getEfectividadColor = (val: string) => {
    const n = Number(val);
    if (n >= 80) return "text-green-700";
    if (n >= 50) return "text-yellow-600";
    return "text-red-700";
  };

  const getEfectividadBg = (val: string) => {
    const n = Number(val);
    if (n >= 80) return "bg-green-100 text-green-800 border-green-300";
    if (n >= 50) return "bg-yellow-100 text-yellow-800 border-yellow-300";
    return "bg-red-100 text-red-800 border-red-300";
  };

  const getBarWidth = (val: string) => `${Math.min(Number(val), 100)}%`;
  const getBarColor = (val: string) => {
    const n = Number(val);
    if (n >= 80) return "bg-green-500";
    if (n >= 50) return "bg-yellow-500";
    return "bg-red-500";
  };

  return (
    <div className="fixed inset-x-0 top-16 xl:top-20 bottom-0 flex flex-col items-center justify-start bg-gradient-to-br from-blue-50 to-white px-4 sm:px-6 lg:px-8 overflow-auto pt-6 pb-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <TrendingUp className="h-7 w-7 text-blue-600" />
        <h2 className="text-2xl font-bold text-blue-700 text-center">
          Efectividad de Asesores
        </h2>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-2xl shadow-lg border border-blue-100 p-4 sm:p-6 mb-6 w-full max-w-3xl">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-blue-700 uppercase tracking-wide">Anio</label>
            <select
              value={anio}
              onChange={(e) => setAnio(Number(e.target.value))}
              className="border-2 border-blue-200 rounded-xl px-3 py-2.5 text-gray-900 font-medium bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all cursor-pointer"
            >
              {[2024, 2025, 2026, 2027].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-blue-700 uppercase tracking-wide">Mes</label>
            <select
              value={mes}
              onChange={(e) => {
                setMes(Number(e.target.value));
                setDia("");
              }}
              className="border-2 border-blue-200 rounded-xl px-3 py-2.5 text-gray-900 font-medium bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all cursor-pointer"
            >
              {MESES.map((m, i) => (
                <option key={i} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-blue-700 uppercase tracking-wide">Dia</label>
            <select
              value={dia}
              onChange={(e) => setDia(e.target.value === "" ? "" : Number(e.target.value))}
              className="border-2 border-blue-200 rounded-xl px-3 py-2.5 text-gray-900 font-medium bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all cursor-pointer"
            >
              <option value="">Todos</option>
              {Array.from({ length: diasEnMes }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1 justify-end">
            <label className="text-xs font-bold text-transparent select-none">.</label>
            <Button
              onClick={() => refetch()}
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-2.5 font-semibold flex items-center gap-2 justify-center transition-all shadow-md hover:shadow-lg"
            >
              <Search className="h-4 w-4" />
              Consultar
            </Button>
          </div>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-blue-600 mb-4">
          <div className="h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <p className="font-medium">Cargando datos...</p>
        </div>
      )}
      {error && <p className="text-center text-red-600 mb-4">Error: {error.message}</p>}

      {!isLoading && (!data || data.length === 0) && !error && (
        <div className="text-center text-gray-500 mt-8">
          <CalendarDays className="h-12 w-12 mx-auto mb-3 text-gray-300" />
          <p className="font-medium">No hay datos para esta consulta</p>
        </div>
      )}

      {/* Desktop view */}
      <div className="hidden md:block w-full max-w-6xl space-y-4">
        {data?.map((asesor) => (
          <Card key={asesor.asesor_id} className="shadow-lg border border-gray-200 text-gray-900 overflow-hidden">
            <CardHeader
              className="flex justify-between items-center cursor-pointer bg-gradient-to-r from-gray-50 to-blue-50 hover:from-blue-50 hover:to-blue-100 transition-all"
              onClick={() =>
                setOpenAsesor(openAsesor === asesor.asesor_id ? null : asesor.asesor_id)
              }
            >
              <div className="flex items-center gap-3 text-gray-900">
                {openAsesor === asesor.asesor_id ? (
                  <ChevronDown className="h-5 w-5 text-blue-600" />
                ) : (
                  <ChevronRight className="h-5 w-5 text-blue-600" />
                )}
                <span className="font-bold text-lg">{asesor.asesor_nombre}</span>
              </div>
              <div className="flex items-center gap-4 text-sm text-gray-700 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-500">Cuotas:</span>
                  <span className="font-bold">{asesor.totales.cuotas_pagadas}/{asesor.totales.total_cuotas}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-500">Esperado:</span>
                  <span className="font-bold">Q {Number(asesor.totales.monto_esperado).toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-500">Cobrado:</span>
                  <span className="font-bold text-blue-700">Q {Number(asesor.totales.monto_cobrado).toLocaleString()}</span>
                </div>
                <span className={`px-3 py-1 rounded-full text-sm font-bold border ${getEfectividadBg(asesor.totales.efectividad)}`}>
                  {asesor.totales.efectividad}%
                </span>
              </div>
            </CardHeader>

            {openAsesor === asesor.asesor_id && (
              <CardContent className="p-0">
                <Table className="w-full">
                  <TableHeader>
                    <TableRow className="bg-blue-600 text-white">
                      <TableCell className="text-white font-semibold">Credito SIFCO</TableCell>
                      <TableCell className="text-white font-semibold">Cliente</TableCell>
                      <TableCell className="text-white font-semibold">Estado</TableCell>
                      <TableCell className="text-white font-semibold text-center">Cuotas</TableCell>
                      <TableCell className="text-white font-semibold text-center">Pagadas</TableCell>
                      <TableCell className="text-white font-semibold text-center">Pendientes</TableCell>
                      <TableCell className="text-white font-semibold">Esperado</TableCell>
                      <TableCell className="text-white font-semibold">Cobrado</TableCell>
                      <TableCell className="text-white font-semibold">Pendiente</TableCell>
                      <TableCell className="text-white font-semibold text-center">Efectividad</TableCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {asesor.creditos.map((item) => (
                      <TableRow
                        key={item.credito_id}
                        className="odd:bg-white even:bg-gray-50 hover:bg-blue-50 transition"
                      >
                        <TableCell className="font-mono font-bold text-blue-700 text-xs whitespace-normal leading-5">{item.numero_credito_sifco}</TableCell>
                        <TableCell className="text-gray-900">{item.usuario_nombre}</TableCell>
                        <TableCell>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                            item.statusCredit === "MOROSO" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
                          }`}>
                            {item.statusCredit}
                          </span>
                        </TableCell>
                        <TableCell className="text-center font-medium">{item.total_cuotas}</TableCell>
                        <TableCell className="text-center font-medium text-green-700">{item.cuotas_pagadas}</TableCell>
                        <TableCell className="text-center font-medium text-red-600">{item.cuotas_pendientes}</TableCell>
                        <TableCell className="text-gray-700">Q {Number(item.monto_esperado).toLocaleString()}</TableCell>
                        <TableCell className="text-blue-700 font-semibold">Q {Number(item.monto_cobrado).toLocaleString()}</TableCell>
                        <TableCell className="text-red-600">Q {Number(item.monto_pendiente).toLocaleString()}</TableCell>
                        <TableCell>
                          <div className="flex flex-col items-center gap-1">
                            <span className={`font-bold text-sm ${getEfectividadColor(item.efectividad)}`}>
                              {item.efectividad}%
                            </span>
                            <div className="w-full bg-gray-200 rounded-full h-2 max-w-[80px]">
                              <div
                                className={`h-2 rounded-full transition-all ${getBarColor(item.efectividad)}`}
                                style={{ width: getBarWidth(item.efectividad) }}
                              />
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {/* Fila totales */}
                    <TableRow className="bg-blue-50 font-bold border-t-2 border-blue-300">
                      <TableCell colSpan={3} className="text-blue-700">TOTAL</TableCell>
                      <TableCell className="text-center">{asesor.totales.total_cuotas}</TableCell>
                      <TableCell className="text-center text-green-700">{asesor.totales.cuotas_pagadas}</TableCell>
                      <TableCell className="text-center text-red-600">{asesor.totales.cuotas_pendientes}</TableCell>
                      <TableCell>Q {Number(asesor.totales.monto_esperado).toLocaleString()}</TableCell>
                      <TableCell className="text-blue-700">Q {Number(asesor.totales.monto_cobrado).toLocaleString()}</TableCell>
                      <TableCell className="text-red-600">Q {Number(asesor.totales.monto_pendiente).toLocaleString()}</TableCell>
                      <TableCell className="text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${getEfectividadBg(asesor.totales.efectividad)}`}>
                          {asesor.totales.efectividad}%
                        </span>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            )}
          </Card>
        ))}
      </div>

      {/* Mobile view */}
      <div className="md:hidden space-y-3 w-full">
        {data?.map((asesor) => (
          <div
            key={asesor.asesor_id}
            className="border rounded-2xl shadow-md bg-white text-gray-900 overflow-hidden"
          >
            <button
              className="w-full text-left p-4 bg-gradient-to-r from-blue-50 to-blue-100 font-bold text-blue-800 flex justify-between items-center"
              onClick={() =>
                setOpenAsesor(openAsesor === asesor.asesor_id ? null : asesor.asesor_id)
              }
            >
              <div className="flex flex-col gap-1">
                <span className="text-base">{asesor.asesor_nombre}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full w-fit border ${getEfectividadBg(asesor.totales.efectividad)}`}>
                  {asesor.totales.efectividad}%
                </span>
              </div>
              {openAsesor === asesor.asesor_id ? (
                <ChevronDown className="h-5 w-5 text-blue-600 flex-shrink-0" />
              ) : (
                <ChevronRight className="h-5 w-5 text-blue-600 flex-shrink-0" />
              )}
            </button>

            {openAsesor === asesor.asesor_id && (
              <div className="p-4 space-y-3 text-sm text-gray-900">
                {/* Resumen */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-blue-50 rounded-xl p-3 text-center">
                    <p className="text-xs text-gray-500">Cuotas</p>
                    <p className="font-bold text-lg">{asesor.totales.cuotas_pagadas}/{asesor.totales.total_cuotas}</p>
                  </div>
                  <div className="bg-green-50 rounded-xl p-3 text-center">
                    <p className="text-xs text-gray-500">Cobrado</p>
                    <p className="font-bold text-lg text-green-700">Q {Number(asesor.totales.monto_cobrado).toLocaleString()}</p>
                  </div>
                </div>

                {/* Barra efectividad */}
                <div className="bg-gray-100 rounded-xl p-3">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-500 font-medium">Efectividad General</span>
                    <span className={`font-bold ${getEfectividadColor(asesor.totales.efectividad)}`}>{asesor.totales.efectividad}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3">
                    <div
                      className={`h-3 rounded-full transition-all ${getBarColor(asesor.totales.efectividad)}`}
                      style={{ width: getBarWidth(asesor.totales.efectividad) }}
                    />
                  </div>
                </div>

                {/* Creditos */}
                <div className="space-y-2">
                  {asesor.creditos.map((item) => (
                    <div
                      key={item.credito_id}
                      className="border rounded-xl p-3 bg-gray-50 shadow-sm"
                    >
                      <div className="flex justify-between items-center mb-2">
                        <span className="font-bold text-blue-700 font-mono text-xs">{item.numero_credito_sifco}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${getEfectividadBg(item.efectividad)}`}>
                          {item.efectividad}%
                        </span>
                      </div>
                      <p className="text-xs text-gray-700 mb-1 font-medium">{item.usuario_nombre}</p>
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                          item.statusCredit === "MOROSO" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
                        }`}>
                          {item.statusCredit}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-1 text-xs">
                        <p><span className="text-gray-500">Cuotas:</span> <span className="font-semibold">{item.cuotas_pagadas}/{item.total_cuotas}</span></p>
                        <p><span className="text-gray-500">Pendientes:</span> <span className="font-semibold text-red-600">{item.cuotas_pendientes}</span></p>
                        <p><span className="text-gray-500">Esperado:</span> <span className="font-semibold">Q {Number(item.monto_esperado).toLocaleString()}</span></p>
                        <p><span className="text-gray-500">Cobrado:</span> <span className="font-semibold text-blue-700">Q {Number(item.monto_cobrado).toLocaleString()}</span></p>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-1.5 mt-2">
                        <div
                          className={`h-1.5 rounded-full ${getBarColor(item.efectividad)}`}
                          style={{ width: getBarWidth(item.efectividad) }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
