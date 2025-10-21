import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle,
  FileText,
  ExternalLink,
  Mail,
  Clock,
  Copy,
} from "lucide-react";
import { type GenerateDocumentsResponse } from "@/services/documents";

interface Step4Props {
  readonly documentsResponse: GenerateDocumentsResponse | null;
  readonly isLoading: boolean;
}

// Función para copiar todos los links al portapapeles
const copyAllLinksToClipboard = (
  documentsResponse: GenerateDocumentsResponse
) => {
  const { results = [] } = documentsResponse;

  const allLinks = results.flatMap((result) => {
    const name = result.nameDocument?.[0]?.label || `Template-${result.templateId}`;
    const link = result.data?.[0]?.embed_src || "No Link Available";
    return [`${name}: ${link}`];
  });

  const textToCopy = allLinks.join("\n\n");

  navigator.clipboard
    .writeText(textToCopy)
    .then(() => {
      alert("✅ Todos los enlaces han sido copiados al portapapeles");
    })
    .catch(() => {
      alert("❌ Error al copiar los enlaces");
    });
};

export function Step4({ documentsResponse, isLoading }: Step4Props) {
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="text-center space-y-4">
          <div className="animate-spin w-12 h-12 border-4 border-primary border-t-transparent rounded-full mx-auto"></div>
          <h2 className="text-2xl font-bold">Generando Documentos</h2>
          <p className="text-muted-foreground">
            Por favor espera mientras procesamos tus documentos...
          </p>
        </div>
      </div>
    );
  }

  if (!documentsResponse || !documentsResponse.success) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <FileText className="h-8 w-8 text-red-600" />
        </div>
        <h3 className="text-lg font-medium mb-2 text-red-700">
          Error al generar documentos
        </h3>
        <p className="text-muted-foreground">
          {documentsResponse?.message ||
            "Hubo un problema al generar los documentos. Por favor, intenta de nuevo."}
        </p>
      </div>
    );
  }

  const { results = [] } = documentsResponse;
  const totalDocuments = results.reduce(
    (acc, result) => acc + result.data.length,
    0
  );

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="h-8 w-8 text-green-600" />
        </div>
        <h2 className="text-2xl font-bold text-green-700">
          ¡Documentos Generados Exitosamente!
        </h2>
        <p className="text-muted-foreground">
          {documentsResponse.message ||
            `Se generaron ${totalDocuments} documentos correctamente`}
        </p>
      </div>

      {/* Resumen General */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Resumen de Generación
            </div>
            <button
              onClick={() => copyAllLinksToClipboard(documentsResponse)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium"
            >
              <Copy className="h-4 w-4" />
              Copiar Todos los Enlaces
            </button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
            <div className="p-4 bg-blue-50 rounded-lg">
              <div className="text-2xl font-bold text-blue-600">
                {results.length}
              </div>
              <div className="text-sm text-blue-700">Plantillas Procesadas</div>
            </div>
            <div className="p-4 bg-green-50 rounded-lg">
              <div className="text-2xl font-bold text-green-600">
                {totalDocuments}
              </div>
              <div className="text-sm text-green-700">Documentos Creados</div>
            </div>
            <div className="p-4 bg-purple-50 rounded-lg">
              <div className="text-2xl font-bold text-purple-600">
                {results.filter((r) => r.success).length}
              </div>
              <div className="text-sm text-purple-700">Exitosos</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lista de Documentos Generados */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Documentos Generados</h3>

        {results.map((result, index) => (
          <Card
            key={`template-${result.templateId}`}
            className="overflow-hidden"
          >
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">
                  Plantilla ID: {result.templateId}
                </CardTitle>
                <Badge variant={result.success ? "default" : "destructive"}>
                  {result.success ? "Exitoso" : "Error"}
                </Badge>
              </div>
            </CardHeader>

            {result.success &&
              result.data.map((submission) => (
                <CardContent key={submission.id} className="pt-0">
                  <div className="space-y-4">
                    {/* Información del Documento */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Mail className="h-4 w-4 text-blue-500" />
                          <span className="font-medium">Email:</span>
                          <span>{submission.email}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-green-500" />
                          <span className="font-medium">Estado:</span>
                          <Badge variant="outline" className="text-xs">
                            {submission.status}
                          </Badge>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div>
                          <span className="font-medium">ID:</span>
                          <span className="ml-2">{submission.id}</span>
                        </div>
                        <div>
                          <span className="font-medium">Enviado:</span>
                          <span className="ml-2">
                            {new Date(submission.sent_at).toLocaleString(
                              "es-GT"
                            )}
                          </span>
                        </div>
                      </div>
                    </div>

                    <Separator />

                    {/* Acceso al Documento */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="font-medium">Documento Generado</h4>
                      </div>

                      {/* Tarjeta de Documento con Botones de Acción */}
                      <div className="border rounded-lg p-6 bg-gradient-to-r from-blue-50 to-indigo-50">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                              <FileText className="h-6 w-6 text-blue-600" />
                            </div>
                            <div>
                              <h5 className="font-semibold text-gray-900">
                                {result.nameDocument[0]?.label ||
                                  `Documento #${submission.id}`}
                              </h5>
                              <p className="text-xs text-gray-500 mb-1">
                                ID: {submission.id}
                              </p>
                              <p className="text-sm text-gray-600">
                                Estado:{" "}
                                <span className="font-medium text-green-600">
                                  {submission.status}
                                </span>
                              </p>
                              <p className="text-xs text-gray-500">
                                Enviado:{" "}
                                {new Date(submission.sent_at).toLocaleString(
                                  "es-GT"
                                )}
                              </p>
                            </div>
                          </div>

                          <div className="flex flex-col gap-2">
                            <a
                              href={submission.embed_src}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium"
                            >
                              <ExternalLink className="h-4 w-4" />
                              Abrir Documento
                            </a>
                            <button
                              onClick={() => {
                                const documentName =
                                  result.nameDocument[0]?.label ||
                                  `Documento #${submission.id}`;
                                const textToCopy = `${documentName}: ${submission.embed_src}`;
                                navigator.clipboard.writeText(textToCopy);
                              }}
                              className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 bg-white text-gray-700 rounded-md hover:bg-gray-50 transition-colors text-sm"
                            >
                              📋 Copiar Enlace
                            </button>
                          </div>
                        </div>

                        {/* URL del documento (truncada) */}
                        <div className="mt-3 p-2 bg-gray-100 rounded text-xs font-mono text-gray-600 break-all">
                          🔗{" "}
                          {submission.embed_src.length > 80
                            ? submission.embed_src.substring(0, 80) + "..."
                            : submission.embed_src}
                        </div>
                      </div>
                    </div>
                  </div>

                  {index < result.data.length - 1 && (
                    <Separator className="mt-4" />
                  )}
                </CardContent>
              ))}
          </Card>
        ))}
      </div>

      {/* Acciones Finales */}
      <Card>
        <CardContent className="pt-6">
          <div className="text-center space-y-4">
            <h4 className="font-medium">¿Qué sigue?</h4>
            <p className="text-sm text-muted-foreground">
              Los documentos han sido enviados por correo electrónico. Los
              destinatarios recibirán un enlace para revisar y firmar los
              documentos.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
              >
                Generar Nuevos Documentos
              </button>
              <button
                onClick={() => window.print()}
                className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
              >
                Imprimir Resumen
              </button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
