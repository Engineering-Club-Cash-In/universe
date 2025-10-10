import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CheckCircle, AlertCircle, User, Calendar } from "lucide-react";
import { type Document, type Field, type RenapData } from "../hooks/useStep2";
import { useStep3 } from "../hooks/useStep3";

interface Step3Props {
  readonly data: {
    documentTypes?: string[];
    renapData?: RenapData;
    documents?: Document[];
    fields?: Field[];
    fieldValues?: Record<string, string>;
  };
  readonly onChange: (field: string, value: Record<string, string>) => void;
  readonly onValidationChange?: (isValid: boolean) => void;
  readonly shouldValidate?: boolean;
}

export function Step3({
  data,
  onChange,
  onValidationChange,
  shouldValidate,
}: Step3Props) {
  const { documents = [], fields = [], renapData } = data;

  const {
    fieldValues,
    fieldErrors,
    selectedDocuments,
    relevantFields,
    handleFieldChange,
  } = useStep3({
    documents,
    fields,
    renapData,
    initialFieldValues: data.fieldValues || {},
    onChange,
    onValidationChange,
    shouldValidate,
  });

  if (!documents.length) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium mb-2">
          No hay documentos disponibles
        </h3>
        <p className="text-muted-foreground">
          No se encontraron documentos para generar. Regresa al paso anterior.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold">Configuración de Documentos</h2>
        <p className="text-muted-foreground">
          Selecciona los documentos a generar y completa la información
          requerida
        </p>
      </div>

      {/* Información del Firmante */}
      {renapData && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Información del Firmante
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-4">
              <img
                src={renapData.picture}
                alt="Foto DPI"
                className="w-16 h-16 rounded-lg object-cover border-2 border-muted"
                onError={(e) => {
                  e.currentTarget.src = "/placeholder-avatar.png";
                }}
              />
              <div>
                <h3 className="font-semibold">
                  {renapData.firstName} {renapData.secondName}{" "}
                  {renapData.firstLastName} {renapData.secondLastName}
                </h3>
                <p className="text-muted-foreground">DPI: {renapData.dpi}</p>
                <p className="text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {renapData.birthDate}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Campos del Formulario */}
      {relevantFields.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Información Requerida</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {relevantFields.map((field) => (
                <div key={field.key} className="space-y-2">
                  <Label htmlFor={field.key}>
                    {field.name}
                    {field.required && (
                      <span className="text-red-500 ml-1">*</span>
                    )}
                  </Label>
                  <Input
                    id={field.key}
                    value={fieldValues[field.key] || ""}
                    onChange={(e) =>
                      handleFieldChange(field.key, e.target.value)
                    }
                    placeholder={`Ingresa ${field.name.toLowerCase()}`}
                    className={fieldErrors[field.key] ? "border-red-500" : ""}
                  />
                  {fieldErrors[field.key] && (
                    <p className="text-sm text-red-600 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      {fieldErrors[field.key]}
                    </p>
                  )}
                
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Resumen */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5" />
            Resumen de Generación
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <h4 className="font-medium mb-2">Documentos a generar:</h4>
              <div className="space-y-1">
                {documents
                  .filter((doc) => selectedDocuments.includes(doc.id))
                  .map((doc) => (
                    <div key={doc.id} className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                      <span className="text-sm">{doc.descripcion}</span>
                    </div>
                  ))}
              </div>
            </div>

            <Separator />

            <div>
              <h4 className="font-medium mb-2">Campos completados:</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {relevantFields.map((field) => (
                  <div key={field.key} className="flex items-center gap-2">
                    {fieldValues[field.key] && !fieldErrors[field.key] ? (
                      <CheckCircle className="h-3 w-3 text-green-500" />
                    ) : (
                      <AlertCircle className="h-3 w-3 text-red-500" />
                    )}
                    <span
                      className={
                        fieldValues[field.key] && !fieldErrors[field.key]
                          ? "text-green-700"
                          : "text-red-700"
                      }
                    >
                      {field.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-6 p-4 bg-primary/10 border border-primary/20 rounded-lg">
            <h4 className="font-medium text-primary mb-2">
              ¿Listo para generar?
            </h4>
            <p className="text-sm text-muted-foreground">
              Se generarán <strong>{selectedDocuments.length}</strong>{" "}
              documentos con{" "}
              <strong>
                {
                  relevantFields.filter(
                    (f) => fieldValues[f.key] && !fieldErrors[f.key]
                  ).length
                }
              </strong>{" "}
              de <strong>{relevantFields.length}</strong> campos completados
              correctamente.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
