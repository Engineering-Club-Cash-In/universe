import React, { useState, useRef } from 'react';
import { Camera, Upload, Loader2, CheckCircle, AlertCircle, X } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Alert, AlertDescription } from './ui/alert';
import { Badge } from './ui/badge';
import { toast } from 'sonner';
import { vehiclesApi } from '../utils/orpc';

interface OCRResult {
  success: boolean;
  ocrData: any;
  mappedFormData: any;
  message: string;
  error?: string;
}

interface VehicleRegistrationOCRProps {
  onDataExtracted: (data: any) => void;
  isProcessing?: boolean;
}

export default function VehicleRegistrationOCR({ 
  onDataExtracted, 
  isProcessing = false 
}: VehicleRegistrationOCRProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>('');
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<OCRResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (file: File) => {
    if (!file) return;

    // Validate file type
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
    if (!validTypes.includes(file.type)) {
      toast.error('Por favor seleccione una imagen (JPG, PNG) o archivo PDF');
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast.error('El archivo es demasiado grande. Máximo 10MB permitido');
      return;
    }

    setSelectedFile(file);
    setResult(null);

    // Create preview for images
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setPreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      setPreview('');
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const processOCR = async () => {
    if (!selectedFile) {
      toast.error('Por favor seleccione un archivo primero');
      return;
    }

    setProcessing(true);
    setResult(null);

    try {
      // Convert file to base64
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = reader.result as string;
          const base64Data = base64.split(',')[1]; // Remove data:image/...;base64, prefix

          // Send to backend OCR endpoint using ORPC client
          const ocrResult: OCRResult = await vehiclesApi.processRegistrationOCR({
            imageBase64: base64Data,
            mimeType: selectedFile.type,
          });
          setResult(ocrResult);

          if (ocrResult.success && ocrResult.mappedFormData) {
            toast.success(ocrResult.message);
            onDataExtracted(ocrResult.mappedFormData);
          } else {
            toast.warning(ocrResult.message);
            // Still pass the data even if partially extracted
            if (ocrResult.mappedFormData) {
              onDataExtracted(ocrResult.mappedFormData);
            }
          }
        } catch (error) {
          console.error('OCR processing error:', error);
          toast.error('Error al procesar la imagen. Intente nuevamente.');
          setResult({
            success: false,
            ocrData: {},
            mappedFormData: {},
            message: 'Error al procesar la imagen',
            error: error instanceof Error ? error.message : 'Error desconocido'
          });
        } finally {
          setProcessing(false);
        }
      };

      reader.onerror = () => {
        toast.error('Error al leer el archivo');
        setProcessing(false);
      };

      reader.readAsDataURL(selectedFile);
    } catch (error) {
      console.error('Error in processOCR:', error);
      toast.error('Error al procesar el archivo');
      setProcessing(false);
    }
  };

  const clearSelection = () => {
    setSelectedFile(null);
    setPreview('');
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Camera className="h-5 w-5" />
          Escanear Tarjeta de Circulación
        </CardTitle>
        <CardDescription>
          Tome una foto o suba una imagen de la tarjeta de circulación para llenar automáticamente la información del vehículo
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* File Selection */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Button
            variant="outline"
            onClick={() => cameraInputRef.current?.click()}
            disabled={processing || isProcessing}
            className="h-24 flex-col gap-2"
          >
            <Camera className="h-6 w-6" />
            <span>Tomar Foto</span>
          </Button>
          
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={processing || isProcessing}
            className="h-24 flex-col gap-2"
          >
            <Upload className="h-6 w-6" />
            <span>Subir Archivo</span>
          </Button>
        </div>

        {/* Hidden file inputs */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileUpload}
          className="hidden"
        />
        
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          onChange={handleFileUpload}
          className="hidden"
        />

        {/* File Preview */}
        {selectedFile && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">
                  {selectedFile.name}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearSelection}
                disabled={processing}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {preview && (
              <div className="relative">
                <img
                  src={preview}
                  alt="Preview"
                  className="w-full max-h-64 object-contain rounded-lg border"
                />
              </div>
            )}

            {selectedFile.type === 'application/pdf' && (
              <div className="p-4 border rounded-lg text-center">
                <p className="text-sm text-muted-foreground">
                  Archivo PDF seleccionado: {selectedFile.name}
                </p>
              </div>
            )}

            {/* Process Button */}
            <Button
              onClick={processOCR}
              disabled={processing || isProcessing}
              className="w-full"
            >
              {processing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Procesando imagen...
                </>
              ) : (
                <>
                  <Camera className="h-4 w-4 mr-2" />
                  Extraer Información
                </>
              )}
            </Button>
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-3">
            <div className={`p-3 rounded-lg border ${result.success ? "border-green-200 bg-green-50" : "border-orange-200 bg-orange-50"}`}>
              <div className="flex items-start gap-3">
                {result.success ? (
                  <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-orange-600 mt-0.5 flex-shrink-0" />
                )}
                <div className={`${result.success ? "text-green-800" : "text-orange-800"} text-sm leading-relaxed min-w-0 flex-1`}>
                  {result.message}
                </div>
              </div>
            </div>

            {result.error && (
              <Alert className="border-red-200 bg-red-50">
                <AlertCircle className="h-4 w-4 text-red-600" />
                <AlertDescription className="text-red-800">
                  Error: {result.error}
                </AlertDescription>
              </Alert>
            )}

            {/* Show extracted data summary */}
            {result.ocrData && result.success && (
              <div className="p-3 bg-gray-50 rounded-lg">
                <h4 className="font-medium text-sm mb-2">Información Extraída:</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                  {result.ocrData.licensePlate && (
                    <div><strong>Placa:</strong> {result.ocrData.licensePlate}</div>
                  )}
                  {result.ocrData.make && (
                    <div><strong>Marca:</strong> {result.ocrData.make}</div>
                  )}
                  {result.ocrData.line && (
                    <div><strong>Línea:</strong> {result.ocrData.line}</div>
                  )}
                  {result.ocrData.model && (
                    <div><strong>Año:</strong> {result.ocrData.model}</div>
                  )}
                  {result.ocrData.color && (
                    <div><strong>Color:</strong> {result.ocrData.color}</div>
                  )}
                  {result.ocrData.vin && (
                    <div><strong>VIN:</strong> {result.ocrData.vin}</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Instructions */}
        <div className="text-xs text-muted-foreground space-y-1">
          <p>• Asegúrese de que la tarjeta sea legible y esté bien iluminada</p>
          <p>• Formatos soportados: JPG, PNG, PDF (máximo 10MB)</p>
          <p>• La información extraída se completará automáticamente en el formulario</p>
        </div>
      </CardContent>
    </Card>
  );
}