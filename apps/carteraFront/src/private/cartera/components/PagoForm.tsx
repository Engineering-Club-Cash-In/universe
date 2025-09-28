import { usePagoForm } from "../hooks/registerPayment";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DollarSign, Percent, Info } from "lucide-react"; 
import { MiniCardCredito } from "./cardInfo";
import { OpcionesExcesoModal } from "./excessModal";
import { ModalBadDebtCredit } from "./ModalBadDebtCredit";
import { BuscadorUsuarioSifco } from "./searchByNameSifco";

const fields = [
  {
    name: "monto_boleta",
    label: "Monto Boleta",
    type: "number",
    icon: <DollarSign className="text-blue-500 mr-2 w-5 h-5" />,
  },

  {
    name: "otros",
    label: "Otros",
    type: "number",
    icon: <Info className="text-blue-500 mr-2 w-5 h-5" />,
  },
  {
    name: "mora",
    label: "Mora",
    type: "number",
    icon: <Percent className="text-blue-500 mr-2 w-5 h-5" />,
  },
  {
    name: "observaciones",
    label: "Observaciones",
    type: "text",
    icon: <Percent className="text-blue-500 mr-2 w-5 h-5" />,
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
    handleAbonoMora,
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
    setResetBuscador
  } = usePagoForm();
 
  return (
<div className="fixed inset-0 flex flex-col items-center justify-start bg-gradient-to-br from-blue-50 to-white px-2 overflow-auto pt-8 pb-8">


      <OpcionesExcesoModal
        open={modalExcesoOpen}
        mode={modalMode} // "excedente" o "pagada"
        onClose={() => setModalExcesoOpen(false)}
        onAbonoCapital={handleAbonoCapital}
        onAbonoSiguienteCuota={handleAbonoSiguienteCuota}
        onAbonoMora={handleAbonoMora}
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
          // Puedes hacer un refetch o lo que necesites aquí
        }}
      />
  <h1 className="text-4xl font-extrabold text-blue-700 text-center mb-6 drop-shadow-md w-full">
    Registro de Pago
  </h1>
      <Card
        className="
          w-full max-w-[900px]
          mx-2
          flex flex-col
          shadow-2xl
          border-2 border-blue-100
          rounded-3xl
          bg-white/90
          backdrop-blur-sm
        "
      >
        {/* Ícono flotando centrado */}
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
          {/* --- MINICARD --- */}

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
                cuotasAtrasadasInfo={cuotasAtrasadasInfo ?? { cuotas: [] }}
                onCuotaSeleccionadaChange={setCuotaSeleccionada}
                cuotasPendientesInfo={cuotasPendientesInfo ?? { cuotas: [] }}
              />
            )
          )}
          {errorCredito && (
            <div className="text-red-500 mb-2">{errorCredito}</div>
          )}
          <form
            onSubmit={handleFormSubmit}
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
                    <span>{field.label}</span>
                  </Label>
                  {field.name === "renuevo_o_nuevo" ? (
                    <select
                      id={field.name}
                      name={field.name}
                      value={
                        formik.values[
                          field.name as keyof typeof formik.values
                        ] ?? ""
                      }
                      onChange={formik.handleChange}
                      onBlur={formik.handleBlur}
                      className={[
                        "w-full max-w-full border rounded-lg px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg bg-white/70",
                        formik.errors[
                          field.name as keyof typeof formik.values
                        ] &&
                        formik.touched[field.name as keyof typeof formik.values]
                          ? "border-red-500 focus:ring-red-500"
                          : "border-gray-300",
                      ].join(" ")}
                    >
                      <option value="">Seleccione una opción</option>
                      <option value="Renuevo">Renuevo</option>
                      <option value="Nuevo">Nuevo</option>
                    </select>
                  ) : (
                    <Input
                      id={field.name}
                      name={field.name}
                      type={field.type}
                      value={
                        formik.values[
                          field.name as keyof typeof formik.values
                        ] ?? ""
                      }
                      onChange={formik.handleChange}
                      onBlur={formik.handleBlur}
                      className={[
                        "w-full max-w-full border rounded-lg px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg bg-white/70",
                        formik.errors[
                          field.name as keyof typeof formik.values
                        ] &&
                        formik.touched[field.name as keyof typeof formik.values]
                          ? "border-red-500 focus:ring-red-500"
                          : "border-gray-300",
                      ].join(" ")}
                    />
                  )}
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
            </div>
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
                    // Limita el total a 3 archivos
                    if (files.length + archivosParaSubir.length > 3) {
                      alert(
                        "Solo puedes seleccionar hasta 3 archivos en total."
                      );
                      return;
                    }
                    setArchivosParaSubir([...archivosParaSubir, ...files]);
                    e.target.value = ""; // Permite volver a elegir el mismo archivo si se borra
                  }}
                />
              </div>
              {/* Mostrar archivos pendientes para subir */}
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

            <Button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-5 px-4 rounded-xl text-2xl shadow transition"
              disabled={formik.isSubmitting}
              onClick={(e) => {
                // Detener el submit si hay errores
                if (!formik.isValid && Object.keys(formik.errors).length > 0) {
                  e.preventDefault();
                  // Crea un mensaje bonito con todos los errores
                  const errores = Object.entries(formik.errors)
                    .map(([campo, mensaje]) => `• ${campo}: ${mensaje}`)
                    .join("\n");
                  alert(
                    `Por favor revisa los siguientes errores antes de continuar:\n\n${errores}`
                  );
                }
              }}
            >
              {formik.isSubmitting ? "Registrando..." : "Registrar Pago"}
            </Button>
            {/* Resumen */}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
