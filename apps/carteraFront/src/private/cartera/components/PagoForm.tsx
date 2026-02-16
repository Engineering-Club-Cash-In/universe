/* eslint-disable @typescript-eslint/no-explicit-any */
import { usePagoForm } from "../hooks/registerPayment";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DollarSign, Percent, Info, FileText, Building2, CheckCircle2, Calendar } from "lucide-react";
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
import { useState } from "react";
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
  } = usePagoForm();

  const { bancos, loading: loadingBancos } = useBancos();

  // 🎯 Estado para el modal de confirmación
  const [modalConfirmacionOpen, setModalConfirmacionOpen] = useState(false);

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
      <DialogTitle className="text-2xl font-bold text-blue-700 flex items-center gap-2">
        <CheckCircle2 className="w-7 h-7" />
        Confirmar Registro de Pago
      </DialogTitle>
    </DialogHeader>

    <div className="space-y-4">
      {/* 🎯 DISTRIBUCIÓN DEL PAGO */}
      {(() => {
        const montoBoleta = Number(formik.values.monto_boleta) || 0;
        const otros = Number(formik.values.otros) || 0;
        const moraMonto = mora || 0;
        const cuotaConvenio = Number(convenioActivoInfo?.cuotaConvenioAPagar) || 0;
        const saldoAFavor = Number(dataCredito?.usuario?.saldo_a_favor) || 0;
        
        // 🔥 Total disponible = Boleta + Saldo a Favor
        let montoRestante = montoBoleta;
        
        const distribucion: { concepto: string; monto: number }[] = [];

        // 1️⃣ Otros
        if (otros > 0) {
          const montoOtros = Math.min(montoRestante, otros);
          montoRestante -= montoOtros;
          distribucion.push({
            concepto: "1. Otros",
            monto: montoOtros,
          });
        }

        // 2️⃣ Mora
        if (moraMonto > 0) {
          const montoMora = Math.min(montoRestante, moraMonto);
          montoRestante -= montoMora;
          distribucion.push({
            concepto: "2. Mora",
            monto: montoMora,
          });
        }

        // 3️⃣ Convenio
        if (cuotaConvenio > 0) {
          const montoConv = Math.min(montoRestante, cuotaConvenio);
          montoRestante -= montoConv;
          distribucion.push({
            concepto: "3. Cuota Convenio",
            monto: montoConv,
          });
        }

        // 4️⃣ Cuota Normal
        const cuotaNormal = Number(dataCredito?.credito?.cuota) || 0;
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
              Distribución del Pago
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
              
              {/* 💡 EXCEDENTE */}
              {montoRestante > 0.01 && (
                <div className="flex flex-col gap-2 py-3 mt-2 bg-gradient-to-r from-yellow-50 to-amber-50 px-4 rounded-lg border-2 border-yellow-300">
                  <div className="flex justify-between items-center">
                    <span className="text-yellow-800 font-bold flex items-center gap-2">
                      <span className="text-xl">💡</span>
                      Excedente (nuevo saldo a favor):
                    </span>
                    <span className="font-bold text-yellow-700 text-xl">
                      Q{montoRestante.toFixed(2)}
                    </span>
                  </div>
                  <p className="text-xs text-yellow-700 italic">
                    Este monto se guardará como saldo a favor para futuros pagos
                  </p>
                </div>
              )}
            </div>

            {/* 📊 FÓRMULA: Boleta + Saldo - Conceptos = Disponible */}
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
      })()}
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
        className="bg-blue-600 hover:bg-blue-700 px-8 py-2 text-base font-bold"
      >
        {formik.isSubmitting ? "Procesando..." : "✓ Confirmar Pago"}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
      {/* Resto de tus modales existentes */}
      <OpcionesExcesoModal
        open={modalExcesoOpen}
        mode={modalMode}
        onClose={() => setModalExcesoOpen(false)}
        onAbonoCapital={cuotasAtrasadasInfo && cuotasAtrasadasInfo.total > 0 ? undefined : handleAbonoCapital}
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
                  const data = cuotaActualInfo?.data;
                  if (!data) return null;
                  const abono_capital = Number(data.abono_capital || 0);
                  const abono_interes = Number(data.abono_interes || 0);
                  const abono_iva_12 = Number(data.abono_iva_12 || 0);
                  const abono_seguro = Number(data.abono_seguro || 0);
                  const abono_gps = Number(data.abono_gps || 0);
                  const abono_membresias = Number(data.membresias_pago || 0);
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {fields.map((field) => (
                <div
                  key={field.name}
                  className="min-h-[92px] flex flex-col justify-end w-full"
                >
                  <Label
                    className={`text-gray-900 font-semibold mb-1 flex items-center text-lg ${
                      field.name === "observaciones"
                        ? "flex-col items-start gap-0"
                        : ""
                    }`}
                  >
                    {field.icon}
                    <span>
                      {field.label}
                      {field.required && <span className="text-red-500 ml-1">*</span>}
                    </span>
                  </Label>
                  <Input
                    id={field.name}
                    name={field.name}
                    type={field.type}
                    value={
                      formik.values[field.name as keyof typeof formik.values] ??
                      ""
                    }
                    onChange={formik.handleChange}
                    onBlur={formik.handleBlur}
                    className={[
                      "w-full max-w-full border rounded-lg px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg bg-white/70",
                      formik.errors[field.name as keyof typeof formik.values] &&
                      formik.touched[field.name as keyof typeof formik.values]
                        ? "border-red-500 focus:ring-red-500"
                        : "border-gray-300",
                    ].join(" ")}
                  />
                  {formik.errors[field.name as keyof typeof formik.values] &&
                    formik.touched[
                      field.name as keyof typeof formik.values
                    ] && (
                      <div className="text-red-500 text-sm mt-1">
                        {
                          formik.errors[
                            field.name as keyof typeof formik.values
                          ]
                        }
                      </div>
                    )}
                </div>
              ))}

              {/* Campo Banco */}
              <div className="min-h-[92px] flex flex-col justify-end w-full">
                <Label className="text-gray-900 font-semibold mb-1 flex items-center text-lg">
                  <Building2 className="text-blue-500 mr-2 w-5 h-5" />
                  <span>Banco <span className="text-red-500">*</span></span>
                </Label>
                <Select
                  value={formik.values.banco_id?.toString() || ""}
                  onValueChange={(value) => {
                    formik.setFieldValue("banco_id", Number(value));
                    formik.setFieldTouched("banco_id", true, false);
                  }}
                  disabled={loadingBancos}
                >
                  <SelectTrigger className={`w-full border rounded-lg px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg bg-white [&>span]:text-gray-900 ${
                    formik.errors.banco_id && formik.touched.banco_id && !formik.values.banco_id
                      ? "border-red-500 focus:ring-red-500"
                      : "border-gray-300"
                  }`}>
                    <SelectValue
                      placeholder="Selecciona un banco"
                      className="text-gray-900"
                    />
                  </SelectTrigger>
                  <SelectContent className="bg-white border border-gray-200 shadow-lg">
                    {bancos.map((banco) => (
                      <SelectItem
                        key={banco.banco_id}
                        value={banco.banco_id.toString()}
                        className="text-gray-900 hover:bg-blue-50 cursor-pointer"
                      >
                        {banco.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {formik.errors.banco_id && formik.touched.banco_id && !formik.values.banco_id && (
                  <div className="text-red-500 text-sm mt-1">
                    {formik.errors.banco_id}
                  </div>
                )}
              </div> 
              {/* Campo Número de Autorización */}
              <div className="min-h-[92px] flex flex-col justify-end w-full">
                <Label className="text-gray-900 font-semibold mb-1 flex items-center text-lg">
                  <FileText className="text-blue-500 mr-2 w-5 h-5" />
                  <span>Número de Autorización (Opcional)</span>
                </Label>
                <Input
                  id="numeroAutorizacion"
                  name="numeroAutorizacion"
                  type="text"
                  value={formik.values.numeroAutorizacion ?? ""}
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  placeholder="Ej: 123456789"
                  className={`w-full max-w-full border rounded-lg px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg bg-white/70 ${
                    formik.errors.numeroAutorizacion && formik.touched.numeroAutorizacion
                      ? "border-red-500 focus:ring-red-500"
                      : "border-gray-300"
                  }`}
                />
                {formik.errors.numeroAutorizacion &&
                  formik.touched.numeroAutorizacion && (
                    <div className="text-red-500 text-sm mt-1">
                      {formik.errors.numeroAutorizacion}
                    </div>
                  )}
              </div>

              {/* Fecha Boleta */}
              <div className="min-h-[92px] flex flex-col justify-end w-full">
                <Label className="text-gray-900 font-semibold mb-1 flex items-center text-lg">
                  <Calendar className="text-blue-500 mr-2 w-5 h-5" />
                  <span>Fecha Boleta <span className="text-red-500">*</span></span>
                </Label>
                <DatePickerMUI
                  value={formik.values.fecha_boleta}
                  onChange={(value) => {
                    formik.setFieldValue("fecha_boleta", value);
                    formik.setFieldTouched("fecha_boleta", true, false);
                  }}
                />
                {formik.errors.fecha_boleta && formik.touched.fecha_boleta && formik.values.fecha_boleta === "" && (
                  <div className="text-red-500 text-sm mt-1">
                    {formik.errors.fecha_boleta}
                  </div>
                )}
              </div>
            </div>
 {/* Boletas */}
            <div className="flex flex-col gap-1 mb-2">
              <Label className="text-gray-900 font-semibold mb-1 flex items-center text-lg">
                <Info className="text-blue-500 mr-2 w-5 h-5" />
                <span>Boletas / Comprobantes</span>
              </Label>
              <div className="relative flex items-center">
                <input
                  id="boleta-upload"
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  className="w-full"
                  style={{ minHeight: 44 }}
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
              </div>

              {archivosParaSubir.length > 0 && (
                <ul className="mt-2 text-xs text-green-700 space-y-1">
                  {archivosParaSubir.map((file, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span>{file.name}</span>
                      <button
                        type="button"
                        className="text-red-600 hover:underline"
                        onClick={() => {
                          setArchivosParaSubir(
                            archivosParaSubir.filter((_, idx) => idx !== i)
                          );
                        }}
                      >
                        Quitar
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <span className="text-xs text-gray-500 mt-1">
                Puedes subir hasta 3 archivos de boleta.
              </span>
            </div>

            {/* 🎯 BOTÓN MODIFICADO - Ahora abre el modal */}
            <Button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-5 px-4 rounded-xl text-2xl shadow transition"
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