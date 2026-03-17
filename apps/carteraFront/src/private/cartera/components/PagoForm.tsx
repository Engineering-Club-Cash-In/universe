/* eslint-disable @typescript-eslint/no-explicit-any */
import { usePagoForm } from "../hooks/registerPayment";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DollarSign, Percent, Info, FileText, Building2, CheckCircle2, Calendar, ChevronsUpDown, Check } from "lucide-react";
import { Combobox, Transition } from "@headlessui/react";
import { Fragment, useMemo } from "react";
import { toast } from "sonner";
import { MiniCardCredito } from "./cardInfo";
import { OpcionesExcesoModal } from "./excessModal";
import { ModalBadDebtCredit } from "./ModalBadDebtCredit";
import { BuscadorUsuarioSifco } from "./searchByNameSifco"; 
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { useBancos } from "../hooks/bancos";
import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"; 
import {  DatePickerMUI } from "./calendar";
const fields = [
  {
    name: "monto_boleta",
    label: "Monto Boleta",
    type: "number",
    icon: <DollarSign className="text-blue-500 mr-2 w-5 h-5" />,
    required: true,
  },
  {
    name: "otros",
    label: "Otros (Opcional)",
    type: "number",
    icon: <Info className="text-blue-500 mr-2 w-5 h-5" />,
    required: false,
  },
  {
    name: "observaciones",
    label: "Observaciones (Opcional)",
    type: "text",
    icon: <Percent className="text-blue-500 mr-2 w-5 h-5" />,
    required: false,
  },
];

export function PagoForm() {
  const {
    formik,
    fetchCredito,
    dataCredito,
    errorCredito,
    cuotaActualInfo,
    cuotasAtrasadasInfo,
    handleFormSubmit,
    modalExcesoOpen,
    setModalExcesoOpen,
    excedente,
    handleAbonoCapital,
    handleAbonoSiguienteCuota,
    handleAbonoOtros,
    modalMode,
    setCuotaSeleccionada,
    setArchivosParaSubir,
    archivosParaSubir,
    cuotasPendientesInfo,
    creditoCanceladoInfo,
    setOpenBadDebt,
    openBadDebt,
    montoBaseBadDebt,
    handleResetCredito,
    resetBuscador,
    setResetBuscador,
    mora,
    convenioActivoInfo,
    cuotaSeleccionada,
    abonosCuota,
    permiteAbonoCapital,
  } = usePagoForm();

  const { bancos, loading: loadingBancos } = useBancos();

  // 🎯 Estado para el modal de confirmación
  const [modalConfirmacionOpen, setModalConfirmacionOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [bancoQuery, setBancoQuery] = useState("");

  const filteredBancos = useMemo(
    () =>
      bancoQuery === ""
        ? bancos
        : bancos.filter((b) =>
            b.nombre.toLowerCase().includes(bancoQuery.toLowerCase())
          ),
    [bancos, bancoQuery]
  );

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files).filter(
      (f) => f.type.startsWith("image/") || f.type === "application/pdf"
    );
    if (files.length + archivosParaSubir.length > 3) {
      toast.error("Solo puedes seleccionar hasta 3 archivos en total");
      return;
    }
    setArchivosParaSubir([...archivosParaSubir, ...files]);
  }, [archivosParaSubir, setArchivosParaSubir]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  // 🎯 Handler para abrir el modal
  const handleAbrirConfirmacion = async (e: React.MouseEvent) => {
    e.preventDefault();

    // Validar explícitamente antes de abrir el modal
    const errors = await formik.validateForm();

    if (Object.keys(errors).length > 0) {
      // Marcar todos los campos como touched para mostrar errores inline
      formik.setTouched(
        Object.keys(errors).reduce((acc, key) => ({ ...acc, [key]: true }), {})
      );

      const nombresAmigables: Record<string, string> = {
        monto_boleta: "Monto Boleta",
        fecha_boleta: "Fecha Boleta",
        banco_id: "Banco",
        numeroAutorizacion: "Número de Autorización",
        credito_id: "Crédito",
        usuario_id: "Usuario",
      };

      const errores = Object.entries(errors)
        .map(([campo, mensaje]) => {
          const nombreCampo = nombresAmigables[campo] || campo;
          return `• ${nombreCampo}: ${mensaje}`;
        })
        .join("\n");

      toast.error(`Campos con errores:\n${errores}`, {
        duration: 5000,
      });
      return;
    }

    // Abrir modal
    setModalConfirmacionOpen(true);
  };

  // 🎯 Handler para confirmar el pago
  const handleConfirmarPago = async () => {
    setModalConfirmacionOpen(false);
    // Ejecutar el submit real del formulario
    await handleFormSubmit(new Event("submit") as any);
  };

  // 🎯 Calcular datos para el modal
  
  return (
    <div className="fixed inset-x-0 top-16 xl:top-20 bottom-0 flex flex-col items-center justify-start bg-gradient-to-br from-blue-50 to-white px-4 sm:px-6 lg:px-8 overflow-auto pt-8 pb-8">
      {/* 🎯 MODAL DE CONFIRMACIÓN */}
   {/* 🎯 MODAL DE CONFIRMACIÓN - ACTUALIZADO CON INFO DE CONVENIO */}
{/* 🎯 MODAL DE CONFIRMACIÓN - SIMPLIFICADO */}
{/* 🎯 MODAL DE CONFIRMACIÓN - CON JERARQUÍA DE PAGOS */}
<Dialog open={modalConfirmacionOpen} onOpenChange={setModalConfirmacionOpen}>
  <DialogContent className="max-w-xl bg-white">
    <DialogHeader>
      <DialogTitle className={`text-2xl font-bold flex items-center gap-2 ${creditoCanceladoInfo ? "text-red-700" : "text-blue-700"}`}>
        <CheckCircle2 className="w-7 h-7" />
        {creditoCanceladoInfo ? "Confirmar Cancelacion de Credito" : "Confirmar Registro de Pago"}
      </DialogTitle>
    </DialogHeader>

    <div className="space-y-4">
      {creditoCanceladoInfo ? (
        /* MODAL DE CONFIRMACION PARA CANCELACION */
        (() => {
          const montoBoleta = Number(formik.values.monto_boleta) || 0;
          const montoCancelacion = Number(creditoCanceladoInfo.cancelacion?.monto_cancelacion) || 0;
          const incobrable = montoBaseBadDebt || 0;
          const diferencia = montoCancelacion - montoBoleta;

          return (
            <div className="bg-gradient-to-br from-red-50 to-orange-50 rounded-xl p-5 border-2 border-red-200">
              <h3 className="font-bold text-lg text-red-900 mb-4 flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Resumen de Cancelacion
              </h3>

              <div className="space-y-3">
                <div className="flex justify-between items-center py-2 px-3 border-b border-red-200">
                  <span className="text-gray-700 font-medium">Monto de Cancelacion:</span>
                  <span className="font-bold text-red-700 text-lg">Q{montoCancelacion.toFixed(2)}</span>
                </div>

                <div className="flex justify-between items-center py-2 px-3 border-b border-red-200">
                  <span className="text-gray-700 font-medium">Monto Boleta:</span>
                  <span className="font-bold text-green-700 text-lg">Q{montoBoleta.toFixed(2)}</span>
                </div>

                {incobrable > 0 && (
                  <div className="flex justify-between items-center py-2 px-3 border-b border-red-200">
                    <span className="text-gray-700 font-medium">Incobrable:</span>
                    <span className="font-bold text-yellow-700 text-lg">Q{incobrable.toFixed(2)}</span>
                  </div>
                )}

                <div className="flex justify-between items-center py-3 px-3 mt-2 bg-white/60 rounded-lg border border-red-300">
                  <span className="text-red-900 font-bold text-base">
                    {diferencia > 0 ? "Faltante:" : diferencia < 0 ? "Excedente:" : "Cubierto:"}
                  </span>
                  <span className={`font-extrabold text-xl ${diferencia > 0 ? "text-red-600" : diferencia < 0 ? "text-green-600" : "text-green-700"}`}>
                    Q{Math.abs(diferencia).toFixed(2)}
                  </span>
                </div>
              </div>

              {creditoCanceladoInfo.cancelacion?.motivo && (
                <div className="mt-4 pt-3 border-t border-red-200 text-sm text-gray-600">
                  <span className="font-semibold">Motivo:</span> {creditoCanceladoInfo.cancelacion.motivo}
                </div>
              )}
            </div>
          );
        })()
      ) : (
      /* MODAL DE CONFIRMACION PARA PAGO NORMAL */
      (() => {
        const montoBoleta = Number(formik.values.monto_boleta) || 0;
        const otros = Number(formik.values.otros) || 0;
        const moraMonto = mora || 0;
        const cuotaConvenio = Number(convenioActivoInfo?.cuotaConvenioAPagar) || 0;
        const saldoAFavor = Number(dataCredito?.usuario?.saldo_a_favor) || 0;

        // Total disponible = Boleta + Saldo a Favor
        let montoRestante = montoBoleta;

        const distribucion: { concepto: string; monto: number }[] = [];

        // 1 Otros
        if (otros > 0) {
          const montoOtros = Math.min(montoRestante, otros);
          montoRestante -= montoOtros;
          distribucion.push({
            concepto: "1. Otros",
            monto: montoOtros,
          });
        }

        // 2 Mora
        if (moraMonto > 0) {
          const montoMora = Math.min(montoRestante, moraMonto);
          montoRestante -= montoMora;
          distribucion.push({
            concepto: "2. Mora",
            monto: montoMora,
          });
        }

        // 3 Convenio
        if (cuotaConvenio > 0) {
          const montoConv = Math.min(montoRestante, cuotaConvenio);
          montoRestante -= montoConv;
          distribucion.push({
            concepto: "3. Cuota Convenio",
            monto: montoConv,
          });
        }

        // 4 Cuota Normal (restando abonos ya realizados desde endpoint)
        const cuotaBase = Number(dataCredito?.credito?.cuota) || 0;
        const abonosYaHechos = abonosCuota ? (
          Number(abonosCuota.abono_capital || 0) +
          Number(abonosCuota.abono_interes || 0) +
          Number(abonosCuota.abono_iva_12 || 0) +
          Number(abonosCuota.abono_seguro || 0) +
          Number(abonosCuota.abono_gps || 0) +
          Number(abonosCuota.membresias_pago || 0)
        ) : 0;
        const cuotaNormal = Math.max(0, cuotaBase - abonosYaHechos);
        if (cuotaNormal > 0 && montoRestante > 0) {
          const montoCuota = Math.min(montoRestante, cuotaNormal);
          montoRestante -= montoCuota;
          distribucion.push({
            concepto: `4. Cuota #${cuotaSeleccionada || "?"}`,
            monto: montoCuota,
          });
        }

        return (
          <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-5 border-2 border-green-200">
            <h3 className="font-bold text-lg text-green-900 mb-4 flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Distribucion del Pago
            </h3>

            <div className="space-y-3">
              {distribucion.map((item, idx) => (
                <div
                  key={idx}
                  className="flex justify-between items-center py-2 px-3 border-b border-green-200 last:border-0"
                >
                  <span className="text-gray-700 font-medium">
                    {item.concepto}
                  </span>
                  <span className="font-bold text-green-700 text-lg">
                    Q{item.monto.toFixed(2)}
                  </span>
                </div>
              ))}

              {montoRestante > 0.01 && (
                <div className="flex flex-col gap-2 py-3 mt-2 bg-gradient-to-r from-yellow-50 to-amber-50 px-4 rounded-lg border-2 border-yellow-300">
                  <div className="flex justify-between items-center">
                    <span className="text-yellow-800 font-bold flex items-center gap-2">
                      <span className="text-xl">!</span>
                      Excedente (nuevo saldo a favor):
                    </span>
                    <span className="font-bold text-yellow-700 text-xl">
                      Q{montoRestante.toFixed(2)}
                    </span>
                  </div>
                  <p className="text-xs text-yellow-700 italic">
                    Este monto se guardara como saldo a favor para futuros pagos
                  </p>
                </div>
              )}
            </div>

          <div className="mt-4 pt-4 border-t-2 border-green-300 space-y-2">
  <div className="flex justify-between items-center text-sm">
    <span className="text-gray-700 font-medium">
      Boleta:
    </span>
    <span className="text-gray-800 font-bold">
      Q{Number(montoBoleta).toFixed(2)}
    </span>
  </div>

  {saldoAFavor > 0 && (
    <div className="flex justify-between items-center text-sm">
      <span className="text-purple-600 font-medium">
        + Saldo a Favor:
      </span>
      <span className="text-purple-700 font-bold">
        Q{Number(saldoAFavor).toFixed(2)}
      </span>
    </div>
  )}

  {otros > 0 && (
    <div className="flex justify-between items-center text-sm">
      <span className="text-gray-600 font-medium">
        - Otros:
      </span>
      <span className="text-gray-700 font-bold">
        Q{Number(otros).toFixed(2)}
      </span>
    </div>
  )}

  {moraMonto > 0 && (
    <div className="flex justify-between items-center text-sm">
      <span className="text-gray-600 font-medium">
        - Mora:
      </span>
      <span className="text-gray-700 font-bold">
        Q{Number(moraMonto).toFixed(2)}
      </span>
    </div>
  )}

  {cuotaConvenio > 0 && (
    <div className="flex justify-between items-center text-sm">
      <span className="text-gray-600 font-medium">
        - Cuota Convenio:
      </span>
      <span className="text-gray-700 font-bold">
        Q{Number(cuotaConvenio).toFixed(2)}
      </span>
    </div>
  )}

  <div className="flex justify-between items-center text-base pt-2 border-t border-green-200">
    <span className="text-green-900 font-bold">
      = Total Disponible:
    </span>
    <span className="text-green-700 font-extrabold text-xl">
      Q{(Number(montoBoleta) + Number(saldoAFavor)).toFixed(2)}
    </span>
  </div>
</div>
          </div>
        );
      })()
      )}
    </div>

    <DialogFooter className="gap-2 mt-6">
      <Button
        variant="outline"
        onClick={() => setModalConfirmacionOpen(false)}
        className="px-6 py-2 text-base bg-gray-500 hover:bg-gray-600 text-white border-gray-500"
      >
        Cancelar
      </Button>
      <Button
        onClick={handleConfirmarPago}
        disabled={formik.isSubmitting}
        className={`px-8 py-2 text-base font-bold ${creditoCanceladoInfo ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"}`}
      >
        {formik.isSubmitting ? "Procesando..." : creditoCanceladoInfo ? "Confirmar Cancelacion" : "Confirmar Pago"}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
      {/* Resto de tus modales existentes */}
      <OpcionesExcesoModal
        open={modalExcesoOpen}
        mode={modalMode}
        onClose={() => setModalExcesoOpen(false)}
        onAbonoCapital={permiteAbonoCapital || !(cuotasAtrasadasInfo && cuotasAtrasadasInfo.total > 0) ? handleAbonoCapital : undefined}
        onAbonoSiguienteCuota={handleAbonoSiguienteCuota}
        excedente={excedente}
        onAbonoOtros={handleAbonoOtros}
        cuotaNumero={cuotaActualInfo?.numero}
      />
      <ModalBadDebtCredit
        open={openBadDebt}
        onClose={() => setOpenBadDebt(false)}
        creditId={creditoCanceladoInfo?.credito.credito_id || 0}
        montoBase={montoBaseBadDebt}
        onSuccess={async () => {
          setOpenBadDebt(false);
          await handleResetCredito();
        }}
      />

      <h1 className="text-4xl font-extrabold text-blue-700 text-center mb-6 drop-shadow-md w-full">
        Registro de Pago
      </h1>

      <Card className="w-full max-w-[900px] mx-2 flex flex-col shadow-2xl border-2 border-blue-100 rounded-3xl bg-white/90 backdrop-blur-sm">
        <CardHeader className="pb-0 flex flex-col items-center gap-2">
          <span className="flex items-center justify-center bg-blue-100 rounded-full w-14 h-14 mb-1 shadow">
            <DollarSign className="text-blue-600 w-9 h-9" />
          </span>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col items-center justify-center">
          <div className="mb-4 flex gap-2 items-center">
            <BuscadorUsuarioSifco
              onSelect={(sifco) => fetchCredito(sifco)}
              reset={resetBuscador}
              onReset={() => setResetBuscador(false)}
            />
          </div>

          {creditoCanceladoInfo ? (
            <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-xl mb-4 flex gap-3 items-start shadow">
              <span className="mt-1 text-yellow-500">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 16h-1v-4h-1m1-4h.01M12 18a6 6 0 100-12 6 6 0 000 12z"
                  />
                </svg>
              </span>
              <div>
                <div className="font-semibold text-yellow-800 text-lg mb-1">
                  Este crédito fue <span className="font-bold">CANCELADO</span>
                </div>
                <div className="text-yellow-900 text-sm">
                  <div>
                    <span className="font-bold">Motivo:</span>{" "}
                    {creditoCanceladoInfo.cancelacion?.motivo ||
                      "No especificado"}
                  </div>
                  <div>
                    <span className="font-bold">Fecha de cancelación:</span>{" "}
                    {creditoCanceladoInfo.cancelacion?.fecha_cancelacion
                      ? new Date(
                          creditoCanceladoInfo.cancelacion.fecha_cancelacion
                        ).toLocaleDateString()
                      : "No indicada"}
                  </div>
                  <div>
                    <span className="font-bold">Monto de cancelación:</span> Q
                    {creditoCanceladoInfo.cancelacion?.monto_cancelacion ||
                      "0.00"}
                  </div>
                  {creditoCanceladoInfo.cancelacion?.observaciones && (
                    <div>
                      <span className="font-bold">Observaciones:</span>{" "}
                      {creditoCanceladoInfo.cancelacion.observaciones}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            dataCredito?.credito &&
            dataCredito?.usuario && (
              <MiniCardCredito
                credito={dataCredito.credito}
                usuario={dataCredito.usuario}
                cuotaActual={cuotaActualInfo?.numero || 0}
                cuotaActualPagada={cuotaActualInfo?.pagada}
                cuotaActualStatus={cuotaActualInfo?.validationStatus}
                cuotasAtrasadasInfo={cuotasAtrasadasInfo ?? { cuotas: [] }}
                onCuotaSeleccionadaChange={setCuotaSeleccionada}
                cuotasPendientesInfo={cuotasPendientesInfo ?? { cuotas: [] }}
                mora={mora || 0}
                convenioActivoInfo={convenioActivoInfo}
                cuotaMensualAPagar={dataCredito.cuotaMensualAPagar}
                abonosParciales={(() => {
                  if (!abonosCuota) return null;
                  const abono_capital = Number(abonosCuota.abono_capital || 0);
                  const abono_interes = Number(abonosCuota.abono_interes || 0);
                  const abono_iva_12 = Number(abonosCuota.abono_iva_12 || 0);
                  const abono_seguro = Number(abonosCuota.abono_seguro || 0);
                  const abono_gps = Number(abonosCuota.abono_gps || 0);
                  const abono_membresias = Number(abonosCuota.membresias_pago || 0);
                  const total = abono_capital + abono_interes + abono_iva_12 + abono_seguro + abono_gps + abono_membresias;
                  if (total === 0) return null;
                  return { abono_capital, abono_interes, abono_iva_12, abono_seguro, abono_gps, abono_membresias, total };
                })()}
              />
            )
          )}
          {errorCredito && (
            <div className="text-red-500 mb-2">{errorCredito}</div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleAbrirConfirmacion(e as any);
            }}
            className="flex-1 flex flex-col gap-5 w-full"
            style={{ minHeight: 0 }}
          >
            {/* === SECCIÓN: MONTO === */}
            <div className="rounded-xl border border-blue-100 bg-blue-50/30 p-4 space-y-4">
              <h3 className="text-sm font-bold text-blue-700 uppercase tracking-wide flex items-center gap-2">
                <DollarSign className="w-4 h-4" />
                Monto del Pago
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <Label className="text-gray-700 font-semibold text-sm">
                    Monto Boleta <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="monto_boleta"
                    name="monto_boleta"
                    type="number"
                    value={formik.values.monto_boleta ?? ""}
                    onChange={formik.handleChange}
                    onBlur={formik.handleBlur}
                    className={`border rounded-lg px-3 py-2.5 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white ${
                      formik.errors.monto_boleta && formik.touched.monto_boleta
                        ? "border-red-500 focus:ring-red-500"
                        : "border-gray-300"
                    }`}
                  />
                  {formik.errors.monto_boleta && formik.touched.monto_boleta && (
                    <div className="text-red-500 text-xs mt-0.5">{formik.errors.monto_boleta}</div>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-gray-700 font-semibold text-sm">
                    Otros (Opcional)
                  </Label>
                  <Input
                    id="otros"
                    name="otros"
                    type="number"
                    value={formik.values.otros ?? ""}
                    onChange={formik.handleChange}
                    onBlur={formik.handleBlur}
                    className="border rounded-lg px-3 py-2.5 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white border-gray-300"
                  />
                </div>
              </div>
            </div>

            {/* === SECCIÓN: DATOS BANCARIOS === */}
            <div className="rounded-xl border border-green-100 bg-green-50/30 p-4 space-y-4">
              <h3 className="text-sm font-bold text-green-700 uppercase tracking-wide flex items-center gap-2">
                <Building2 className="w-4 h-4" />
                Datos Bancarios
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <Label className="text-gray-700 font-semibold text-sm">
                    Banco <span className="text-red-500">*</span>
                  </Label>
                  <Combobox
                    value={formik.values.banco_id ?? ""}
                    onChange={(value: any) => {
                      formik.setFieldValue("banco_id", Number(value));
                      formik.setFieldTouched("banco_id", true, false);
                      setBancoQuery("");
                    }}
                    disabled={loadingBancos}
                  >
                    <div className="relative">
                      <div className="relative w-full">
                        <Combobox.Input
                          className={`w-full border rounded-lg pl-3 pr-10 py-2.5 text-gray-900 bg-white font-medium focus:ring-2 focus:ring-blue-400 focus:border-blue-500 focus:outline-none placeholder:text-gray-400 transition-all shadow-sm ${
                            formik.errors.banco_id && formik.touched.banco_id && !formik.values.banco_id
                              ? "border-red-500"
                              : "border-gray-300"
                          }`}
                          displayValue={(id: any) =>
                            id === ""
                              ? ""
                              : bancos.find((b) => b.banco_id === id)?.nombre || ""
                          }
                          onChange={(e) => setBancoQuery(e.target.value)}
                          onFocus={(e) => e.target.select()}
                          placeholder="Buscar banco..."
                        />
                        <Combobox.Button className="absolute inset-y-0 right-0 flex items-center pr-3">
                          <ChevronsUpDown className="h-5 w-5 text-gray-400 hover:text-gray-600 transition-colors" />
                        </Combobox.Button>
                      </div>
                      <Transition
                        as={Fragment as any}
                        leave="transition ease-in duration-100"
                        leaveFrom="opacity-100"
                        leaveTo="opacity-0"
                        afterLeave={() => setBancoQuery("")}
                      >
                        <Combobox.Options className="absolute z-50 mt-2 w-full max-h-60 overflow-auto rounded-xl bg-white py-2 shadow-2xl border-2 border-blue-200 focus:outline-none">
                          {filteredBancos.length === 0 && bancoQuery !== "" ? (
                            <div className="relative cursor-default select-none py-4 px-4 text-center text-gray-500 text-sm">
                              No se encontró banco
                            </div>
                          ) : (
                            filteredBancos.map((banco) => (
                              <Combobox.Option
                                key={banco.banco_id}
                                value={banco.banco_id}
                                className={({ active, selected }) =>
                                  `relative cursor-pointer select-none py-2.5 pl-10 pr-4 transition-colors ${
                                    active
                                      ? "bg-blue-50 text-blue-900"
                                      : selected
                                        ? "bg-blue-50 text-blue-900"
                                        : "bg-white text-gray-700 hover:bg-gray-50"
                                  }`
                                }
                              >
                                {({ selected }) => (
                                  <>
                                    <span className={`block truncate ${selected ? "font-bold" : "font-medium"}`}>
                                      {banco.nombre}
                                    </span>
                                    {selected && (
                                      <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-green-600">
                                        <Check className="h-5 w-5" />
                                      </span>
                                    )}
                                  </>
                                )}
                              </Combobox.Option>
                            ))
                          )}
                        </Combobox.Options>
                      </Transition>
                    </div>
                  </Combobox>
                  {formik.errors.banco_id && formik.touched.banco_id && !formik.values.banco_id && (
                    <div className="text-red-500 text-xs mt-0.5">{formik.errors.banco_id}</div>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-gray-700 font-semibold text-sm">
                    Origen de Pago <span className="text-red-500">*</span>
                  </Label>
                  <Select
                    value={formik.values.origen_pago || undefined}
                    onValueChange={(value) => {
                      formik.setFieldValue("origen_pago", value);
                      formik.setFieldTouched("origen_pago", true, false);
                    }}
                  >
                    <SelectTrigger className={`w-full border rounded-lg px-3 py-2.5 text-gray-900 bg-white [&>span]:text-gray-900 ${
                      formik.errors.origen_pago && formik.touched.origen_pago && !formik.values.origen_pago
                        ? "border-red-500"
                        : "border-gray-300"
                    }`}>
                      <SelectValue placeholder="Seleccionar origen..." />
                    </SelectTrigger>
                    <SelectContent className="bg-white border border-gray-200 shadow-lg">
                      <SelectItem value="transferencia" className="text-gray-900 hover:bg-blue-50 cursor-pointer">Transferencia</SelectItem>
                      <SelectItem value="cheque" className="text-gray-900 hover:bg-blue-50 cursor-pointer">Cheque</SelectItem>
                      <SelectItem value="boleta" className="text-gray-900 hover:bg-blue-50 cursor-pointer">Boleta</SelectItem>
                    </SelectContent>
                  </Select>
                  {formik.errors.origen_pago && formik.touched.origen_pago && !formik.values.origen_pago && (
                    <div className="text-red-500 text-xs mt-0.5">{formik.errors.origen_pago}</div>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-gray-700 font-semibold text-sm">
                    No. Autorización (Opcional)
                  </Label>
                  <Input
                    id="numeroAutorizacion"
                    name="numeroAutorizacion"
                    type="text"
                    value={formik.values.numeroAutorizacion ?? ""}
                    onChange={formik.handleChange}
                    onBlur={formik.handleBlur}
                    placeholder="Ej: 123456789"
                    className={`border rounded-lg px-3 py-2.5 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white ${
                      formik.errors.numeroAutorizacion && formik.touched.numeroAutorizacion
                        ? "border-red-500 focus:ring-red-500"
                        : "border-gray-300"
                    }`}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-gray-700 font-semibold text-sm">
                    Fecha Boleta <span className="text-red-500">*</span>
                  </Label>
                  <DatePickerMUI
                    value={formik.values.fecha_boleta}
                    onChange={(value) => {
                      formik.setFieldValue("fecha_boleta", value);
                      formik.setFieldTouched("fecha_boleta", true, false);
                    }}
                  />
                  {formik.errors.fecha_boleta && formik.touched.fecha_boleta && formik.values.fecha_boleta === "" && (
                    <div className="text-red-500 text-xs mt-0.5">{formik.errors.fecha_boleta}</div>
                  )}
                </div>
              </div>
            </div>

            {/* === SECCIÓN: OBSERVACIONES === */}
            <div className="rounded-xl border border-gray-100 bg-gray-50/30 p-4 space-y-4">
              <h3 className="text-sm font-bold text-gray-600 uppercase tracking-wide flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Observaciones y Archivos
              </h3>
              <div className="flex flex-col gap-1">
                <Label className="text-gray-700 font-semibold text-sm">
                  Observaciones (Opcional)
                </Label>
                <Input
                  id="observaciones"
                  name="observaciones"
                  type="text"
                  value={formik.values.observaciones ?? ""}
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  placeholder="Notas adicionales..."
                  className="border rounded-lg px-3 py-2.5 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white border-gray-300"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-gray-700 font-semibold text-sm">
                  Boletas / Comprobantes
                </Label>
                <label
                  htmlFor="boleta-upload"
                  className={`flex items-center justify-center gap-2 w-full border-2 border-dashed rounded-lg px-4 py-3 cursor-pointer transition text-sm ${
                    isDragging
                      ? "border-blue-500 bg-blue-50 text-blue-600"
                      : "border-gray-300 hover:border-blue-400 hover:bg-blue-50/50 text-gray-500"
                  }`}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                >
                  <Info className="w-4 h-4" />
                  {isDragging
                    ? "Suelta los archivos aquí"
                    : "Haz clic o arrastra archivos aquí (max. 3)"}
                </label>
                <input
                  id="boleta-upload"
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    if (files.length + archivosParaSubir.length > 3) {
                      toast.error("Solo puedes seleccionar hasta 3 archivos en total");
                      return;
                    }
                    setArchivosParaSubir([...archivosParaSubir, ...files]);
                    e.target.value = "";
                  }}
                />
                {archivosParaSubir.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {archivosParaSubir.map((file, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1.5 bg-green-50 border border-green-200 text-green-800 text-xs font-medium px-2.5 py-1 rounded-full"
                      >
                        <FileText className="w-3 h-3" />
                        {file.name}
                        <button
                          type="button"
                          className="text-red-500 hover:text-red-700 ml-1 font-bold"
                          onClick={() => {
                            setArchivosParaSubir(
                              archivosParaSubir.filter((_, idx) => idx !== i)
                            );
                          }}
                        >
                          x
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <Button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-4 rounded-xl text-xl shadow-lg transition"
              disabled={formik.isSubmitting}
            >
              {formik.isSubmitting ? "Registrando..." : "Registrar Pago"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}