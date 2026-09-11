// src/components/PaymentAgreements/CreatePaymentAgreementForm.tsx
//
// CB-032: esta pantalla dejó de CREAR convenios. Los convenios se crean desde
// la Ficha 360 del CRM de cobros (botón "Promesa / Convenio"), que llama al
// mismo servicio de cartera-back (POST /payment-agreements — el servicio y el
// hook useCreatePaymentAgreement siguen existiendo tal cual). Acá solo se
// consulta el convenio vigente de un crédito.
//
// CB-033: aprobar/rechazar un convenio ya no se hace desde carteraFront — lo
// decide el supervisor desde el CRM (/cobros/convenios), donde la decisión
// queda auditada con motivo, identidad e idempotencia.

import { useMemo, useState } from "react";

import { Card } from "@/components/ui/card";
import {
  FileText,
  User,
  CreditCard,
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useCreditoBySifco } from "../hooks/paymentagreement";
import { BuscadorUsuarioSifco } from "./searchByNameSifco";

export function CreatePaymentAgreementForm() {
  const [sifcoSeleccionado, setSifcoSeleccionado] = useState<string>("");
  const [resetBuscador, setResetBuscador] = useState(false);
  const [convenioExpanded, setConvenioExpanded] = useState(true);
  

  // Get credit data
  const {
    data: creditData,
    isLoading: loadingCredit,
    error,
  } = useCreditoBySifco(sifcoSeleccionado);

  // 🔥 TYPE NARROWING: Separar data según flujo
  const activoData = creditData?.flujo === "ACTIVO" ? creditData : null;
  const canceladoData = creditData?.flujo === "CANCELADO" ? creditData : null;
 
  const hasActiveAgreement = activoData?.credito?.statusCredit === "EN_CONVENIO";

  // `cuotasAtrasadas` y `cuotasPendientes` son FILAS de un join contra
  // pagos_credito (controllers/credits.ts), no cuotas únicas, así que `.length`
  // no cuenta cuotas:
  //   1. una cuota con varios pagos aparece repetida (el join es 1:N), y
  //   2. `cuotasPendientes` no filtra por fecha de vencimiento, así que una
  //      cuota vencida con pago parcial cae también en `cuotasAtrasadas`.
  // Se cuentan `cuota_id` distintos, que resuelve las dos cosas a la vez.
  const cuotasAtrasadasCount = useMemo(
    () => new Set((activoData?.cuotasAtrasadas ?? []).map((c) => c.cuota_id)).size,
    [activoData?.cuotasAtrasadas]
  );

  const cuotasPorPagarCount = useMemo(
    () =>
      new Set(
        [
          ...(activoData?.cuotasAtrasadas ?? []),
          ...(activoData?.cuotasPendientes ?? []),
        ].map((c) => c.cuota_id)
      ).size,
    [activoData?.cuotasAtrasadas, activoData?.cuotasPendientes]
  );

  const handleSifcoSelect = (sifco: string) => {
    setSifcoSeleccionado(sifco);
  };

  return (  <div className="fixed inset-x-0 top-16 xl:top-20 bottom-0 flex flex-col items-center justify-start bg-gradient-to-br from-blue-50 to-white px-4 sm:px-6 lg:px-8 overflow-auto pt-8 pb-8">
   
      <div className="w-full max-w-4xl">
        <h1 className="text-3xl font-bold text-blue-900 mb-6 text-center">
          Convenios de Pago
        </h1>
        <p className="text-center text-gray-600 -mt-4 mb-6">
          Consulta del convenio vigente de un crédito. Los convenios nuevos se
          crean desde el CRM de cobros.
        </p>

        {/* Credit search */}
        <BuscadorUsuarioSifco
          onSelect={handleSifcoSelect}
          reset={resetBuscador}
          onReset={() => setResetBuscador(false)}
        />

        {/* Loading */}
        {loadingCredit && (
          <div className="text-center py-8 text-gray-600">
            Cargando información del crédito...
          </div>
        )}

        {/* Error */}
        {error && (
          <Alert className="mb-6 border-red-500 bg-red-50">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-800">
              Error al cargar el crédito: {error.message}
            </AlertDescription>
          </Alert>
        )}

        {/* Alert if credit is cancelled */}
        {canceladoData && (
          <Alert className="mb-6 border-red-500 bg-red-50">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-800">
              Este crédito está cancelado. Un crédito cancelado no tiene
              convenios de pago.
            </AlertDescription>
          </Alert>
        )}

        {/* Credit info and form - solo si es ACTIVO */}
        {activoData && (
          <>
            {/* Alert if credit already has active agreement */}
            {hasActiveAgreement && (
              <Alert className="mb-6 border-orange-500 bg-orange-50">
                <AlertCircle className="h-4 w-4 text-orange-600" />
                <AlertDescription className="text-orange-800">
                  Este crédito ya tiene un convenio de pago activo. No se puede
                  crear otro convenio hasta que el actual se complete o cancele.
                </AlertDescription>
              </Alert>
            )}

            {/* Credit Summary Card */}
            <Card className="p-6 mb-6 bg-gradient-to-br from-blue-50 to-indigo-50">
              <h2 className="text-xl font-bold text-blue-900 mb-4 flex items-center gap-2">
                <CreditCard className="w-5 h-5" />
                Información del Crédito
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Usuario */}
                <div className="flex flex-col bg-white rounded-lg p-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <User className="w-4 h-4 text-blue-600" />
                    <span className="font-bold text-blue-700 text-sm">
                      Usuario
                    </span>
                  </div>
                  <span className="text-gray-900 font-semibold">
                    {activoData.usuario.nombre}
                  </span>
                  <span className="text-gray-600 text-sm mt-1">
                    NIT: {activoData.usuario.nit || "N/A"}
                  </span>
                </div>

                {/* Crédito SIFCO */}
                <div className="flex flex-col bg-white rounded-lg p-4 shadow-sm">
                  <span className="font-bold text-blue-700 text-sm mb-2">
                    Crédito SIFCO
                  </span>
                  <span className="text-gray-900 text-lg font-bold tracking-wider">
                    {activoData.credito.numero_credito_sifco}
                  </span>
                </div>

                {/* Deuda Total */}
                <div className="flex flex-col bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-4 shadow-sm border border-green-200">
                  <span className="font-bold text-green-700 text-sm mb-2">
                    Deuda Total
                  </span>
                  <span className="text-green-700 font-bold text-xl">
                    Q
                    {Number(activoData.credito.deudatotal).toLocaleString(
                      "es-GT",
                      {
                        minimumFractionDigits: 2,
                      }
                    )}
                  </span>
                </div>

                {/* Cuota Mensual */}
                <div className="flex flex-col bg-gradient-to-br from-indigo-50 to-purple-50 rounded-lg p-4 shadow-sm border border-indigo-200">
                  <span className="font-bold text-indigo-700 text-sm mb-2">
                    Cuota Mensual
                  </span>
                  <span className="text-indigo-700 font-bold text-xl">
                    Q
                    {Number(activoData.credito.cuota).toLocaleString("es-GT", {
                      minimumFractionDigits: 2,
                    })}
                  </span>
                </div>

                {/* Cuota Actual */}
                <div className="flex flex-col bg-white rounded-lg p-4 shadow-sm">
                  <span className="font-bold text-blue-700 text-sm mb-2">
                    Cuota Actual
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-900 text-xl font-bold">
                      #{activoData.cuotaActual?.numero_cuota ?? "N/A"}
                    </span>
                    {activoData.cuotaActualPagada ? (
                      <CheckCircle className="w-5 h-5 text-green-600" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-orange-600" />
                    )}
                  </div>
                </div>

                {/* Mora */}
                {Number(activoData.moraActual) > 0 && (
                  <div className="flex flex-col bg-gradient-to-br from-red-50 to-pink-50 rounded-lg p-4 shadow-sm border border-red-200">
                    <span className="font-bold text-red-700 text-sm mb-2">
                      Mora Actual
                    </span>
                    <span className="text-red-700 font-bold text-xl">
                      Q
                      {Number(activoData.moraActual).toLocaleString("es-GT", {
                        minimumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                )}

                {/* Cuotas Atrasadas */}
                {activoData.cuotasAtrasadas && activoData.cuotasAtrasadas.length > 0 && (
                  <div className="flex flex-col bg-gradient-to-br from-red-50 to-pink-50 rounded-lg p-4 shadow-sm border border-red-200">
                    <span className="font-bold text-red-700 text-sm mb-2">
                      Cuotas Atrasadas
                    </span>
                    <span className="text-red-700 font-bold text-xl">
                      {cuotasAtrasadasCount}
                    </span>
                  </div>
                )}

                {/* Cuotas Pendientes + Atrasadas */}
                <div className="flex flex-col bg-white rounded-lg p-4 shadow-sm">
                  <span className="font-bold text-blue-700 text-sm mb-2">
                    Cuotas por Pagar
                  </span>
                  <span className="text-gray-900 text-xl font-bold">
                    {cuotasPorPagarCount}
                  </span>
                </div>

                {/* Saldo a Favor */}
                <div className="flex flex-col bg-gradient-to-br from-yellow-50 to-amber-50 rounded-lg p-4 shadow-sm border border-yellow-200">
                  <span className="font-bold text-yellow-700 text-sm mb-2">
                    Saldo a Favor
                  </span>
                  <span className="text-green-700 font-bold text-xl">
                    Q
                    {Number(
                      activoData.usuario.saldo_a_favor || 0
                    ).toLocaleString("es-GT", {
                      minimumFractionDigits: 2,
                    })}
                  </span>
                </div>
              </div>
            </Card>

            {/* Card de Convenio Activo - si existe */}
            {activoData.convenioActivo && (
              <Card className="p-6 mb-6 bg-gradient-to-br from-purple-50 to-indigo-50 border-2 border-purple-300 rounded-2xl shadow-xl">
                {/* Header Clickeable */}
                <div
                  className="cursor-pointer hover:bg-purple-50/50 transition-all rounded-lg p-2 -m-2 mb-4"
                  onClick={() => setConvenioExpanded(!convenioExpanded)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <FileText className="w-6 h-6 text-purple-700" />
                      <div>
                        <div className="flex items-center gap-2">
                          <h2 className="text-xl font-bold text-purple-900">
                            📋 Convenio de Pago Existente
                          </h2>
                          <span
                            className={`px-2 py-0.5 rounded-full font-bold text-xs ${
                              activoData.convenioActivo.activo
                                ? "bg-green-500 text-white"
                                : "bg-gray-400 text-white"
                            }`}
                          >
                            {activoData.convenioActivo.activo
                              ? "Activo"
                              : "Inactivo"}
                          </span>
                        </div>
                        <p className="text-purple-600 text-xs mt-1">
                          {convenioExpanded
                            ? "Click para ocultar detalles"
                            : "Click para ver detalles"}
                        </p>
                      </div>
                    </div>

                    {/* Preview cuando está colapsado */}
                    <div className="flex items-center gap-4">
                      {!convenioExpanded && (
                        <div className="flex items-center gap-4">
                          <div className="text-right bg-white rounded-lg px-3 py-2 border border-purple-200">
                            <p className="text-[10px] text-purple-600 font-semibold">
                              Progreso
                            </p>
                            <p className="font-bold text-purple-900">
                              {activoData.convenioActivo.pagos_realizados}/
                              {activoData.convenioActivo.numero_meses}
                            </p>
                          </div>
                          <div className="text-right bg-white rounded-lg px-3 py-2 border border-orange-200">
                            <p className="text-[10px] text-orange-600 font-semibold">
                              Pendiente
                            </p>
                            <p className="font-bold text-orange-700">
                              Q
                              {Number(
                                activoData.convenioActivo.monto_pendiente
                              ).toLocaleString("es-GT", {
                                minimumFractionDigits: 2,
                              })}
                            </p>
                          </div>
                        </div>
                      )}

                      <button
                        type="button"
                        className="bg-purple-200 hover:bg-purple-300 p-2 rounded-lg transition-all"
                      >
                        {convenioExpanded ? (
                          <ChevronUp className="w-5 h-5 text-purple-700" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-purple-700" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Contenido expandible */}
                <div
                  className={`overflow-hidden transition-all duration-300 ${
                    convenioExpanded
                      ? "max-h-[1000px] opacity-100"
                      : "max-h-0 opacity-0"
                  }`}
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
                    {/* Monto Total */}
                    <div className="bg-white rounded-lg p-4 shadow-sm border border-purple-100">
                      <span className="text-sm font-bold text-purple-700 block mb-1">
                        Monto Total
                      </span>
                      <span className="text-xl font-bold text-purple-900">
                        Q
                        {Number(
                          activoData.convenioActivo.monto_total_convenio
                        ).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                      </span>
                    </div>

                    {/* Cuota Mensual */}
                    <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-lg p-4 shadow-sm border border-indigo-200">
                      <span className="text-sm font-bold text-indigo-700 block mb-1">
                        Cuota Mensual
                      </span>
                      <span className="text-xl font-bold text-indigo-700">
                        Q
                        {Number(
                          activoData.convenioActivo.cuota_mensual
                        ).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                      </span>
                    </div>

                    {/* Progreso */}
                    <div className="bg-white rounded-lg p-4 shadow-sm border border-purple-100">
                      <span className="text-sm font-bold text-purple-700 block mb-1">
                        Progreso
                      </span>
                      <span className="text-xl font-bold text-purple-900 block mb-2">
                        {activoData.convenioActivo.pagos_realizados} /{" "}
                        {activoData.convenioActivo.numero_meses}
                      </span>
                      {/* Barra de progreso */}
                      <div className="bg-gray-200 rounded-full h-2 overflow-hidden">
                        <div
                          className="bg-gradient-to-r from-purple-500 to-indigo-500 h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${(activoData.convenioActivo.pagos_realizados / activoData.convenioActivo.numero_meses) * 100}%`,
                          }}
                        />
                      </div>
                    </div>

                    {/* Monto Pagado */}
                    <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-4 shadow-sm border border-green-200">
                      <span className="text-sm font-bold text-green-700 block mb-1">
                        Monto Pagado
                      </span>
                      <span className="text-xl font-bold text-green-700">
                        Q
                        {Number(
                          activoData.convenioActivo.monto_pagado
                        ).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                      </span>
                    </div>

                    {/* Monto Pendiente */}
                    <div className="bg-gradient-to-br from-orange-50 to-red-50 rounded-lg p-4 shadow-sm border border-orange-200">
                      <span className="text-sm font-bold text-orange-700 block mb-1">
                        Monto Pendiente
                      </span>
                      <span className="text-xl font-bold text-orange-700">
                        Q
                        {Number(
                          activoData.convenioActivo.monto_pendiente
                        ).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                      </span>
                    </div>

                    {/* Cuotas en Convenio */}
                    <div className="bg-white rounded-lg p-4 shadow-sm border border-purple-100">
                      <span className="text-sm font-bold text-purple-700 block mb-1">
                        Cuotas en Convenio
                      </span>
                      <span className="text-xl font-bold text-purple-900">
                        {activoData.cuotasEnConvenio?.length || 0}
                      </span>
                    </div>
                  </div>

                  {/* Motivo */}
                  {activoData.convenioActivo.motivo && (
                    <div className="mt-6 bg-white rounded-lg p-4 shadow-sm border border-purple-100">
                      <span className="text-sm font-bold text-purple-700 block mb-1">
                        Motivo
                      </span>
                      <p className="text-gray-700">
                        {activoData.convenioActivo.motivo}
                      </p>
                    </div>
                  )}

                  {/* Observaciones */}
                  {activoData.convenioActivo.observaciones && (
                    <div className="mt-4 bg-white rounded-lg p-4 shadow-sm border border-purple-100">
                      <span className="text-sm font-bold text-purple-700 block mb-1">
                        Observaciones
                      </span>
                      <p className="text-gray-700">
                        {activoData.convenioActivo.observaciones}
                      </p>
                    </div>
                  )}

                  {/* Fecha de creación */}
                  <div className="mt-4 bg-white rounded-lg p-4 shadow-sm border border-purple-100">
                    <span className="text-sm font-bold text-purple-700 block mb-1">
                      Fecha de Creación
                    </span>
                    <p className="text-gray-700">
                      {new Date(
                        activoData.convenioActivo.fecha_convenio
                      ).toLocaleDateString("es-GT", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    </p>
                  </div>
                </div>
              </Card>
            )}

            {/* CB-032: el convenio ya NO se crea desde cartera. Se crea desde
                la Ficha 360 del CRM de cobros (botón "Promesa / Convenio"),
                que llama al mismo servicio de cartera-back. Acá solo se
                consulta el vigente y, desde Pagos, se activa o rechaza. */}
            {!hasActiveAgreement && (
              <Alert className="mb-6 border-blue-500 bg-blue-50">
                <AlertCircle className="h-4 w-4 text-blue-600" />
                <AlertDescription className="text-blue-900">
                  Este crédito no tiene un convenio de pago vigente. Los
                  convenios se crean desde el <strong>CRM de cobros</strong>,
                  en la ficha del caso (botón{" "}
                  <strong>Promesa / Convenio</strong>). Una vez creado, se
                  activa o rechaza desde la pantalla de Pagos de cartera.
                </AlertDescription>
              </Alert>
            )}
          </>
        )}
      </div>
    </div>
  );
}