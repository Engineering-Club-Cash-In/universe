// src/components/PaymentAgreements/CreatePaymentAgreementForm.tsx

import { useState, useMemo } from "react"; 

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Calculator,
  FileText,
  DollarSign,
  User,
  CreditCard,
  AlertCircle,
  CheckCircle,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  useCreatePaymentAgreement,
  useCreditoBySifco,
} from "../hooks/paymentagreement";
import { BuscadorUsuarioSifco } from "./searchByNameSifco";

export function CreatePaymentAgreementForm() {
  const [sifcoSeleccionado, setSifcoSeleccionado] = useState<string>("");
  const [resetBuscador, setResetBuscador] = useState(false);
  const [convenioExpanded, setConvenioExpanded] = useState(true);
  
  // Form state
  const [selectedInstallments, setSelectedInstallments] = useState<number[]>([]);
  const [numberOfMonths, setNumberOfMonths] = useState<number>(1);
  const [reason, setReason] = useState<string>("");
  const [observations, setObservations] = useState<string>("");
  const [showAllInstallments, setShowAllInstallments] = useState(false);

  // Get credit data
  const {
    data: creditData,
    isLoading: loadingCredit,
    error,
  } = useCreditoBySifco(sifcoSeleccionado);

  // Create mutation
  const { mutate: createAgreement, isPending } = useCreatePaymentAgreement();

  // 🔥 TYPE NARROWING: Separar data según flujo
  const activoData = creditData?.flujo === "ACTIVO" ? creditData : null;
  const canceladoData = creditData?.flujo === "CANCELADO" ? creditData : null;
 
  const hasActiveAgreement = activoData?.credito?.statusCredit === "EN_CONVENIO";

  // 🔥 ACTUALIZADO: Ahora usa activoData que TypeScript sabe que es GetCreditoByNumeroActivoResponse
  const cuotasParaConvenio = useMemo(() => {
    if (!activoData) return [];

    const atrasadas = (activoData.cuotasAtrasadas || []).map((c) => ({
      ...c,
      estado: "atrasada" as const,
    }));
    const pendientes = (activoData.cuotasPendientes || []).map((c) => ({
      ...c,
      estado: "pendiente" as const,
    }));

    // Usa un Map para evitar duplicados por cuota_id
    const cuotasMap = new Map();

    // Prioriza atrasadas sobre pendientes
    [...atrasadas, ...pendientes].forEach((cuota) => {
      if (!cuotasMap.has(cuota.cuota_id)) {
        cuotasMap.set(cuota.cuota_id, cuota);
      }
    });

    // Convierte de vuelta a array y ordena por numero_cuota
    return Array.from(cuotasMap.values()).sort(
      (a, b) => a.numero_cuota - b.numero_cuota
    );
  }, [activoData]);

  // Cuotas a mostrar (solo primeras 10 o todas si está expandido)
  const cuotasVisibles = useMemo(() => {
    if (showAllInstallments) return cuotasParaConvenio;
    return cuotasParaConvenio.slice(0, 10);
  }, [cuotasParaConvenio, showAllInstallments]);

  // Calculate total amount based on selected installments
  const totalAmount = useMemo(() => {
    if (!activoData || selectedInstallments.length === 0) return 0;

    const cuotaMensual = parseFloat(activoData.credito?.cuota || "0");
    const mora = parseFloat(activoData.moraActual?.toString() || "0");

    return cuotaMensual * selectedInstallments.length + mora;
  }, [activoData, selectedInstallments]);

  // Calculate monthly installment of the agreement
  const monthlyInstallment = useMemo(() => {
    if (numberOfMonths === 0) return 0;
    return totalAmount / numberOfMonths;
  }, [totalAmount, numberOfMonths]);

  const handleSifcoSelect = (sifco: string) => {
    setSifcoSeleccionado(sifco);
    // Reset form when credit changes
    setSelectedInstallments([]);
    setNumberOfMonths(1);
    setReason("");
    setObservations("");
    setShowAllInstallments(false);
  };

  const handleInstallmentToggle = (pagoId: number) => {
    setSelectedInstallments((prev) =>
      prev.includes(pagoId)
        ? prev.filter((id) => id !== pagoId)
        : [...prev, pagoId]
    );
  };

  const handleSelectAllInstallments = () => {
    if (selectedInstallments.length === cuotasParaConvenio.length) {
      setSelectedInstallments([]);
    } else {
      setSelectedInstallments(cuotasParaConvenio.map((c) => c.pago_id!));
    }
  };

  const handleSelectRange = (type: "atrasadas" | "primeras10" | "todas") => {
    switch (type) {
      case "atrasadas": {
        const atrasadas = cuotasParaConvenio.filter(
          (c) => c.estado === "atrasada"
        );
        setSelectedInstallments(atrasadas.map((c) => c.pago_id!));
        break;
      }
      case "primeras10": {
        const primeras = cuotasParaConvenio.slice(0, 10);
        setSelectedInstallments(primeras.map((c) => c.pago_id!));
        break;
      }
      case "todas":
        setSelectedInstallments(cuotasParaConvenio.map((c) => c.pago_id!));
        break;
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!activoData) return;

    if (selectedInstallments.length === 0) {
      alert("Debes seleccionar al menos una cuota");
      return;
    }

    if (numberOfMonths < 1) {
      alert("El número de meses debe ser mayor a 0");
      return;
    }

    createAgreement(
      {
        credit_id: activoData.credito.credito_id,
        payment_ids: selectedInstallments,
        total_agreement_amount: totalAmount,
        number_of_months: numberOfMonths,
        reason,
        observations,
        created_by: 1,
      },
      {
        onSuccess: () => {
          alert(
            `¡Convenio creado exitosamente!\n\nSe creó el convenio para ${selectedInstallments.length} cuota(s)\nMonto total: Q${totalAmount.toLocaleString("es-GT", { minimumFractionDigits: 2 })}\nPlazo: ${numberOfMonths} meses`
          );
          // Reset form
          setSifcoSeleccionado("");
          setResetBuscador(true);
          setSelectedInstallments([]);
          setNumberOfMonths(1);
          setReason("");
          setObservations("");
          setShowAllInstallments(false);
        },
        onError: (error) => {
          alert(`Error al crear el convenio:\n${error.message}`);
        },
      }
    );
  };
// Después de las líneas de type narrowing
console.log("🔍 DEBUG:", {
  creditData,
  flujo: creditData?.flujo,
  activoData: !!activoData,
  canceladoData: !!canceladoData,
  hasActiveAgreement,
});
  return (  <div className="fixed inset-x-0 top-16 xl:top-20 bottom-0 flex flex-col items-center justify-start bg-gradient-to-br from-blue-50 to-white px-4 sm:px-6 lg:px-8 overflow-auto pt-8 pb-8">
   
      <div className="w-full max-w-4xl">
        <h1 className="text-3xl font-bold text-blue-900 mb-6 text-center">
          Crear Convenio de Pago
        </h1>

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
              Este crédito está cancelado. No se pueden crear convenios de pago
              para créditos cancelados.
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
                      #{activoData.cuotaActual ?? "N/A"}
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
                      {activoData.cuotasAtrasadas.length}
                    </span>
                  </div>
                )}

                {/* Cuotas Pendientes + Atrasadas */}
                <div className="flex flex-col bg-white rounded-lg p-4 shadow-sm">
                  <span className="font-bold text-blue-700 text-sm mb-2">
                    Cuotas por Pagar
                  </span>
                  <span className="text-gray-900 text-xl font-bold">
                    {cuotasParaConvenio.length}
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

            {/* Form - Only show if no active agreement */}
            {!hasActiveAgreement && (
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Installment selection */}
                <Card className="p-6 bg-white">
                  <div className="flex flex-col gap-4 mb-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xl font-bold text-blue-900 flex items-center gap-2">
                        <FileText className="w-5 h-5" />
                        Seleccionar Cuotas para Convenio
                      </h3>
                    </div>

                    {/* Selección rápida con Select */}
                    {cuotasParaConvenio.length > 0 && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <Select
                          onValueChange={(value) =>
                            handleSelectRange(
                              value as "atrasadas" | "primeras10" | "todas"
                            )
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Selección rápida..." />
                          </SelectTrigger>
                          <SelectContent>
                            {activoData.cuotasAtrasadas && activoData.cuotasAtrasadas.length > 0 && (
                              <SelectItem value="atrasadas">
                                Solo Atrasadas ({activoData.cuotasAtrasadas.length})
                              </SelectItem>
                            )}
                            <SelectItem value="primeras10">
                              Primeras 10 cuotas
                            </SelectItem>
                            <SelectItem value="todas">
                              Todas las cuotas ({cuotasParaConvenio.length})
                            </SelectItem>
                          </SelectContent>
                        </Select>

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleSelectAllInstallments}
                          className="text-blue-900"
                        >
                          {selectedInstallments.length ===
                          cuotasParaConvenio.length
                            ? "Deseleccionar todas"
                            : "Seleccionar todas"}
                        </Button>

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedInstallments([])}
                          className="text-red-600"
                        >
                          Limpiar selección
                        </Button>
                      </div>
                    )}
                  </div>

                  {cuotasParaConvenio.length === 0 ? (
                    <p className="text-gray-500 text-center py-4">
                      No hay cuotas pendientes o atrasadas para este crédito
                    </p>
                  ) : (
                    <>
                      {/* Lista de cuotas */}
                      <div className="space-y-2 max-h-[400px] overflow-y-auto p-2">
                        {cuotasVisibles.map((installment) => {
                          const isAtrasada = installment.estado === "atrasada";
                          const isSelected = selectedInstallments.includes(
                            installment.pago_id!
                          );

                          return (
                            <div
                              key={installment.pago_id}
                              className={`flex items-center justify-between p-3 rounded-lg border-2 transition cursor-pointer ${
                                isSelected
                                  ? "border-blue-500 bg-blue-50"
                                  : isAtrasada
                                    ? "border-red-200 bg-red-50 hover:border-red-400"
                                    : "border-gray-200 bg-white hover:border-blue-300"
                              }`}
                              onClick={() =>
                                handleInstallmentToggle(installment.pago_id!)
                              }
                            >
                              <div className="flex items-center gap-3">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() =>
                                    handleInstallmentToggle(installment.pago_id!)
                                  }
                                  className="w-5 h-5 cursor-pointer"
                                />
                                <div>
                                  <span className="font-bold text-blue-900">
                                    Cuota #{installment.numero_cuota}
                                  </span>
                                  <div
                                    className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ml-2 ${
                                      isAtrasada
                                        ? "bg-red-100 text-red-700"
                                        : "bg-yellow-100 text-yellow-700"
                                    }`}
                                  >
                                    {isAtrasada ? (
                                      <>
                                        <AlertTriangle className="w-3 h-3" />
                                        <span>Atrasada</span>
                                      </>
                                    ) : (
                                      <>
                                        <Clock className="w-3 h-3" />
                                        <span>Pendiente</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Botón para mostrar más */}
                      {cuotasParaConvenio.length > 10 && (
                        <div className="mt-4 text-center">
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() =>
                              setShowAllInstallments(!showAllInstallments)
                            }
                            className="text-blue-600 hover:text-blue-700"
                          >
                            {showAllInstallments ? (
                              <>
                                <ChevronUp className="w-4 h-4 mr-2" />
                                Mostrar menos
                              </>
                            ) : (
                              <>
                                <ChevronDown className="w-4 h-4 mr-2" />
                                Mostrar todas ({cuotasParaConvenio.length - 10}{" "}
                                más)
                              </>
                            )}
                          </Button>
                        </div>
                      )}
                    </>
                  )}

                  {selectedInstallments.length > 0 && (
                    <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
                      <p className="text-sm text-blue-900 font-semibold">
                        <strong className="text-lg">
                          {selectedInstallments.length}
                        </strong>{" "}
                        cuota(s) seleccionada(s)
                      </p>
                    </div>
                  )}
                </Card>

                {/* Agreement configuration */}
                <Card className="p-6 bg-white">
                  <h3 className="text-xl font-bold text-blue-900 mb-6 flex items-center gap-2">
                    <Calculator className="w-5 h-5" />
                    Configuración del Convenio
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Number of months */}
                    <div>
                      <Label
                        htmlFor="numberOfMonths"
                        className="text-blue-900 font-bold text-base mb-2 block"
                      >
                        Número de Meses para Pagar
                      </Label>
                      <Input
                        id="numberOfMonths"
                        type="number"
                        min="1"
                        value={numberOfMonths}
                        onChange={(e) =>
                          setNumberOfMonths(Number(e.target.value))
                        }
                        className="text-gray-900 text-lg font-semibold"
                      />
                    </div>

                    {/* Total amount (readonly) */}
                    <div>
                      <Label className="text-blue-900 font-bold text-base mb-2 block">
                        Monto Total del Convenio
                      </Label>
                      <div className="p-3 bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg font-bold text-xl text-green-700 flex items-center gap-2 border-2 border-green-200">
                        <DollarSign className="w-5 h-5" />Q
                        {totalAmount.toLocaleString("es-GT", {
                          minimumFractionDigits: 2,
                        })}
                      </div>
                    </div>

                    {/* Monthly installment (readonly) */}
                    <div>
                      <Label className="text-blue-900 font-bold text-base mb-2 block">
                        Cuota Mensual del Convenio
                      </Label>
                      <div className="p-3 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg font-bold text-lg text-blue-700 border-2 border-blue-200">
                        Q
                        {monthlyInstallment.toLocaleString("es-GT", {
                          minimumFractionDigits: 2,
                        })}
                      </div>
                    </div>

                    {/* Included mora */}
                    {Number(activoData.moraActual) > 0 && (
                      <div>
                        <Label className="text-blue-900 font-bold text-base mb-2 block">
                          Mora Incluida
                        </Label>
                        <div className="p-3 bg-gradient-to-br from-red-50 to-pink-50 rounded-lg font-bold text-lg text-red-700 border-2 border-red-200">
                          Q
                          {Number(activoData.moraActual).toLocaleString(
                            "es-GT",
                            { minimumFractionDigits: 2 }
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Reason */}
                  <div className="mt-6">
                    <Label
                      htmlFor="reason"
                      className="text-blue-900 font-bold text-base mb-2 block"
                    >
                      Motivo del Convenio
                    </Label>
                    <Textarea
                      id="reason"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Ejemplo: Cliente solicita convenio por dificultades económicas temporales"
                      className="text-gray-900"
                      rows={3}
                    />
                  </div>

                  {/* Observations */}
                  <div className="mt-4">
                    <Label
                      htmlFor="observations"
                      className="text-blue-900 font-bold text-base mb-2 block"
                    >
                      Observaciones (Opcional)
                    </Label>
                    <Textarea
                      id="observations"
                      value={observations}
                      onChange={(e) => setObservations(e.target.value)}
                      placeholder="Información adicional relevante..."
                      className="text-gray-900"
                      rows={3}
                    />
                  </div>
                </Card>

                {/* Submit buttons */}
                <div className="flex justify-end gap-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setSifcoSeleccionado("");
                      setResetBuscador(true);
                    }}
                    className="text-blue-900 font-semibold"
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    disabled={isPending || selectedInstallments.length === 0}
                    className="bg-blue-600 hover:bg-blue-700 font-semibold"
                  >
                    {isPending ? "Creando..." : "Crear Convenio"}
                  </Button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}