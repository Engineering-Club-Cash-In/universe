import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  AlertCircle,
  FileText,
  CheckCircle,
  CheckCheck,
  CopyMinus,
} from "lucide-react";
import { documentsService, documentsKeys } from "@/services/documents";

interface Step1Props {
  readonly data: {
    documentTypes?: string[];
  };
  readonly onChange: (field: string, value: string[]) => void;
}

export function Step1({ data, onChange }: Step1Props) {
  // Obtener tipos de documentos desde la API
  const {
    data: documentsResponse,
    isLoading,
    error,
    isError,
  } = useQuery({
    queryKey: documentsKeys.types(),
    queryFn: documentsService.getDocumentTypes,
    staleTime: 5 * 60 * 1000, // 5 minutos
    gcTime: 10 * 60 * 1000, // 10 minutos
  });

  const documentTypes = documentsResponse?.data || [];
  const selectedDocuments = data.documentTypes || [];

  // Función para manejar la selección/deselección de un documento
  const handleDocumentToggle = (documentEnum: string) => {
    const currentSelected = selectedDocuments.includes(documentEnum);

    if (currentSelected) {
      // Remover del array
      const newSelection = selectedDocuments.filter(
        (item) => item !== documentEnum
      );
      onChange("documentTypes", newSelection);
    } else {
      // Agregar al array
      const newSelection = [...selectedDocuments, documentEnum];
      onChange("documentTypes", newSelection);
    }
  };

  // Función para seleccionar/deseleccionar todos
  const handleSelectAll = () => {
    if (selectedDocuments.length === documentTypes.length) {
      // Deseleccionar todos
      onChange("documentTypes", []);
    } else {
      // Seleccionar todos
      const allEnums = documentTypes.map((doc) => doc.enum);
      onChange("documentTypes", allEnums);
    }
  };

  const isAllSelected =
    selectedDocuments.length === documentTypes.length &&
    documentTypes.length > 0;

  // Estado de carga
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin mb-4" />
        <h3 className="text-lg font-medium mb-2">
          Cargando documentos disponibles
        </h3>
        <p className="text-muted-foreground text-center">
          Estamos obteniendo la lista de documentos legales que puedes
          generar...
        </p>
      </div>
    );
  }

  // Estado de error
  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="ml-2">
            <strong>Error al cargar documentos:</strong>
            <br />
            {error?.message ||
              "No se pudieron cargar los tipos de documentos. Por favor, intenta de nuevo."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {documentTypes.length === 0 ? (
        <div className="text-center py-12">
          <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">
            No hay documentos disponibles
          </h3>
          <p className="text-muted-foreground">
            No se encontraron tipos de documentos para generar.
          </p>
        </div>
      ) : (
        <>
          {/* Botón Seleccionar/Deseleccionar Todos */}
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">
              {selectedDocuments.length} de {documentTypes.length} documentos
              seleccionados
            </p>
            <Button
              variant={"outline"}
              onClick={handleSelectAll}
              className="text-sm font-medium text-primary"
            >
              {isAllSelected ? (
                <CopyMinus className="h-4 w-4 inline-block mr-1" />
              ) : (
                <CheckCheck className="h-4 w-4 inline-block mr-1" />
              )}
              {isAllSelected ? "Deseleccionar todos" : "Seleccionar todos"}
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {documentTypes.map((document) => {
              const isSelected = selectedDocuments.includes(document.enum);

              return (
                <Card
                  key={document.enum}
                  className={`cursor-pointer transition-all duration-200 hover:shadow-md border-2 ${
                    isSelected
                      ? "border-primary bg-primary/5 shadow-md"
                      : "border-muted hover:border-primary/50"
                  }`}
                  onClick={() => handleDocumentToggle(document.enum)}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-2">
                        <FileText className="h-5 w-5 text-primary" />
                        {isSelected && (
                          <CheckCircle className="h-4 w-4 text-primary" />
                        )}
                      </div>
                      {isSelected && (
                        <Badge variant="default" className="text-xs">
                          Seleccionado
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <CardTitle className="text-base mb-2 leading-tight">
                      {document.label}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      Documento legal personalizado
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
