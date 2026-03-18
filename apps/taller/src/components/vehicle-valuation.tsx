import React, { useEffect, useState } from 'react';
import { Sparkles, Loader2, TrendingUp } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';
import { Label } from './ui/label';
import { Alert, AlertDescription } from './ui/alert';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from './ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { formatCurrency, handleCurrencyInput } from '../utils/currency';
import { toast } from 'sonner';
import { client } from '../utils/orpc';
import { useInspection } from '../contexts/InspectionContext';

const QuetzalIcon = ({ className }: { className?: string }) => (
  <div className={`flex items-center justify-center font-bold text-[10px] sm:text-xs border-2 border-current rounded-full w-4 h-4 sm:w-5 sm:h-5 ${className}`}>
    Q
  </div>
);

const valuationSchema = z.object({
  vehicleRating: z.enum(["Comercial", "No comercial"], {
    message: "La calificación es requerida",
  }),
  currentConditionValue: z
    .string({ message: "El valor en condiciones actuales es requerido" })
    .min(1, { message: "El valor en condiciones actuales es requerido" }),
  vehicleEquipment: z
    .string({ message: "El equipamiento es requerido" })
    .min(1, { message: "El equipamiento es requerido" }),
  importantConsiderations: z.string().optional(),
  scannerUsed: z.enum(["Sí", "No"], {
    message: "Esta información es requerida",
  }),
  scannerResult: z.any().optional(),
  airbagWarning: z.enum(["Sí", "No"], {
    message: "Esta información es requerida",
  }),
  missingAirbag: z.string().optional(),
  tiresCondition: z.string().optional(),
  tireConditionFrontLeft: z.string().optional(),
  tireConditionFrontRight: z.string().optional(),
  tireConditionRearLeft: z.string().optional(),
  tireConditionRearRight: z.string().optional(),
  hasSpareTire: z.enum(["Sí", "No"]).optional(),
  tireConditionSpare: z.string().optional(),
  paintCondition: z.string().optional(),
  hasAgencyHistory: z.string().optional(),
  marketValue: z.string().optional(),
  inspectionResult: z.string({ message: "Las observaciones generales son requeridas" }).min(1, { message: "Las observaciones generales son requeridas" }),
});

type ValuationFormValues = z.infer<typeof valuationSchema>;

interface VehicleValuationProps {
  vehicleData: any; // Data from previous steps
  onComplete: (valuationData: ValuationFormValues, aiValuation?: AIValuationResult) => void;
  isWizardMode?: boolean;
  isSubmitting?: boolean;
}

interface AIValuationResult {
  suggestedValue: number;
  baseMarketValue?: number;
  reasoning: string;
  marketAnalysis: string;
  depreciationFactors: string[];
  confidence: string;
  commercialClassification?: "Comercial" | "No comercial";
  commercialClassificationReasoning?: string;
}

const MAX_AI_ATTEMPTS = 2;

function isRetryableAIError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    error.name === "TimeoutError" ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("network") ||
    message.includes("fetch") ||
    message.includes("conexi") ||
    message.includes("abort")
  );
}

export default function VehicleValuation({
  vehicleData,
  onComplete,
  isWizardMode = false,
  isSubmitting = false
}: VehicleValuationProps) {
  const { checklistItems, photos, setFormData } = useInspection();
  const [aiValuation, setAiValuation] = useState<AIValuationResult | null>(null);
  const [loadingAI, setLoadingAI] = useState(false);
  const [aiAttemptCount, setAiAttemptCount] = useState(0);
  const [aiFailed, setAiFailed] = useState(false);
  const [aiLoadingMessage, setAiLoadingMessage] = useState("Analizando vehículo...");
  const [scannerFile, setScannerFile] = useState<File | null>(null);
  const [uploadingScanner, setUploadingScanner] = useState(false);
  const [scannerUploadUrl, setScannerUploadUrl] = useState<string | null>(null);
  const [tempUploadId] = useState(() => {
    const stableId = vehicleData?.vinNumber || vehicleData?.licensePlate || Date.now().toString();
    return `scanner-${String(stableId).replace(/[^a-zA-Z0-9-_]/g, "_")}`;
  });



  const form = useForm<ValuationFormValues>({
    resolver: zodResolver(valuationSchema),
    defaultValues: {
      vehicleRating: "Comercial",
      currentConditionValue: "",
      vehicleEquipment: "",
      importantConsiderations: "",
      marketValue: "",
      scannerUsed: "No",
      airbagWarning: "No",
      tiresCondition: "",
      tireConditionFrontLeft: "",
      tireConditionFrontRight: "",
      tireConditionRearLeft: "",
      tireConditionRearRight: "",
      hasSpareTire: "No",
      tireConditionSpare: "",
      paintCondition: "",
      hasAgencyHistory: "",
      scannerResult: undefined,
      missingAirbag: "",
      inspectionResult: "",
    },
  });

  const handleScannerUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.type === "application/pdf") {
        setScannerFile(file);
        setScannerUploadUrl(null);
        form.setValue("scannerResult", file);
      } else {
        alert("Por favor suba un archivo PDF");
      }
    }
  };

  const uploadScannerToServer = async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("vehicleId", tempUploadId);
    formData.append("category", "scanner");
    formData.append("photoType", "scanner-report");
    formData.append("title", "Reporte de scanner");
    formData.append("description", "Reporte PDF del scanner");

    const response = await fetch(`${import.meta.env.VITE_SERVER_URL || 'http://localhost:3000'}/api/upload-vehicle-photo`, {
      method: "POST",
      credentials: "include",
      body: formData,
    });

    if (!response.ok) {
      let errorMessage = `Upload failed: ${response.statusText}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.error || errorMessage;
      } catch {
        // Keep generic error if response is not JSON
      }
      throw new Error(errorMessage);
    }

    const result = await response.json();
    return result.data.url as string;
  };

  useEffect(() => {
    if (!loadingAI) {
      setAiLoadingMessage("Analizando vehículo...");
      return;
    }

    setAiLoadingMessage("Analizando vehículo...");

    const timers = [
      setTimeout(() => {
        setAiLoadingMessage("Buscando referencias en internet...");
      }, 8000),
      setTimeout(() => {
        setAiLoadingMessage("Comparando mercado y condición del vehículo...");
      }, 18000),
      setTimeout(() => {
        setAiLoadingMessage("La valoración sigue procesándose. Puede tardar un poco más.");
      }, 30000),
    ];

    return () => {
      timers.forEach(clearTimeout);
    };
  }, [loadingAI]);

  // AI valuation logic
  const getAIValuation = async () => {
    if (loadingAI || aiAttemptCount >= MAX_AI_ATTEMPTS) {
      return;
    }

    setLoadingAI(true);
    setAiFailed(false);

    const values = form.getValues();
    
    // Calculate average tire condition
    const tireSum = 
      parseInt(values.tireConditionFrontLeft || "0") + 
      parseInt(values.tireConditionFrontRight || "0") + 
      parseInt(values.tireConditionRearLeft || "0") + 
      parseInt(values.tireConditionRearRight || "0");
    const avgTires = Math.round(tireSum / 4).toString();

    try {
      // Call AI valuation endpoint with complete context
      const result = await client.getAIVehicleValuation({
        vehicleData: {
          ...vehicleData,
          tiresCondition: avgTires,
          tireConditionFrontLeft: values.tireConditionFrontLeft,
          tireConditionFrontRight: values.tireConditionFrontRight,
          tireConditionRearLeft: values.tireConditionRearLeft,
          tireConditionRearRight: values.tireConditionRearRight,
          hasSpareTire: values.hasSpareTire,
          tireConditionSpare: values.tireConditionSpare,
          paintCondition: values.paintCondition,
          hasAgencyHistory: values.hasAgencyHistory,
          vehicleEquipment: values.vehicleEquipment,
          importantConsiderations: values.importantConsiderations,
          scannerUsed: values.scannerUsed,
          airbagWarning: values.airbagWarning,
          missingAirbag: values.missingAirbag,
        },
        checklistItems,
        photos
      });

      const aiResult: AIValuationResult = {
        suggestedValue: result.valuation.suggestedValue,
        baseMarketValue: result.valuation.baseMarketValue,
        reasoning: result.valuation.reasoning,
        marketAnalysis: result.valuation.marketAnalysis,
        depreciationFactors: result.valuation.depreciationFactors,
        confidence: result.valuation.confidence,
        commercialClassification: result.valuation.commercialClassification,
        commercialClassificationReasoning: result.valuation.commercialClassificationReasoning
      };

      setAiValuation(aiResult);

      // Auto-fill suggested value
      form.setValue("currentConditionValue", aiResult.suggestedValue.toString());
      if (aiResult.baseMarketValue) {
        form.setValue("marketValue", aiResult.baseMarketValue.toString());
      }

      // Auto-fill commercial classification if available
      if (aiResult.commercialClassification) {
        form.setValue("vehicleRating", aiResult.commercialClassification);
      }

      toast.success("Valoración por IA completada");
    } catch (error) {
      setAiFailed(true);
      if (isRetryableAIError(error)) {
        toast.error("La valoración tardó demasiado o falló la conexión. Puede reintentar sin consumir intento.");
      } else {
        setAiAttemptCount(prev => Math.min(prev + 1, MAX_AI_ATTEMPTS));
        toast.error("Error al obtener valoración por IA. Complete manualmente.");
      }
      console.error(error);
    } finally {
      setLoadingAI(false);
    }
  };

  const onSubmit = async (values: ValuationFormValues) => {
    let scannerResultUrl: string | undefined;

    if (values.scannerUsed === "Sí") {
      const scannerDocument = values.scannerResult as File | undefined;

      if (scannerDocument) {
        try {
          setUploadingScanner(true);
          scannerResultUrl = scannerUploadUrl || await uploadScannerToServer(scannerDocument);
          setScannerUploadUrl(scannerResultUrl);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Error subiendo el PDF del scanner");
          return;
        } finally {
          setUploadingScanner(false);
        }
      } else {
        scannerResultUrl = scannerUploadUrl || undefined;
      }
    }

    const submissionData = {
      ...values,
      scannerResultUrl,
    };

    setFormData((prev: any) => ({
      ...prev,
      ...submissionData,
    }));

    onComplete(submissionData, aiValuation || undefined);
  };

  return (
    <Form {...form}>
      <div className="space-y-6">
      {/* AI Valuation Section */}
      <Card className="bg-linear-to-r from-blue-50 to-indigo-50 border-blue-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Sparkles className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600" />
            Valoración Inteligente
          </CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            Obtenga una valoración estimada del vehículo basada en IA
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="p-4 sm:p-6 bg-white rounded-xl border border-blue-100 shadow-sm space-y-8">
            {/* Sección: Condición de Llantas */}
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-600 bg-blue-50 px-2 py-1 rounded">Llantas</span>
                <div className="h-px bg-slate-100 flex-1"></div>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <FormField
                  control={form.control}
                  name="tireConditionFrontLeft"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-slate-500">Frontal Izquierda</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Estado" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="100">100% (Nueva)</SelectItem>
                          <SelectItem value="75">75% (Buena)</SelectItem>
                          <SelectItem value="50">50% (Media)</SelectItem>
                          <SelectItem value="25">25% (Gasta)</SelectItem>
                          <SelectItem value="0">0% (Cambio)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="tireConditionFrontRight"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-slate-500">Frontal Derecha</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Estado" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="100">100%</SelectItem>
                          <SelectItem value="75">75%</SelectItem>
                          <SelectItem value="50">50%</SelectItem>
                          <SelectItem value="25">25%</SelectItem>
                          <SelectItem value="0">0%</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="tireConditionRearLeft"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-slate-500">Trasera Izquierda</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Estado" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="100">100%</SelectItem>
                          <SelectItem value="75">75%</SelectItem>
                          <SelectItem value="50">50%</SelectItem>
                          <SelectItem value="25">25%</SelectItem>
                          <SelectItem value="0">0%</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="tireConditionRearRight"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-slate-500">Trasera Derecha</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Estado" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="100">100%</SelectItem>
                          <SelectItem value="75">75%</SelectItem>
                          <SelectItem value="50">50%</SelectItem>
                          <SelectItem value="25">25%</SelectItem>
                          <SelectItem value="0">0%</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                <FormField
                  control={form.control}
                  name="hasSpareTire"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-slate-500">¿Tiene llanta de repuesto?</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="¿Tiene?" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Sí">Sí</SelectItem>
                          <SelectItem value="No">No</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {form.watch("hasSpareTire") === "Sí" && (
                  <FormField
                    control={form.control}
                    name="tireConditionSpare"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-slate-500">Estado Repuesto</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Estado" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="100">100%</SelectItem>
                            <SelectItem value="75">75%</SelectItem>
                            <SelectItem value="50">50%</SelectItem>
                            <SelectItem value="25">25%</SelectItem>
                            <SelectItem value="0">0%</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>
            </div>

            {/* Sección: Estado General */}
            <div className="space-y-4 pt-2">
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-600 bg-blue-50 px-2 py-1 rounded">Estado General</span>
                <div className="h-px bg-slate-100 flex-1"></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="paintCondition"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-slate-500">Estado de Pintura</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccione estado" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="100">Excelente (Sin detalles)</SelectItem>
                          <SelectItem value="75">Bueno (Detalles menores)</SelectItem>
                          <SelectItem value="50">Regular (Rayones visibles)</SelectItem>
                          <SelectItem value="25">Malo (Requiere pintura)</SelectItem>
                          <SelectItem value="0">Pésimo (Daño mayor)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="hasAgencyHistory"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-slate-500">Historial de Agencia</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="¿Tiene récord?" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Sí">Sí</SelectItem>
                          <SelectItem value="No">No</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
          </div>

          {!aiValuation ? (
            <>
              <Button
                type="button"
                onClick={getAIValuation}
                disabled={loadingAI || aiAttemptCount >= MAX_AI_ATTEMPTS}
                className="w-full"
              >
                {loadingAI ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {aiLoadingMessage}
                  </>
                ) : (
                  <>
                    <TrendingUp className="h-4 w-4 mr-2" />
                    {aiAttemptCount > 0 ? 'Reintentar Valoración por IA' : 'Obtener Valoración por IA'}
                  </>
                )}
              </Button>
              {loadingAI && (
                <p className="text-xs text-muted-foreground text-center mt-2">
                  La valoración con búsqueda en internet puede tardar varios segundos. No cierre esta pantalla mientras termina.
                </p>
              )}
              {aiAttemptCount >= MAX_AI_ATTEMPTS && aiFailed && (
                <p className="text-xs text-muted-foreground text-center mt-2">
                  Se alcanzó el límite de intentos. Complete la valoración manualmente.
                </p>
              )}
            </>
          ) : (
            <div className="space-y-4">
              <Alert className="border-green-200 bg-green-50 grid-cols-[auto_1fr]! gap-x-2 items-center py-2 sm:py-3">
                <QuetzalIcon className="text-green-600" />
                <AlertDescription className="text-green-800 text-xs sm:text-sm col-start-auto!">
                  <strong>Valoración Sugerida: Q{aiValuation.suggestedValue.toLocaleString()}</strong>
                </AlertDescription>
              </Alert>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs sm:text-sm">
                <div>
                  <h4 className="font-medium mb-1 sm:mb-2">Análisis de Mercado:</h4>
                  <p className="text-muted-foreground leading-relaxed">{aiValuation.marketAnalysis}</p>
                </div>
                <div>
                  <h4 className="font-medium mb-1 sm:mb-2">Factores de Depreciación:</h4>
                  <ul className="text-muted-foreground space-y-0.5 sm:space-y-1">
                    {aiValuation.depreciationFactors.map((factor, idx) => (
                      <li key={idx}>• {factor}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Manual Valuation Form */}
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Valuation Section */}
          <Card>
            <CardHeader>
              <CardTitle>Valoración del Vehículo</CardTitle>
              <CardDescription>
                Complete la valoración manual basada en su inspección
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <FormField
                control={form.control}
                name="vehicleRating"
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel className="flex items-center gap-2">
                      Calificación del vehículo
                      {aiValuation?.commercialClassification && (
                        <span className={`text-xs px-2 py-1 rounded ${aiValuation.commercialClassification === "Comercial"
                          ? "bg-green-100 text-green-700"
                          : "bg-orange-100 text-orange-700"
                          }`}>
                          IA: {aiValuation.commercialClassification}
                        </span>
                      )}
                    </FormLabel>
                    {aiValuation?.commercialClassificationReasoning && (
                      <p className="text-xs text-muted-foreground">
                        {aiValuation.commercialClassificationReasoning}
                      </p>
                    )}
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        value={field.value}
                        className="flex flex-col space-y-1"
                      >
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="Comercial" />
                          </FormControl>
                          <FormLabel className="font-normal">
                            Comercial
                          </FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="No comercial" />
                          </FormControl>
                          <FormLabel className="font-normal">
                            No comercial
                          </FormLabel>
                        </FormItem>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="marketValue"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        Valor de mercado
                        {aiValuation?.baseMarketValue && (
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
                            IA: Sugerido
                          </span>
                        )}
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Valor de mercado referencial"
                          value={formatCurrency(field.value || "")}
                          onChange={(e) => {
                            const result = handleCurrencyInput(e.target.value);
                            field.onChange(result.raw);
                          }}
                          onBlur={field.onBlur}
                          name={field.name}
                          readOnly // NO se debería poder modificar
                          className="bg-slate-50 cursor-not-allowed border-green-200"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="currentConditionValue"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        Valor en condiciones actuales
                        {aiValuation && (
                          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                            IA: Q{aiValuation.suggestedValue.toLocaleString()}
                          </span>
                        )}
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Valor en moneda local"
                          value={formatCurrency(field.value || "")}
                          onChange={(e) => {
                            const result = handleCurrencyInput(e.target.value);
                            field.onChange(result.raw);
                          }}
                          onBlur={field.onBlur}
                          name={field.name}
                          className="border-green-400"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="vehicleEquipment"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Equipamiento del vehículo</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Ej: Aire AC, cámaras de reversa, tapicería de cuero, sistema de navegación, sensores de estacionamiento, techo panorámico, etc."
                        className="min-h-[100px]"
                        {...field}
                        value={field.value || ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="importantConsiderations"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Aspectos importantes a considerar</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Observaciones sobre estado físico, legal o técnico del vehículo"
                        className="min-h-[100px]"
                        {...field}
                        value={field.value || ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="inspectionResult"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Observaciones generales de la inspección</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Describa el estado general del vehículo y observaciones relevantes"
                        className="min-h-[100px]"
                        {...field}
                        value={field.value || ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="scannerUsed"
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel>¿Se le pasó escáner al vehículo?</FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        value={field.value}
                        className="flex flex-col space-y-1"
                      >
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="Sí" />
                          </FormControl>
                          <FormLabel className="font-normal">Sí</FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="No" />
                          </FormControl>
                          <FormLabel className="font-normal">No</FormLabel>
                        </FormItem>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {form.watch("scannerUsed") === "Sí" && (
                <FormField
                  control={form.control}
                  name="scannerResult"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Resultado del scanner (subir PDF)</FormLabel>
                      <FormControl>
                        <Input
                          type="file"
                          accept=".pdf"
                          onChange={(e) => {
                            handleScannerUpload(e);
                            field.onChange(e.target.files?.[0] || undefined);
                          }}
                          className="flex-1"
                        />
                      </FormControl>
                      {scannerFile && (
                        <FormDescription className="text-green-600">
                          Archivo cargado: {scannerFile.name}
                        </FormDescription>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="airbagWarning"
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel>¿Presenta testigos de airbag u otros en tablero?</FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        value={field.value}
                        className="flex flex-col space-y-1"
                      >
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="Sí" />
                          </FormControl>
                          <FormLabel className="font-normal">Sí</FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="No" />
                          </FormControl>
                          <FormLabel className="font-normal">No</FormLabel>
                        </FormItem>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {form.watch("airbagWarning") === "Sí" && (
                <FormField
                  control={form.control}
                  name="missingAirbag"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Indique qué airbag no posee</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Ej. Airbag lateral izquierdo"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </CardContent>
          </Card>

          {isWizardMode && (
            <Button type="submit" className="w-full" disabled={isSubmitting || uploadingScanner}>
              {(isSubmitting || uploadingScanner) ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {uploadingScanner ? "Subiendo scanner..." : "Enviando inspección..."}
                </>
              ) : (
                "Finalizar Inspección"
              )}
            </Button>
          )}
        </form>
      </div>
    </Form>
  );
}
