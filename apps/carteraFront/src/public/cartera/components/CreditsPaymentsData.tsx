/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { useCreditosPaginadosWithFilters } from "../hooks/credits";
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
import { useNavigate } from "react-router-dom";
import { ModalEditCredit } from "./ModalEditCredit";
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
  } = useCreditosPaginadosWithFilters();
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [creditToEdit, setCreditToEdit] = useState<any | null>(null);

  const handleOpenEdit = (credit: any) => {
    setCreditToEdit(credit);
    setEditModalOpen(true);
  };

  const handleSaveEdit = async (updatedCredit: any) => {
    console.log("Saving credit edit:", updatedCredit);
  };
  if (isLoading) return <div>Cargando...</div>;
  if (isError)
    return <div className="text-red-500">{(error as any)?.message}</div>;

  if (!data || data.data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 w-full">
        <span className="bg-blue-100 p-4 rounded-full mb-4">
          <Info className="text-blue-500 w-10 h-10" />
        </span>
        <p className="text-blue-700 text-lg font-semibold">
          No se encontraron resultados.
        </p>
        <p className="text-gray-500 text-sm mt-1">
          Prueba cambiando los filtros o verifica tu búsqueda.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-6 flex items-center gap-2 px-5 py-2 rounded-xl bg-blue-600 text-white font-bold shadow hover:bg-blue-700 transition"
        >
          <RefreshCw className="w-5 h-5" /> Reintentar
        </button>
      </div>
    );
  }
  return (
    <div className="w-full max-w-5xl mx-auto mt-10">
      {/* Título */}
      <div className="flex flex-col items-center mb-4">
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-3xl md:text-4xl font-extrabold text-blue-700 drop-shadow text-center">
            Resumen General de Créditos y Pagos
          </h2>
        </div>
        <p className="text-lg text-gray-600 mt-1 text-center max-w-xl">
          Consulta aquí el detalle y estado de todos los créditos registrados,
          junto con su información más relevante y pagos asociados.
        </p>
      </div>
      <div className="flex flex-col md:flex-row gap-4 items-center mb-6 justify-center w-full">
        {/* Filtros agrupados con fondo suave y sombra */}
        <div className="flex flex-wrap gap-3 items-center bg-white/80 border border-blue-100 shadow-md rounded-2xl px-6 py-4 w-full max-w-4xl justify-center">
          {/* Mes */}
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

          {/* Año */}
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

          {/* # Crédito SIFCO */}
          <label className="flex items-center gap-2 font-medium text-blue-800">
            <Hash className="w-5 h-5" />
            <input
              className="border border-blue-200 rounded-lg px-3 py-2 bg-blue-50 text-blue-800 focus:ring-2 focus:ring-blue-400"
              type="text"
              placeholder="Buscar # Crédito SIFCO"
              value={creditoSifco}
              onChange={handleSifco}
            />
          </label>

          {/* Por página */}
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
        {/* Filtro extra si quieres más adelante */}
        {/* <div className="flex items-center gap-2 bg-blue-50 px-3 py-2 rounded-lg">
    <SlidersHorizontal className="w-5 h-5 text-blue-600" />
    <span className="text-blue-700">Filtros avanzados</span>
  </div> */}
      </div>
      <div className="overflow-x-auto shadow rounded-xl bg-white">
        <Table className="w-full min-w-[900px]">
          <TableHeader>
            <TableRow className="bg-gray-50 border-b-2 border-gray-200">
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.data.map((item:any, idx:any) => (
              <React.Fragment key={item.creditos.credito_id}>
                {/* Row principal */}
                <TableRow
                  className="hover:bg-blue-50 cursor-pointer transition"
                  onClick={() =>
                    setExpandedRow(expandedRow === idx ? null : idx)
                  }
                >
                  <TableCell className="text-blue-700 font-semibold text-center underline hover:text-blue-900 transition">
                    {item.creditos.numero_credito_sifco}
                  </TableCell>
                  <TableCell className="text-indigo-700 font-bold text-center">
                    {item.usuarios.nombre}
                  </TableCell>
                  <TableCell className="text-green-600 font-bold text-center">
                    Q{Number(item.creditos.deudatotal).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-indigo-700 font-bold text-center">
                    Q{Number(item.creditos.cuota).toLocaleString()}
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
                </TableRow>
                {/* Row expandida */}
                {expandedRow === idx && (
                  <TableRow>
                    <TableCell colSpan={5} className="p-0 bg-gray-100">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-4 text-sm text-center">
                        <div>
                          <span className="font-bold text-gray-700">NIT:</span>{" "}
                          <span className="text-gray-400">
                            {item.usuarios.nit}
                          </span>
                        </div>
                        <div>
                          <span className="font-bold text-gray-700">
                            Categoría:
                          </span>{" "}
                          <span className="text-purple-600 font-semibold">
                            {item.usuarios.categoria}
                          </span>
                        </div>
                        <div>
                          <span className="font-bold text-gray-700">
                            Capital:
                          </span>{" "}
                          <span className="text-blue-600 font-semibold">
                            Q{item.creditos.capital}
                          </span>
                        </div>
                        <div>
                          <span className="font-bold text-gray-700">
                            Interés:
                          </span>{" "}
                          <span className="text-orange-600 font-semibold">
                            {item.creditos.porcentaje_interes}%
                          </span>
                        </div>
                        <div>
                          <span className="font-bold text-gray-700">
                            Cuota Interés:
                          </span>{" "}
                          <span className="text-pink-600 font-semibold">
                            Q{item.creditos.cuota_interes}
                          </span>
                        </div>
                        <div>
                          <span className="font-bold text-gray-700">GPS:</span>{" "}
                          <span className="text-cyan-700 font-semibold">
                            Q{item.creditos.gps}
                          </span>
                        </div>
                        <div>
                          <span className="font-bold text-gray-700">
                            IVA 12%:
                          </span>{" "}
                          <span className="text-yellow-600 font-semibold">
                            Q{item.creditos.iva_12}
                          </span>
                        </div>
                        <div>
                          <span className="font-bold text-gray-700">
                            Plazo:
                          </span>{" "}
                          <span className="text-gray-800 font-semibold">
                            {item.creditos.plazo}
                          </span>
                        </div>
                        <div>
                          <span className="font-bold text-gray-700">
                            Póliza:
                          </span>{" "}
                          <span className="text-gray-400">
                            {item.creditos.no_poliza}
                          </span>
                        </div>
                        <div>
                          <span className="font-bold text-gray-700">
                            Observaciones:
                          </span>{" "}
                          <span className="text-gray-400">
                            {item.creditos.observaciones}
                          </span>
                        </div>
                        <div>
                          <span className="font-bold text-gray-700">
                            Creado:
                          </span>{" "}
                          <span className="text-gray-400">
                            {new Date(
                              item.creditos.fecha_creacion
                            ).toLocaleDateString()}
                          </span>
                        </div>
                        <div>
                          <span className="font-bold text-gray-700">
                            Formato:
                          </span>{" "}
                          <span className="text-gray-400">
                            {item.creditos.formato_credito}
                          </span>
                        </div>
                        {/* Agrega más campos si quieres */}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex flex-col items-center gap-2">
                        <button
                          className="px-3 py-1 rounded bg-indigo-100 text-indigo-700 hover:bg-indigo-200 w-32 font-bold"
                          onClick={() =>
                            navigate(
                              `/pagos/${item.creditos.numero_credito_sifco}`
                            )
                          }
                        >
                          Ver pagos
                        </button>
                        <button
                          className="px-3 py-1 rounded bg-yellow-100 text-yellow-800 hover:bg-yellow-200 font-bold w-32"
                          onClick={() => handleOpenEdit(item.creditos)}
                        >
                          Editar crédito
                        </button>
                      </div>
                    </TableCell>

                    {/* ... */}
                    <ModalEditCredit
                      open={editModalOpen}
                      onClose={() => setEditModalOpen(false)}
                      initialValues={creditToEdit}
                      onSave={handleSaveEdit}
                    />
                  </TableRow>
                )}
              </React.Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
      {/* Paginación */}
      <div className="flex justify-between mt-4">
        <button
          className="px-4 py-2 rounded bg-gray-100 text-gray-700 font-bold disabled:opacity-50"
          onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
          disabled={page <= 1 || isFetching}
        >
          Anterior
        </button>
        <span className="text-gray-800 font-bold">
          Página {data.page} de {data.totalPages}
        </span>
        <button
          className="px-4 py-2 rounded bg-gray-100 text-gray-700 font-bold disabled:opacity-50"
          onClick={() => setPage((prev) => Math.min(prev + 1,(data.totalPages ?? 1)))}
          disabled={page >= (data.totalPages ?? 1) || isFetching}
        >
          Siguiente
        </button>
      </div>
      {isFetching && (
        <div className="text-blue-500 mt-2">Cargando página...</div>
      )}
    </div>
  );
}
