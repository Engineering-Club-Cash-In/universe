/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useState } from "react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableHeader,
  TableRow,
  TableCell,
  TableBody,
} from "@/components/ui/table";
import { useMoras } from "../hooks/useLateFee";
import { useAuth } from "@/Provider/authProvider";

export default function MorasManager() {
  const [tab, setTab] = useState<"creditos" | "condonaciones">("creditos");

  // Modal condonación
  const [openModalCondonacion, setOpenModalCondonacion] = useState(false);
  const [condonacionCreditoId, setCondonacionCreditoId] = useState<
    number | null
  >(null);
  const [motivo, setMotivo] = useState("");
  const [montoMoraSeleccionada, setMontoMoraSeleccionada] = useState<
    number | null
  >(null);

  // Modal editar mora
  const [openModalMora, setOpenModalMora] = useState(false);
  const [editCreditoId, setEditCreditoId] = useState<number | null>(null);
  const [nuevoMonto, setNuevoMonto] = useState<number | undefined>();
  const [nuevasCuotas, setNuevasCuotas] = useState<number | undefined>();
  const [tipoCambio, setTipoCambio] = useState<"INCREMENTO" | "DECREMENTO">(
    "INCREMENTO"
  );

  const {
    creditosMora,
    condonaciones,
    loadingCreditos,
    loadingCondonaciones,
    condonarMora,
    updateMora,
  } = useMoras({ estado: "MOROSO" });

  const { user } = useAuth();

  // --- Condonación ---
  const handleCondonar = (credito_id: number, monto_mora: number) => {
    setCondonacionCreditoId(credito_id);
    setMontoMoraSeleccionada(monto_mora);
    setOpenModalCondonacion(true);
  };

  const confirmCondonacion = () => {
    if (condonacionCreditoId && motivo && user?.email) {
      condonarMora.mutate(
        { credito_id: condonacionCreditoId, motivo, usuario_email: user.email },
        {
          onSuccess: (res: any) =>
            alert(
              `[SUCCESS] Mora condonada\n\n${JSON.stringify(res, null, 2)}`
            ),
          onError: (err: any) =>
            alert(
              `[ERROR] No se pudo condonar mora\n\n${JSON.stringify(err, null, 2)}`
            ),
        }
      );
      setOpenModalCondonacion(false);
      setMotivo("");
      setMontoMoraSeleccionada(null);
    } else {
      alert("[ERROR] Completa todos los campos antes de condonar.");
    }
  };

  // --- Editar Mora ---
  const handleEditarMora = (
    credito_id: number,
    monto: number,
    cuotas: number
  ) => {
    setEditCreditoId(credito_id);
    setNuevoMonto(0);
    setMontoMoraSeleccionada(monto);
    setNuevasCuotas(cuotas);
    setTipoCambio("INCREMENTO");
    setOpenModalMora(true);
  };

  const confirmGuardarMora = () => {
    if (!nuevoMonto || !nuevasCuotas) {
      alert("[ERROR] Debes ingresar monto y cuotas.");
      return;
    }

    if (editCreditoId) {
      updateMora.mutate(
        {
          credito_id: editCreditoId,
          monto_cambio: nuevoMonto,
          tipo: tipoCambio,
          cuotas_atrasadas: nuevasCuotas,
        },
        {
          onSuccess: (res: any) =>
            alert(
              `[SUCCESS] Mora actualizada\n\n${JSON.stringify(res, null, 2)}`
            ),
          onError: (err: any) =>
            alert(
              `[ERROR] No se pudo actualizar mora\n\n${JSON.stringify(err, null, 2)}`
            ),
        }
      );
    }

    setOpenModalMora(false);
    setNuevoMonto(undefined);
    setNuevasCuotas(undefined);
    setEditCreditoId(null);
  };

  return (
    <div className=" fixed inset-0 flex flex-col items-center justify-start bg-gradient-to-br from-blue-50 to-white px-2 overflow-auto pt-8 pb-8">
      {/* Title */}
      <h2 className="text-2xl font-bold text-blue-600 mb-4">
        Gestión de Moras
      </h2>

      {/* Tabs minimalistas con toggle */}
      <div className="flex gap-2 mb-4">
        <Button
          type="button"
          size="sm"
          className={`flex-1 ${
            tab === "creditos"
              ? "bg-blue-600 text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
          onClick={() => setTab("creditos")}
        >
          Créditos con Mora
        </Button>
        <Button
          type="button"
          size="sm"
          className={`flex-1 ${
            tab === "condonaciones"
              ? "bg-blue-600 text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
          onClick={() => setTab("condonaciones")}
        >
          Condonaciones
        </Button>
      </div>

      {/* Créditos con mora */}
      {tab === "creditos" && (
        <Card>
          <CardHeader className="font-semibold text-lg text-gray-700">
            Créditos Morosos
          </CardHeader>
          <CardContent>
            {loadingCreditos ? (
              <div className="text-center py-6">Cargando créditos...</div>
            ) : (
              <>
                {/* Desktop/Table */}
                <div className="hidden md:block overflow-x-auto">
                  <Table className="w-full border-collapse">
                    <TableHeader>
                      <TableRow className="bg-gray-50 text-gray-700 text-sm">
                        <TableCell className="px-3 py-2">ID</TableCell>
                        <TableCell className="px-3 py-2">
                          Crédito SIFCO
                        </TableCell>
                        <TableCell className="px-3 py-2">Usuario</TableCell>
                        <TableCell className="px-3 py-2">Estado</TableCell>
                        <TableCell className="px-3 py-2">Monto Mora</TableCell>
                        <TableCell className="px-3 py-2">
                          Cuotas Atrasadas
                        </TableCell>
                        <TableCell className="px-3 py-2 text-center">
                          Acciones
                        </TableCell>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {creditosMora?.data?.map((c: any) => (
                        <TableRow
                          key={c.credito_id}
                          className="text-gray-800 hover:bg-gray-50 transition"
                        >
                          <TableCell className="px-3 py-2">
                            {c.credito_id}
                          </TableCell>
                          <TableCell className="px-3 py-2">
                            {c.numero_credito_sifco}
                          </TableCell>
                          <TableCell className="px-3 py-2">
                            {c.usuario}
                          </TableCell>
                          <TableCell className="px-3 py-2">
                            {c.estado}
                          </TableCell>
                          <TableCell className="px-3 py-2">
                            Q {c.monto_mora}
                          </TableCell>
                          <TableCell className="px-3 py-2">
                            {c.cuotas_atrasadas}
                          </TableCell>
                          <TableCell className="px-3 py-2 flex justify-center gap-2">
                            <Button
                              size="sm"
                              className="bg-yellow-500 text-white hover:bg-yellow-600"
                              onClick={() =>
                                handleEditarMora(
                                  c.credito_id,
                                  c.monto_mora,
                                  c.cuotas_atrasadas
                                )
                              }
                            >
                              Editar
                            </Button>
                            <Button
                              size="sm"
                              className="bg-green-600 text-white hover:bg-green-700"
                              onClick={() =>
                                handleCondonar(c.credito_id, c.monto_mora)
                              }
                            >
                              Condonar
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Mobile → Lista */}
                <div className="md:hidden space-y-3">
                  {creditosMora?.data?.map((c: any) => (
                    <div
                      key={c.credito_id}
                      className="border rounded-lg p-3 shadow-sm bg-gray-50 text-gray-800"
                    >
                      <p className="text-sm font-semibold text-blue-600">
                        Crédito #{c.credito_id}
                      </p>
                      <p className="text-xs">SIFCO: {c.numero_credito_sifco}</p>
                      <p className="text-xs">Usuario: {c.usuario}</p>
                      <p className="text-xs">Estado: {c.estado}</p>
                      <p className="text-xs">Monto: Q {c.monto_mora}</p>
                      <p className="text-xs">Cuotas: {c.cuotas_atrasadas}</p>
                      <div className="flex gap-2 mt-2">
                        <Button
                          size="sm"
                          className="bg-yellow-500 text-white hover:bg-yellow-600 flex-1"
                          onClick={() =>
                            handleEditarMora(
                              c.credito_id,
                              c.monto_mora,
                              c.cuotas_atrasadas
                            )
                          }
                        >
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          className="bg-green-600 text-white hover:bg-green-700 flex-1"
                          onClick={() =>
                            handleCondonar(c.credito_id, c.monto_mora)
                          }
                        >
                          Condonar
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Historial de condonaciones → igual que arriba puedes duplicar lógica lista responsiva */}
      {tab === "condonaciones" && (
        <Card>
          <CardHeader className="font-semibold text-lg text-gray-700">
            Historial de Condonaciones
          </CardHeader>
          <CardContent>
            {loadingCondonaciones ? (
              <div className="text-center py-6">Cargando condonaciones...</div>
            ) : (
              <>
                <div className="hidden md:block overflow-x-auto">
                  <Table className="w-full border-collapse">
                    <TableHeader>
                      <TableRow className="bg-gray-50 text-gray-700 text-sm">
                        <TableCell className="px-3 py-2">ID</TableCell>
                        <TableCell className="px-3 py-2">Crédito</TableCell>
                        <TableCell className="px-3 py-2">Usuario</TableCell>
                        <TableCell className="px-3 py-2">Motivo</TableCell>
                        <TableCell className="px-3 py-2">Fecha</TableCell>
                        <TableCell className="px-3 py-2">Condonó</TableCell>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {condonaciones?.data?.map((c: any) => (
                        <TableRow
                          key={c.condonacion_id}
                          className="text-gray-800 hover:bg-gray-50 transition"
                        >
                          <TableCell className="px-3 py-2">
                            {c.condonacion_id}
                          </TableCell>
                          <TableCell className="px-3 py-2">
                            {c.numero_credito_sifco}
                          </TableCell>
                          <TableCell className="px-3 py-2">
                            {c.usuario}
                          </TableCell>
                          <TableCell className="px-3 py-2">
                            {c.motivo}
                          </TableCell>
                          <TableCell className="px-3 py-2">
                            {new Date(c.fecha).toLocaleDateString("es-GT")}
                          </TableCell>
                          <TableCell className="px-3 py-2">
                            {c.usuario_email}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Mobile list condonaciones */}
                <div className="md:hidden space-y-3">
                  {condonaciones?.data?.map((c: any) => (
                    <div
                      key={c.condonacion_id}
                      className="border rounded-lg p-3 shadow-sm bg-gray-50 text-gray-800"
                    >
                      <p className="text-sm font-semibold text-blue-600">
                        Condonación #{c.condonacion_id}
                      </p>
                      <p className="text-xs">
                        Crédito: {c.numero_credito_sifco}
                      </p>
                      <p className="text-xs">Usuario: {c.usuario}</p>
                      <p className="text-xs">Motivo: {c.motivo}</p>
                      <p className="text-xs">
                        Fecha: {new Date(c.fecha).toLocaleDateString("es-GT")}
                      </p>
                      <p className="text-xs">Condonó: {c.usuario_email}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Modal Editar Mora */}
      {openModalMora && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-40 z-50">
          <div className="bg-white rounded-lg p-6 w-96 shadow-lg">
            <h3 className="text-lg font-bold text-blue-600 mb-4">
              Editar Mora
            </h3>
            <div className="flex flex-col gap-3 text-black">
              {/* Toggle minimalista */}
              <div>
                <Label className="mb-1 block">Tipo de cambio</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className={`flex-1 ${
                      tipoCambio === "INCREMENTO"
                        ? "bg-blue-600 text-white"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                    onClick={() => setTipoCambio("INCREMENTO")}
                  >
                    Incremento
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className={`flex-1 ${
                      tipoCambio === "DECREMENTO"
                        ? "bg-blue-600 text-white"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                    onClick={() => setTipoCambio("DECREMENTO")}
                  >
                    Decremento
                  </Button>
                </div>
              </div>

              <div>
                <Label htmlFor="monto">Monto Actual</Label>
                <Input
                  id="monto"
                  type="number"
                  value={montoMoraSeleccionada ?? ""}
                  disabled
                />
              </div>
              <div>
                <Label htmlFor="monto" className="flex items-center gap-2">
                  {tipoCambio === "INCREMENTO" ? (
                    <span className="text-green-600 font-semibold">
                      💹 Monto a incrementar
                    </span>
                  ) : (
                    <span className="text-red-600 font-semibold">
                      🔻 Monto a disminuir
                    </span>
                  )}
                </Label>
                <Input
                  id="monto"
                  type="number"
                  value={nuevoMonto ?? ""}
                  onChange={(e) => setNuevoMonto(Number(e.target.value))}
                />
              </div>
              <div>
                <Label htmlFor="cuotas">Cuotas Atrasadas</Label>
                <Input
                  id="cuotas"
                  type="number"
                  value={nuevasCuotas ?? ""}
                  onChange={(e) => setNuevasCuotas(Number(e.target.value))}
                />
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <Button
                  variant="secondary"
                  onClick={() => setOpenModalMora(false)}
                >
                  Cancelar
                </Button>
                <Button onClick={confirmGuardarMora}>Guardar</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal condonación */}
      {openModalCondonacion && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-40 z-50">
          <div className="bg-white rounded-lg p-6 w-96 shadow-lg text-black">
            <h3 className="text-lg font-bold text-blue-600 mb-4">
              Condonar Mora
            </h3>
            {montoMoraSeleccionada !== null && (
              <div className="mb-3 text-sm text-gray-700">
                Monto actual:{" "}
                <span className="font-semibold text-red-600">
                  Q {montoMoraSeleccionada}
                </span>
              </div>
            )}
            <div className="flex flex-col gap-3">
              <div>
                <Label htmlFor="motivo">Motivo</Label>
                <Input
                  id="motivo"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                />
              </div>
              <div className="text-sm text-gray-600">
                Se registrará con el usuario:{" "}
                <span className="font-semibold">{user?.email}</span>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <Button
                  variant="secondary"
                  onClick={() => setOpenModalCondonacion(false)}
                >
                  Cancelar
                </Button>
                <Button onClick={confirmCondonacion}>Confirmar</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
