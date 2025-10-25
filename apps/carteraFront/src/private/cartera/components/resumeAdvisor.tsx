"use client";
import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useCreditosPorAsesor } from "../hooks/resumeAdvisor";

export default function CreditosPorAsesorManager() {
  const [search, setSearch] = useState("");
  const [openAsesor, setOpenAsesor] = useState<number | null>(null);
  const [openCredito, setOpenCredito] = useState<number | null>(null);
  const { data, isLoading, error, refetch } = useCreditosPorAsesor(search);

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-start bg-gradient-to-br from-blue-50 to-white px-2 overflow-auto pt-8 pb-8 text-gray-900">
      <h2 className="text-2xl font-bold text-blue-700 mb-4 text-center">
        Créditos por Asesor
      </h2>

      {/* 🔍 Buscador */}
      <div className="flex gap-2 mb-6 justify-center">
        <Input
          placeholder="Buscar por número de crédito SIFCO..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md border-gray-400 text-gray-900"
        />
        <Button onClick={() => refetch()}>Buscar</Button>
      </div>

      {isLoading && <p className="text-center text-blue-600">Cargando datos...</p>}
      {error && <p className="text-center text-red-600">Error: {error.message}</p>}

      {/* 🖥️ Desktop view */}
      <div className="hidden md:block w-full max-w-6xl">
        {data?.map((asesor) => (
          <Card key={asesor.asesor_id} className="mb-4 shadow-md text-gray-900">
            <CardHeader
              className="flex justify-between items-center cursor-pointer bg-gray-100"
              onClick={() =>
                setOpenAsesor(openAsesor === asesor.asesor_id ? null : asesor.asesor_id)
              }
            >
              <div className="flex items-center gap-2 text-gray-900">
                {openAsesor === asesor.asesor_id ? <ChevronDown /> : <ChevronRight />}
                <span className="font-semibold text-lg">{asesor.asesor}</span>
              </div>
              <div className="flex gap-6 text-sm text-gray-800">
                <p>
                  <strong>Total Créditos:</strong> {asesor.total_creditos}
                </p>
                <p>
                  <strong>Capital:</strong> Q {Number(asesor.total_capital).toLocaleString()}
                </p>
                <p>
                  <strong>Mora:</strong> Q {Number(asesor.total_mora).toLocaleString()}
                </p>
                <p>
                  <strong>Cuotas Atrasadas:</strong> {asesor.total_cuotas_atrasadas}
                </p>
                <p className="text-green-700 font-semibold">
                  Al Día: {asesor.creditos_al_dia}
                </p>
                <p className="text-red-700 font-semibold">
                  Morosos: {asesor.creditos_morosos}
                </p>
              </div>
            </CardHeader>

            {openAsesor === asesor.asesor_id && (
              <CardContent className="p-0">
                <Table className="w-full">
                  <TableHeader>
                    <TableRow className="bg-blue-50 text-gray-900 font-semibold">
                      <TableCell>ID</TableCell>
                      <TableCell>Crédito SIFCO</TableCell>
                      <TableCell>Capital</TableCell>
                      <TableCell>Deuda</TableCell>
                      <TableCell>Mora</TableCell>
                      <TableCell>Cuotas Atrasadas</TableCell>
                      <TableCell>Estado</TableCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {asesor.creditos.map((credito) => (
                      <>
                        <TableRow
                          key={credito.credito_id}
                          className="cursor-pointer odd:bg-white even:bg-gray-50 hover:bg-blue-50 transition"
                          onClick={() =>
                            setOpenCredito(
                              openCredito === credito.credito_id
                                ? null
                                : credito.credito_id
                            )
                          }
                        >
                          <TableCell className="text-gray-900 font-medium">
                            {credito.credito_id}
                          </TableCell>
                          <TableCell className="text-gray-900 font-mono">
                            {credito.numero_credito_sifco}
                          </TableCell>
                          <TableCell className="text-gray-900">
                            Q {Number(credito.capital).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-gray-900">
                            Q {Number(credito.deudatotal).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-gray-900">
                            Q {Number(credito.monto_mora).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-gray-900 text-center">
                            {credito.cuotas_atrasadas}
                          </TableCell>
                          <TableCell>
                            <span
                              className={`font-semibold ${
                                credito.statusCredit === "MOROSO"
                                  ? "text-red-700"
                                  : "text-green-700"
                              }`}
                            >
                              {credito.statusCredit}
                            </span>
                          </TableCell>
                        </TableRow>

                        {openCredito === credito.credito_id && (
                          <TableRow className="bg-blue-50">
                            <TableCell colSpan={7}>
                              <div className="p-4 rounded-lg text-sm text-gray-900">
                                <p>
                                  <strong>Número de Crédito:</strong>{" "}
                                  {credito.numero_credito_sifco}
                                </p>
                                <p>
                                  <strong>Capital:</strong> Q{" "}
                                  {Number(credito.capital).toLocaleString()}
                                </p>
                                <p>
                                  <strong>Deuda Total:</strong> Q{" "}
                                  {Number(credito.deudatotal).toLocaleString()}
                                </p>
                                <p>
                                  <strong>Monto de Mora:</strong> Q{" "}
                                  {Number(credito.monto_mora).toLocaleString()}
                                </p>
                                <p>
                                  <strong>Cuotas Atrasadas:</strong>{" "}
                                  {credito.cuotas_atrasadas}
                                </p>
                                <p>
                                  <strong>Estado:</strong>{" "}
                                  <span
                                    className={
                                      credito.statusCredit === "MOROSO"
                                        ? "text-red-700 font-semibold"
                                        : "text-green-700 font-semibold"
                                    }
                                  >
                                    {credito.statusCredit}
                                  </span>
                                </p>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            )}
          </Card>
        ))}
      </div>

      {/* 📱 Mobile view */}
      <div className="md:hidden space-y-3 w-full">
        {data?.map((asesor) => (
          <div
            key={asesor.asesor_id}
            className="border rounded-lg shadow-sm bg-white text-gray-900"
          >
            <button
              className="w-full text-left p-3 bg-blue-100 font-semibold text-blue-800 flex justify-between"
              onClick={() =>
                setOpenAsesor(openAsesor === asesor.asesor_id ? null : asesor.asesor_id)
              }
            >
              {asesor.asesor}
              {openAsesor === asesor.asesor_id ? <ChevronDown /> : <ChevronRight />}
            </button>

            {openAsesor === asesor.asesor_id && (
              <div className="p-3 space-y-2 text-sm text-gray-900">
                <p>
                  <strong>Total Créditos:</strong> {asesor.total_creditos}
                </p>
                <p>
                  <strong>Capital:</strong> Q {Number(asesor.total_capital).toLocaleString()}
                </p>
                <p>
                  <strong>Mora:</strong> Q {Number(asesor.total_mora).toLocaleString()}
                </p>
                <p>
                  <strong>Cuotas Atrasadas:</strong> {asesor.total_cuotas_atrasadas}
                </p>

                <div className="space-y-2 mt-3">
                  {asesor.creditos.map((credito) => (
                    <div
                      key={credito.credito_id}
                      className="border rounded-md p-3 bg-gray-50 shadow-sm"
                    >
                      <div
                        className="flex justify-between font-semibold text-gray-900 cursor-pointer"
                        onClick={() =>
                          setOpenCredito(
                            openCredito === credito.credito_id
                              ? null
                              : credito.credito_id
                          )
                        }
                      >
                        <span>{credito.numero_credito_sifco}</span>
                        {openCredito === credito.credito_id ? (
                          <ChevronDown />
                        ) : (
                          <ChevronRight />
                        )}
                      </div>

                      {openCredito === credito.credito_id && (
                        <div className="mt-2 text-sm space-y-1 text-gray-900">
                          <p>Capital: Q {Number(credito.capital).toLocaleString()}</p>
                          <p>Deuda: Q {Number(credito.deudatotal).toLocaleString()}</p>
                          <p>Mora: Q {Number(credito.monto_mora).toLocaleString()}</p>
                          <p>Cuotas Atrasadas: {credito.cuotas_atrasadas}</p>
                          <p>
                            Estado:{" "}
                            <span
                              className={`font-semibold ${
                                credito.statusCredit === "MOROSO"
                                  ? "text-red-700"
                                  : "text-green-700"
                              }`}
                            >
                              {credito.statusCredit}
                            </span>
                          </p>
                        </div>
                      )}
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
