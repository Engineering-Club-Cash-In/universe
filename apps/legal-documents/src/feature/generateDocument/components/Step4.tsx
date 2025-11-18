import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CheckCircle, FileText, ExternalLink, Copy } from "lucide-react";
import { type GenerateDocumentsResponse } from "@/services/documents";

interface Step4Props {
  readonly documentsResponse: GenerateDocumentsResponse | null;
  readonly isLoading: boolean;
}

// Función para copiar todos los links de clientes al portapapeles
const copyAllClientLinks = (documentsResponse: GenerateDocumentsResponse) => {
  const { results = [] } = documentsResponse;

  const clientLinks = results.flatMap((result) => {
    const name =
      result.nameDocument?.[0]?.label || `Template-${result.templateId}`;
    // El link del cliente es el embed_src (primer link)
    const link = result.data?.[0]?.embed_src || "No Link Available";
    return [`${name} (Cliente): ${link}`];
  });

  const textToCopy = clientLinks.join("\n\n");

  navigator.clipboard
    .writeText(textToCopy)
    .then(() => {
      alert("✅ Todos los enlaces de clientes han sido copiados al portapapeles");
    })
    .catch(() => {
      alert("❌ Error al copiar los enlaces");
    });
};

// Función para copiar todos los links de representantes al portapapeles
const copyAllRepresentativeLinks = (
  documentsResponse: GenerateDocumentsResponse
) => {
  const { results = [] } = documentsResponse;

  const representativeLinks = results.flatMap((result) => {
    const name =
      result.nameDocument?.[0]?.label || `Template-${result.templateId}`;
    const clientLink = result.data?.[0]?.embed_src;
    
    // Los signing_links contienen todos los links
    // Filtrar para obtener solo los que NO son del cliente (representante y otros)
    const signingLinks = result.signing_links || [];
    const otherLinks = signingLinks.filter(link => link !== clientLink);
    
    if (otherLinks.length === 0) {
      return [];
    }
    
    // El primer link que no es del cliente es el del representante
    const representativeLink = otherLinks[0];
    return [`${name} (Representante): ${representativeLink}`];
  });

  if (representativeLinks.length === 0) {
    alert("ℹ️ No hay enlaces de representantes disponibles");
    return;
  }

  const textToCopy = representativeLinks.join("\n\n");

  navigator.clipboard
    .writeText(textToCopy)
    .then(() => {
      alert("✅ Todos los enlaces de representantes han sido copiados al portapapeles");
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
            <div className="flex gap-2">
              <button
                onClick={() => copyAllClientLinks(documentsResponse)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium"
              >
                <Copy className="h-4 w-4" />
                Copiar Enlaces Clientes
              </button>
              <button
                onClick={() => copyAllRepresentativeLinks(documentsResponse)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors text-sm font-medium"
              >
                <Copy className="h-4 w-4" />
                Copiar Enlaces Representantes
              </button>
            </div>
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
          <>
            {result.success &&
              result.data.map((submission) => (
                <div key={submission.id} className="pt-0">
                  <div className="space-y-4">
                    {/* Información del Documento */}

                    {/* Acceso al Documento */}
                    <div className="space-y-3">
                      {/* Tarjeta de Documento con Botones de Acción */}
                      <div className="border rounded-lg p-6 bg-gradient-to-r ">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                              <FileText className="h-6 w-6 text-blue-600" />
                            </div>
                            <div>
                              <h5 className="font-semibold text-gray-900">
                                {result.nameDocument[0]?.label ||
                                  `Documento #${submission.id}`}
                              </h5>
                              <p className="text-xs text-gray-500">
                                Creado el: {" "}
                                {new Date(submission.created_at).toLocaleString(
                                  "es-GT"
                                )}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Enlaces disponibles */}
                        <div className="space-y-3">
                          {/* Link del Cliente */}
                          <div className="border-l-4 border-blue-500 pl-4 py-2">
                            <div className="flex items-center justify-between">
                              <div className="flex-1">
                                <p className="text-sm font-medium text-gray-900">
                                  👤 Link del Cliente
                                </p>
                                <div className="mt-1 p-2 bg-blue-50 rounded text-xs font-mono text-gray-600 break-all">
                                  {submission.embed_src.length > 60
                                    ? submission.embed_src.substring(0, 60) + "..."
                                    : submission.embed_src}
                                </div>
                              </div>
                              <div className="flex flex-col gap-2 ml-4">
                                <a
                                  href={submission.embed_src}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-xs font-medium whitespace-nowrap"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                  Abrir
                                </a>
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(submission.embed_src);
                                    alert("✅ Link del cliente copiado");
                                  }}
                                  className="inline-flex items-center gap-2 px-3 py-1.5 border border-blue-300 bg-white text-blue-700 rounded-md hover:bg-blue-50 transition-colors text-xs whitespace-nowrap"
                                >
                                  <Copy className="h-3 w-3" />
                                  Copiar
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* Links adicionales (Representante y otros) */}
                          {result.signing_links && result.signing_links.length > 0 && (() => {
                            const otherLinks = result.signing_links.filter(link => link !== submission.embed_src);
                            return otherLinks.map((link, linkIndex) => (
                              <div key={linkIndex} className="border-l-4 border-green-500 pl-4 py-2">
                                <div className="flex items-center justify-between">
                                  <div className="flex-1">
                                    <p className="text-sm font-medium text-gray-900">
                                      {linkIndex === 0 ? "🏢 Link del Representante" : `👥 Link Adicional ${linkIndex}`}
                                    </p>
                                    <div className="mt-1 p-2 bg-green-50 rounded text-xs font-mono text-gray-600 break-all">
                                      {link.length > 60
                                        ? link.substring(0, 60) + "..."
                                        : link}
                                    </div>
                                  </div>
                                  <div className="flex flex-col gap-2 ml-4">
                                    <a
                                      href={link}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors text-xs font-medium whitespace-nowrap"
                                    >
                                      <ExternalLink className="h-3 w-3" />
                                      Abrir
                                    </a>
                                    <button
                                      onClick={() => {
                                        navigator.clipboard.writeText(link);
                                        alert(`✅ Link ${linkIndex === 0 ? "del representante" : "adicional"} copiado`);
                                      }}
                                      className="inline-flex items-center gap-2 px-3 py-1.5 border border-green-300 bg-white text-green-700 rounded-md hover:bg-green-50 transition-colors text-xs whitespace-nowrap"
                                    >
                                      <Copy className="h-3 w-3" />
                                      Copiar
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ));
                          })()}
                        </div>
                      </div>
                    </div>
                  </div>

                  {index < result.data.length - 1 && (
                    <Separator className="mt-4" />
                  )}
                </div>
              ))}
          </>
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
