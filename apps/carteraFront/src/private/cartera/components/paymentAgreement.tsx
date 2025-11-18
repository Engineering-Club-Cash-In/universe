// src/components/PaymentAgreements/CreatePaymentAgreementForm.tsx

import { useState, useMemo } from "react";
 
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  Calculator, 
  FileText, 
  DollarSign, 
  User, 
  CreditCard, 
  AlertCircle,
  CheckCircle,
  Clock,
  AlertTriangle
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useCreatePaymentAgreement, useCreditoBySifco } from "../hooks/paymentagreement";
import { BuscadorUsuarioSifco } from "./searchByNameSifco";

export function CreatePaymentAgreementForm() {
  const [sifcoSeleccionado, setSifcoSeleccionado] = useState<string>("");
  const [resetBuscador, setResetBuscador] = useState(false);

  // Form state
  const [selectedInstallments, setSelectedInstallments] = useState<number[]>([]);
  const [numberOfMonths, setNumberOfMonths] = useState<number>(1);
  const [reason, setReason] = useState<string>("");
  const [observations, setObservations] = useState<string>("");

  // Get credit data usando tu hook
  const { data: creditData, isLoading: loadingCredit, error } = useCreditoBySifco(sifcoSeleccionado);

  // Create mutation
  const { mutate: createAgreement, isPending } = useCreatePaymentAgreement();

  // Check if credit is cancelled
  const isCancelled = useMemo(() => {
    if (!creditData) return false;
    return creditData.credito?.statusCredit === "CANCELADO";
  }, [creditData]);

  // Check if credit has an active agreement
  const hasActiveAgreement = useMemo(() => {
    if (!creditData) return false;
    return creditData.credito?.statusCredit === "EN_CONVENIO";
  }, [creditData]);

  // Get cuotas pendientes y atrasadas (NO las pagadas)
  const cuotasParaConvenio = useMemo(() => {
    if (!creditData) return [];
    
    const atrasadas = (creditData.cuotasAtrasadas || []).map(c => ({ ...c, estado: 'atrasada' as const }));
    const pendientes = (creditData.cuotasPendientes || []).map(c => ({ ...c, estado: 'pendiente' as const }));
    
    // Usa un Map para evitar duplicados por cuota_id
    const cuotasMap = new Map();
    
    // Prioriza atrasadas sobre pendientes
    [...atrasadas, ...pendientes].forEach(cuota => {
      if (!cuotasMap.has(cuota.cuota_id)) {
        cuotasMap.set(cuota.cuota_id, cuota);
      }
    });
    
    // Convierte de vuelta a array y ordena por numero_cuota
    return Array.from(cuotasMap.values()).sort((a, b) => a.numero_cuota - b.numero_cuota);
  }, [creditData]);

  // Calculate total amount based on selected installments
  const totalAmount = useMemo(() => {
    if (!creditData || selectedInstallments.length === 0) return 0;

    const cuotaMensual = Number(creditData.credito?.cuota || 0);
    const mora = Number(creditData.moraActual || 0);

    // Total = (cuota mensual * número de cuotas) + mora
    return (cuotaMensual * selectedInstallments.length) + mora;
  }, [creditData, selectedInstallments]);

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
  };

  const handleInstallmentToggle = (cuotaId: number) => {
    setSelectedInstallments((prev) =>
      prev.includes(cuotaId)
        ? prev.filter((id) => id !== cuotaId)
        : [...prev, cuotaId]
    );
  };

  const handleSelectAllInstallments = () => {
    if (selectedInstallments.length === cuotasParaConvenio.length) {
      setSelectedInstallments([]);
    } else {
      setSelectedInstallments(cuotasParaConvenio.map((c) => c.cuota_id));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!creditData) return;

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
        credit_id: creditData.credito.credito_id,
        payment_ids: selectedInstallments,
        total_agreement_amount: totalAmount,
        number_of_months: numberOfMonths,
        reason,
        observations,
        created_by: 1, // TODO: Get from user context
      },
      {
        onSuccess: () => {
          // Reset form
          setSifcoSeleccionado("");
          setResetBuscador(true);
          setSelectedInstallments([]);
          setNumberOfMonths(1);
          setReason("");
          setObservations("");
        },
      }
    );
  };

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-start bg-gradient-to-br from-blue-50 to-white px-4 overflow-auto pt-8 pb-8">
      <div className="w-full max-w-6xl">
        <h1 className="text-3xl font-bold text-blue-900 mb-6">
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
        {creditData && isCancelled && (
          <Alert className="mb-6 border-red-500 bg-red-50">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-800">
              Este crédito está cancelado. No se pueden crear convenios de pago para créditos cancelados.
            </AlertDescription>
          </Alert>
        )}

        {/* Credit info and form - solo si NO está cancelado */}
        {creditData && !isCancelled && (
          <>
            {/* Alert if credit already has active agreement */}
            {hasActiveAgreement && (
              <Alert className="mb-6 border-orange-500 bg-orange-50">
                <AlertCircle className="h-4 w-4 text-orange-600" />
                <AlertDescription className="text-orange-800">
                  Este crédito ya tiene un convenio de pago activo. No se puede crear otro convenio hasta que el actual se complete o cancele.
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
                    <span className="font-bold text-blue-700 text-sm">Usuario</span>
                  </div>
                  <span className="text-gray-900 font-semibold">
                    {creditData.usuario.nombre}
                  </span>
                  <span className="text-gray-600 text-sm mt-1">
                    NIT: {creditData.usuario.nit || "N/A"}
                  </span>
                </div>

                {/* Crédito SIFCO */}
                <div className="flex flex-col bg-white rounded-lg p-4 shadow-sm">
                  <span className="font-bold text-blue-700 text-sm mb-2">
                    Crédito SIFCO
                  </span>
                  <span className="text-gray-900 text-lg font-bold tracking-wider">
                    {creditData.credito.numero_credito_sifco}
                  </span>
                </div>

                {/* Deuda Total */}
                <div className="flex flex-col bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-4 shadow-sm border border-green-200">
                  <span className="font-bold text-green-700 text-sm mb-2">
                    Deuda Total
                  </span>
                  <span className="text-green-700 font-bold text-xl">
                    Q{Number(creditData.credito.deudatotal).toLocaleString("es-GT", {
                      minimumFractionDigits: 2,
                    })}
                  </span>
                </div>

                {/* Cuota Mensual */}
                <div className="flex flex-col bg-gradient-to-br from-indigo-50 to-purple-50 rounded-lg p-4 shadow-sm border border-indigo-200">
                  <span className="font-bold text-indigo-700 text-sm mb-2">
                    Cuota Mensual
                  </span>
                  <span className="text-indigo-700 font-bold text-xl">
                    Q{Number(creditData.credito.cuota).toLocaleString("es-GT", {
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
                      #{creditData.cuotaActual ?? 'N/A'}
                    </span>
                    {creditData.cuotaActualPagada ? (
                      <CheckCircle className="w-5 h-5 text-green-600" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-orange-600" />
                    )}
                  </div>
                </div>

                {/* Mora */}
                {creditData.moraActual > 0 && (
                  <div className="flex flex-col bg-gradient-to-br from-red-50 to-pink-50 rounded-lg p-4 shadow-sm border border-red-200">
                    <span className="font-bold text-red-700 text-sm mb-2">
                      Mora Actual
                    </span>
                    <span className="text-red-700 font-bold text-xl">
                      Q{Number(creditData.moraActual).toLocaleString("es-GT", {
                        minimumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                )}

                {/* Cuotas Atrasadas */}
                {creditData.cuotasAtrasadas && creditData.cuotasAtrasadas.length > 0 && (
                  <div className="flex flex-col bg-gradient-to-br from-red-50 to-pink-50 rounded-lg p-4 shadow-sm border border-red-200">
                    <span className="font-bold text-red-700 text-sm mb-2">
                      Cuotas Atrasadas
                    </span>
                    <span className="text-red-700 font-bold text-xl">
                      {creditData.cuotasAtrasadas.length}
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
                    Q{Number(creditData.usuario.saldo_a_favor || 0).toLocaleString("es-GT", {
                      minimumFractionDigits: 2,
                    })}
                  </span>
                </div>
              </div>
            </Card>

            {/* Form - Only show if no active agreement */}
            {!hasActiveAgreement && (
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Installment selection */}
                <Card className="p-6 bg-white">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-bold text-blue-900 flex items-center gap-2">
                      <FileText className="w-5 h-5" />
                      Seleccionar Cuotas para Convenio
                    </h3>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleSelectAllInstallments}
                      disabled={cuotasParaConvenio.length === 0}
                      className="text-blue-900"
                    >
                      {selectedInstallments.length === cuotasParaConvenio.length
                        ? "Deseleccionar todas"
                        : "Seleccionar todas"}
                    </Button>
                  </div>

                  {cuotasParaConvenio.length === 0 ? (
                    <p className="text-gray-500 text-center py-4">
                      No hay cuotas pendientes o atrasadas para este crédito
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 max-h-[500px] overflow-y-auto p-2">
                      {cuotasParaConvenio.map((installment) => {
                        const isAtrasada = installment.estado === 'atrasada';
                        return (
                          <div
                            key={installment.cuota_id}
                            className={`flex flex-col p-3 rounded-lg border-2 transition cursor-pointer ${
                              selectedInstallments.includes(installment.cuota_id)
                                ? "border-blue-500 bg-blue-50"
                                : isAtrasada
                                ? "border-red-200 bg-red-50 hover:border-red-400"
                                : "border-gray-200 bg-white hover:border-blue-300"
                            }`}
                            onClick={() => handleInstallmentToggle(installment.cuota_id)}
                          >
                            <div className="flex items-center space-x-2 mb-2">
                              <Checkbox
                                id={`installment-${installment.cuota_id}`}
                                checked={selectedInstallments.includes(installment.cuota_id)}
                                onCheckedChange={() => handleInstallmentToggle(installment.cuota_id)}
                              />
                              <label
                                htmlFor={`installment-${installment.cuota_id}`}
                                className="flex-1 cursor-pointer font-bold text-sm text-blue-900"
                              >
                                Cuota #{installment.numero_cuota}
                              </label>
                            </div>
                            
                            {/* Estado badge */}
                            <div className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ${
                              isAtrasada 
                                ? "bg-red-100 text-red-700" 
                                : "bg-yellow-100 text-yellow-700"
                            }`}>
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
                        );
                      })}
                    </div>
                  )}

                  {selectedInstallments.length > 0 && (
                    <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
                      <p className="text-sm text-blue-900 font-semibold">
                        <strong className="text-lg">{selectedInstallments.length}</strong> cuota(s) seleccionada(s)
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
                      <Label htmlFor="numberOfMonths" className="text-blue-900 font-bold text-base mb-2 block">
                        Número de Meses para Pagar
                      </Label>
                      <Input
                        id="numberOfMonths"
                        type="number"
                        min="1"
                        value={numberOfMonths}
                        onChange={(e) => setNumberOfMonths(Number(e.target.value))}
                        className="text-gray-900 text-lg font-semibold"
                      />
                    </div>

                    {/* Total amount (readonly) */}
                    <div>
                      <Label className="text-blue-900 font-bold text-base mb-2 block">
                        Monto Total del Convenio
                      </Label>
                      <div className="p-3 bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg font-bold text-xl text-green-700 flex items-center gap-2 border-2 border-green-200">
                        <DollarSign className="w-5 h-5" />
                        Q{totalAmount.toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                      </div>
                    </div>

                    {/* Monthly installment (readonly) */}
                    <div>
                      <Label className="text-blue-900 font-bold text-base mb-2 block">
                        Cuota Mensual del Convenio
                      </Label>
                      <div className="p-3 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg font-bold text-lg text-blue-700 border-2 border-blue-200">
                        Q{monthlyInstallment.toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                      </div>
                    </div>

                    {/* Included mora */}
                    {creditData.moraActual > 0 && (
                      <div>
                        <Label className="text-blue-900 font-bold text-base mb-2 block">
                          Mora Incluida
                        </Label>
                        <div className="p-3 bg-gradient-to-br from-red-50 to-pink-50 rounded-lg font-bold text-lg text-red-700 border-2 border-red-200">
                          Q{Number(creditData.moraActual).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Reason */}
                  <div className="mt-6">
                    <Label htmlFor="reason" className="text-blue-900 font-bold text-base mb-2 block">
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
                    <Label htmlFor="observations" className="text-blue-900 font-bold text-base mb-2 block">
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