import React, { useState } from 'react';
import { DollarSign, Sparkles, Loader2, TrendingUp } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';
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
import { formatCurrency, handleCurrencyInput } from '../utils/currency';
import { toast } from 'sonner';
import { vehiclesApi } from '../utils/orpc';
import { useInspection } from '../contexts/InspectionContext';

const valuationSchema = z.object({
  vehicleRating: z.enum(["Comercial", "No comercial"], {
    message: "La calificación es requerida",
  }),
  marketValue: z
    .string({ message: "El valor de mercado es requerido" })
    .min(1, { message: "El valor de mercado es requerido" }),
  suggestedCommercialValue: z
    .string({ message: "El valor comercial sugerido es requerido" })
    .min(1, { message: "El valor comercial sugerido es requerido" }),
  bankValue: z
    .string({ message: "El valor bancario es requerido" })
    .min(1, { message: "El valor bancario es requerido" }),
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
  scannerResult: z.instanceof(File).optional(),
  airbagWarning: z.enum(["Sí", "No"], {
    message: "Esta información es requerida",
  }),
  missingAirbag: z.string().optional(),
  testDrive: z.enum(["Sí", "No"], {
    message: "Esta información es requerida",
  }),
  noTestDriveReason: z.string().optional(),
});

interface VehicleValuationProps {
  vehicleData: any; // Data from previous steps
  onComplete: (valuationData: z.infer<typeof valuationSchema>) => void;
  isWizardMode?: boolean;
}

interface AIValuationResult {
  suggestedValue: number;
  reasoning: string;
  marketAnalysis: string;
  depreciationFactors: string[];
  confidence: string;
}

export default function VehicleValuation({ 
  vehicleData, 
  onComplete, 
  isWizardMode = false 
}: VehicleValuationProps) {
  const { checklistItems, photos } = useInspection();
  const [aiValuation, setAiValuation] = useState<AIValuationResult | null>(null);
  const [loadingAI, setLoadingAI] = useState(false);
  const [scannerFile, setScannerFile] = useState<File | null>(null);

  const form = useForm<z.infer<typeof valuationSchema>>({
    resolver: zodResolver(valuationSchema),
    defaultValues: {
      vehicleRating: undefined,
      marketValue: "",
      suggestedCommercialValue: "",
      bankValue: "",
      currentConditionValue: "",
      vehicleEquipment: "",
      importantConsiderations: "",
      scannerUsed: undefined,
      airbagWarning: undefined,
      testDrive: undefined,
    },
  });

  const handleScannerUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.type === "application/pdf") {
        setScannerFile(file);
        form.setValue("scannerResult", file);
      } else {
        alert("Por favor suba un archivo PDF");
      }
    }
  };

  const getAIValuation = async () => {
    setLoadingAI(true);
    
    try {
      // Call AI valuation endpoint with complete context
      const result = await vehiclesApi.getAIValuation({
        vehicleData,
        checklistItems,
        photos
      });
      
      const aiResult: AIValuationResult = {
        suggestedValue: result.valuation.suggestedValue,
        reasoning: result.valuation.reasoning,
        marketAnalysis: result.valuation.marketAnalysis,
        depreciationFactors: result.valuation.depreciationFactors,
        confidence: result.valuation.confidence
      };
      
      setAiValuation(aiResult);
      
      // Auto-fill suggested value
      form.setValue("currentConditionValue", aiResult.suggestedValue.toString());
      
      toast.success("Valoración por IA completada");
    } catch (error) {
      toast.error("Error al obtener valoración por IA. Complete manualmente.");
      console.error(error);
    } finally {
      setLoadingAI(false);
    }
  };

  const onSubmit = (values: z.infer<typeof valuationSchema>) => {
    onComplete(values);
  };

  return (
    <div className="space-y-6">
      {/* AI Valuation Section */}
      <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-blue-600" />
            Valoración Inteligente
          </CardTitle>
          <CardDescription>
            Obtenga una valoración estimada del vehículo basada en IA
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!aiValuation ? (
            <Button 
              onClick={getAIValuation}
              disabled={loadingAI}
              className="w-full"
            >
              {loadingAI ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Analizando vehículo...
                </>
              ) : (
                <>
                  <TrendingUp className="h-4 w-4 mr-2" />
                  Obtener Valoración por IA
                </>
              )}
            </Button>
          ) : (
            <div className="space-y-4">
              <Alert className="border-green-200 bg-green-50">
                <DollarSign className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-800">
                  <strong>Valoración Sugerida: Q{aiValuation.suggestedValue.toLocaleString()}</strong>
                </AlertDescription>
              </Alert>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <h4 className="font-medium mb-2">Análisis de Mercado:</h4>
                  <p className="text-muted-foreground">{aiValuation.marketAnalysis}</p>
                </div>
                <div>
                  <h4 className="font-medium mb-2">Factores de Depreciación:</h4>
                  <ul className="text-muted-foreground space-y-1">
                    {aiValuation.depreciationFactors.map((factor, idx) => (
                      <li key={idx}>• {factor}</li>
                    ))}
                  </ul>
                </div>
              </div>
              
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setAiValuation(null)}
              >
                Obtener Nueva Valoración
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Manual Valuation Form */}
      <Form {...form}>
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
                    <FormLabel>Calificación del vehículo</FormLabel>
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <FormField
                  control={form.control}
                  name="marketValue"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Valor de mercado</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Valor en moneda local"
                          value={formatCurrency(field.value)}
                          onChange={(e) => {
                            const result = handleCurrencyInput(e.target.value);
                            field.onChange(result.raw);
                          }}
                          onBlur={field.onBlur}
                          name={field.name}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="suggestedCommercialValue"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Valor comercial sugerido</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Valor en moneda local"
                          value={formatCurrency(field.value)}
                          onChange={(e) => {
                            const result = handleCurrencyInput(e.target.value);
                            field.onChange(result.raw);
                          }}
                          onBlur={field.onBlur}
                          name={field.name}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <FormField
                  control={form.control}
                  name="bankValue"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Valor bancario</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Valor en moneda local"
                          value={formatCurrency(field.value)}
                          onChange={(e) => {
                            const result = handleCurrencyInput(e.target.value);
                            field.onChange(result.raw);
                          }}
                          onBlur={field.onBlur}
                          name={field.name}
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
                        Valor condiciones actuales
                        {aiValuation && (
                          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                            IA: Q{aiValuation.suggestedValue.toLocaleString()}
                          </span>
                        )}
                      </FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Valor en moneda local"
                          value={formatCurrency(field.value)}
                          onChange={(e) => {
                            const result = handleCurrencyInput(e.target.value);
                            field.onChange(result.raw);
                          }}
                          onBlur={field.onBlur}
                          name={field.name}
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
                            field.onChange(e.target.files?.[0] || null);
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

              <FormField
                control={form.control}
                name="testDrive"
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel>¿Se realizó prueba de manejo?</FormLabel>
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

              {form.watch("testDrive") === "No" && (
                <FormField
                  control={form.control}
                  name="noTestDriveReason"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Indique por qué no se realizó la prueba de manejo
                      </FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Razón por la que no se realizó la prueba"
                          className="min-h-[80px]"
                          {...field}
                          value={field.value || ""}
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
            <Button type="submit" className="w-full">
              Finalizar Inspección
            </Button>
          )}
        </form>
      </Form>
    </div>
  );
}