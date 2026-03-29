/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getFallenCredits, type GetFallenCreditsResponse } from "../services/services";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, X, ChevronLeft, ChevronRight } from "lucide-react";

function safeField(obj: any, ...keys: string[]): string {
  if (!obj) return "--";
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== "") return String(obj[k]);
  }
  return "--";
}

function formatFecha(val: any): string {
  if (!val) return "--";
  try {
    return new Date(val).toLocaleDateString("es-GT", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "--";
  }
}

export function FallenCredits() {
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [sifcoInput, setSifcoInput] = useState("");
  const [sifcoFilter, setSifcoFilter] = useState("");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");

  const { data, isLoading, isError } = useQuery<GetFallenCreditsResponse>({
    queryKey: ["fallen-credits", page, perPage, sifcoFilter, fechaDesde, fechaHasta],
    queryFn: () =>
      getFallenCredits({
        page,
        perPage,
        numero_credito_sifco: sifcoFilter || undefined,
        fecha_desde: fechaDesde || undefined,
        fecha_hasta: fechaHasta || undefined,
      }),
    staleTime: 1000 * 60,
  });

  const handleSearch = () => {
    setSifcoFilter(sifcoInput.trim());
    setPage(1);
  };

  const clearFilters = () => {
    setSifcoInput("");
    setSifcoFilter("");
    setFechaDesde("");
    setFechaHasta("");
    setPage(1);
  };

  const items: any[] = data?.data ?? [];

  return (
    <div className="fixed inset-x-0 top-16 xl:top-20 bottom-0 flex flex-col items-center justify-start bg-gradient-to-br from-blue-50 to-white px-4 sm:px-6 lg:px-8 overflow-auto pt-8 pb-8">
    <div className="w-full max-w-[1400px]">
      <div className="flex flex-col items-center mb-6">
        <h1 className="text-3xl font-extrabold text-blue-700 text-center">
          Créditos Caídos
        </h1>
        <p className="text-lg text-gray-600 leading-relaxed text-center mt-2">
          Historial de créditos que fueron marcados como caídos.
        </p>
      </div>

      {/* Filtros */}
      <div className="bg-white/80 backdrop-blur rounded-2xl shadow-lg border border-blue-100 p-5 mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[200px]">
            <label className="text-sm font-semibold text-blue-800 mb-1 block">
              No. Crédito SIFCO
            </label>
            <div className="flex gap-2">
              <Input
                placeholder="Buscar por SIFCO..."
                value={sifcoInput}
                onChange={(e) => setSifcoInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="text-gray-900 border-blue-200 bg-blue-50 focus:ring-blue-400"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleSearch}
                className="text-blue-700 border-blue-300 hover:bg-blue-50"
              >
                <Search className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div>
            <label className="text-sm font-semibold text-blue-800 mb-1 block">
              Desde
            </label>
            <Input
              type="date"
              value={fechaDesde}
              onChange={(e) => {
                setFechaDesde(e.target.value);
                setPage(1);
              }}
              className="text-gray-900 border-blue-200 bg-blue-50"
            />
          </div>

          <div>
            <label className="text-sm font-semibold text-blue-800 mb-1 block">
              Hasta
            </label>
            <Input
              type="date"
              value={fechaHasta}
              onChange={(e) => {
                setFechaHasta(e.target.value);
                setPage(1);
              }}
              className="text-gray-900 border-blue-200 bg-blue-50"
            />
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={clearFilters}
            className="text-gray-600 border-gray-300 hover:bg-gray-100"
          >
            <X className="w-4 h-4 mr-1" /> Limpiar
          </Button>
        </div>
      </div>

      {/* Contenido */}
      {isLoading ? (
        <div className="text-center py-16 text-blue-400 font-semibold text-lg">Cargando...</div>
      ) : isError ? (
        <div className="text-center py-16 text-red-500 font-semibold">
          Error al cargar créditos caídos
        </div>
      ) : !items.length ? (
        <div className="text-center py-16 text-gray-400 font-semibold text-lg">
          No hay créditos caídos
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl shadow-lg border border-blue-100 overflow-x-auto">
            <Table className="w-full">
              <TableHeader>
                <TableRow className="bg-gradient-to-r from-blue-50 to-blue-100">
                  <TableHead className="font-bold text-blue-800">No. SIFCO</TableHead>
                  <TableHead className="font-bold text-blue-800">Cliente</TableHead>
                  <TableHead className="font-bold text-blue-800">Asesor</TableHead>
                  <TableHead className="font-bold text-blue-800">Motivo</TableHead>
                  <TableHead className="font-bold text-blue-800">Fecha Caída</TableHead>
                  <TableHead className="font-bold text-blue-800">Observaciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item: any, idx: number) => {
                  const credito = item.credito ?? item.creditos ?? {};
                  const usuario = item.usuario ?? item.usuarios ?? {};
                  const asesor = item.asesor ?? {};
                  const caido = item.caido ?? {};

                  return (
                    <TableRow key={caido.id ?? idx} className="hover:bg-blue-50/50 transition">
                      <TableCell className="font-semibold text-blue-700">
                        {safeField(credito, "numero_credito_sifco")}
                      </TableCell>
                      <TableCell className="text-gray-800">
                        {safeField(usuario, "nombre", "nombres")}
                      </TableCell>
                      <TableCell className="text-gray-800">
                        {safeField(asesor, "nombre", "nombres")}
                      </TableCell>
                      <TableCell className="text-gray-800 min-w-[200px] whitespace-normal break-words">
                        {caido.motivo ?? "--"}
                      </TableCell>
                      <TableCell className="text-gray-700">
                        {formatFecha(caido.fecha_caida)}
                      </TableCell>
                      <TableCell className="text-gray-500 min-w-[150px] whitespace-normal break-words">
                        {caido.observaciones || "--"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Paginación */}
          <div className="flex flex-wrap items-center justify-between mt-5 gap-3">
            <span className="text-sm text-gray-600">
              Página {data?.page ?? 1} de {data?.totalPages ?? 1} ({data?.totalCount ?? 0} total)
            </span>
            <div className="flex items-center gap-2">
              <select
                className="border border-blue-200 rounded-lg px-3 py-2 text-sm text-blue-800 bg-blue-50 focus:ring-blue-400"
                value={perPage}
                onChange={(e) => {
                  setPerPage(Number(e.target.value));
                  setPage(1);
                }}
              >
                {[10, 25, 50].map((n) => (
                  <option key={n} value={n}>
                    {n} por página
                  </option>
                ))}
              </select>
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="border-blue-200 text-blue-700"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= (data?.totalPages ?? 1)}
                onClick={() => setPage((p) => p + 1)}
                className="border-blue-200 text-blue-700"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
    </div>
  );
}
