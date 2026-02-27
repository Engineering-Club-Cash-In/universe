import {
  NavBar,
  IconDownload,
  IconTarget,
  IconPerson,
  Loading,
} from "@/components";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib";
import {
  getContracts,
  getPersonalDocuments,
  getDocumentTypeLabel,
  type Document,
} from "../services";
import { motion } from "framer-motion";
import { ContainerMenu } from "../components/ContainerMenu";
import { useIsMobile } from "@/hooks";

export const MyDocuments = () => {
  const { user } = useAuth();

  // Obtener contratos
  const { data: contracts, isLoading: loadingContracts } = useQuery({
    queryKey: ["contracts", user?.email],
    queryFn: () => getContracts(user?.email || "", user?.dpi || ""),
    enabled: !!user?.email,
  });

  // Obtener documentos personales
  const { data: documents, isLoading: loadingDocuments } = useQuery({
    queryKey: ["personal-documents", user?.email],
    queryFn: () => getPersonalDocuments(user?.email || "", user?.dpi || ""),
    enabled: !!user?.email,
  });

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("es-GT", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const handleDownload = (url: string) => {
    window.open(url, "_blank");
  };

  const isMobile = useIsMobile();
  const isLoading = loadingContracts || loadingDocuments;

  // Agrupar documentos por tipo
  const groupedDocuments =
    documents?.reduce(
      (acc, doc) => {
        if (!acc[doc.documentType]) {
          acc[doc.documentType] = [];
        }
        acc[doc.documentType].push(doc);
        return acc;
      },
      {} as Record<string, Document[]>
    ) || {};

  if (isLoading) {
    return (
      <div>
        <NavBar />
        <ContainerMenu>
          <div className="max-w-7xl mx-auto mt-26 mb-20">
            <Loading />
          </div>
        </ContainerMenu>
      </div>
    );
  }

  return (
    <div>
      <NavBar />
      <ContainerMenu>
        <div className="">
          <h1 className="text-xl lg:text-header-body font-bold mb-8">
            Mis Documentos
          </h1>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_10px_1fr] gap-12 lg:gap-8">
            {/* Sección de Contratos */}
            <div className="lg:pr-8">
              <div className="flex items-center gap-3 mb-4 lg:mb-6">
                <IconTarget
                  width={isMobile ? 20 : 24}
                  height={isMobile ? 20 : 24}
                />
                <h2 className="lg:text-2xl font-bold">Contratos</h2>
              </div>

              {contracts && contracts.length > 0 ? (
                <div className="space-y-4">
                  {contracts.map((item) => (
                    <div
                      key={item.contract.id}
                      className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4 lg:p-5 hover:border-primary/30 transition-colors"
                    >
                      {/* Header con nombre del contrato */}
                      <div className="flex items-start justify-between mb-3">
                        <h3 className="text-base font-semibold line-clamp-2 flex-1 mr-4">
                          {item.contract.contractName}
                        </h3>
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-semibold border ${
                            item.contract.status === "signed"
                              ? "text-green-400 bg-green-500/10 border-green-500/30"
                              : item.contract.status === "pending"
                                ? "text-yellow-400 bg-yellow-500/10 border-yellow-500/30"
                                : "text-blue-400 bg-blue-500/10 border-blue-500/30"
                          }`}
                        >
                          {item.contract.status === "signed"
                            ? "Firmado"
                            : item.contract.status === "pending"
                              ? "Pendiente"
                              : item.contract.status === "completed"
                                ? "Completado"
                                : "Cancelado"}
                        </span>
                      </div>

                      {/* Info del lead */}
                      <p className="text-sm text-white/65 mb-2">
                        Cliente: {item.lead.firstName} {item.lead.lastName}
                      </p>

                      {/* Fecha */}
                      <p className="text-sm text-white/65 mb-4">
                        Generado: {formatDate(item.contract.generatedAt)}
                      </p>

                      {/* Botones de firma y/o descarga */}
                      {(item.contract.clientSigningLink || item.contract.pdfLink) && (
                        <div className="flex gap-2">
                          {item.contract.status === "pending" && item.contract.clientSigningLink && (
                            <motion.button
                              onClick={() =>
                                handleDownload(item.contract.clientSigningLink!)
                              }
                              className="flex-1 px-4 py-2 text-sm lg:text-base text-primary border border-primary/30 font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                              style={{
                                background:
                                  "linear-gradient(180deg, rgba(148, 153, 236, 0.25) 0%, rgba(84, 87, 134, 0.25) 100%)",
                              }}
                              whileHover={{ scale: 1.02 }}
                              whileTap={{ scale: 0.98 }}
                            >
                              <IconDownload
                                width={isMobile ? 18 : 24}
                                height={isMobile ? 18 : 24}
                              />
                              Firmar Contrato
                            </motion.button>
                          )}
                          {item.contract.pdfLink && (
                            <motion.button
                              onClick={() =>
                                handleDownload(item.contract.pdfLink!)
                              }
                              className="flex-1 px-4 py-2 text-sm lg:text-base text-white/80 border border-white/20 font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 hover:border-white/40"
                              whileHover={{ scale: 1.02 }}
                              whileTap={{ scale: 0.98 }}
                            >
                              <IconDownload
                                width={isMobile ? 18 : 24}
                                height={isMobile ? 18 : 24}
                              />
                              Ver PDF
                            </motion.button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-8 text-center">
                  <IconTarget className="w-12 h-12 text-white/30 mx-auto mb-3" />
                  <p className="text-white/65">No tienes contratos</p>
                </div>
              )}
            </div>

            {/* Línea divisoria - solo visible en desktop */}
            <div
              className="hidden w-2 lg:block h-full"
              style={{
                background:
                  "linear-gradient(180deg, rgba(15, 15, 15, 0.00) 0%, #9A9FF5 50%, rgba(15, 15, 15, 0.00) 100%)",
              }}
            ></div>

            {/* Sección de Documentos Personales */}
            <div className="lg:pl-8">
              <div className="flex items-center gap-3 mb-6">
                <IconPerson className="w-6 h-6 text-primary" />
                <h2 className="lg:text-2xl font-bold">Documentos Personales</h2>
              </div>

              {Object.keys(groupedDocuments).length > 0 ? (
                <div className="space-y-6">
                  {Object.entries(groupedDocuments).map(([docType, docs]) => (
                    <div key={docType}>
                      <h3 className="lg:text-lg font-semibold mb-3">
                        {getDocumentTypeLabel(docType as any)}
                      </h3>
                      <div className="space-y-3">
                        {docs.map((doc) => (
                          <div
                            key={doc.id}
                            className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4"
                          >
                            <div className="flex items-start justify-between mb-3">
                              <div className="flex-1">
                                <p className="text-base font-semibold mb-1">
                                  {doc.originalName}
                                </p>
                                {doc.description && (
                                  <p className="text-sm text-white/50 mb-2">
                                    {doc.description}
                                  </p>
                                )}
                                <p className="text-sm text-white/65">
                                  Subido: {formatDate(doc.uploadedAt)}
                                </p>
                                <p className="text-xs text-white/50 mt-1">
                                  Por: {doc.uploadedBy.name}
                                </p>
                              </div>
                              <motion.button
                                onClick={() => handleDownload(doc.url)}
                                className="p-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg transition-colors ml-4"
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                              >
                                <IconDownload
                                  width={isMobile ? 18 : 24}
                                  height={isMobile ? 18 : 24}
                                />
                              </motion.button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-8 text-center">
                  <IconPerson className="w-12 h-12 text-white/30 mx-auto mb-3" />
                  <p className="text-white/65">
                    No tienes documentos personales
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </ContainerMenu>
    </div>
  );
};
