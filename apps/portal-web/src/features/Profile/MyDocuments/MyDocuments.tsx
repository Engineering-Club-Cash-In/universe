import {
  NavBar,
  IconDownload,
  IconTarget,
  IconPerson,
  IconPlus,
} from "@/components";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib";
import {
  getContracts,
  getPersonalDocuments,
  uploadPersonalDocument,
  type PersonalDocumentType,
} from "../services";
import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { ContainerMenu } from "../components/ContainerMenu";
import { useIsMobile } from "@/hooks";

export const MyDocuments = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadType, setUploadType] = useState<PersonalDocumentType>("dpi");

  // Obtener contratos
  const { data: contracts, isLoading: loadingContracts } = useQuery({
    queryKey: ["contracts", user?.id],
    queryFn: () => getContracts(user?.id || ""),
    enabled: !!user?.id,
  });

  // Obtener documentos personales
  const { data: personalDocs, isLoading: loadingPersonalDocs } = useQuery({
    queryKey: ["personal-documents", user?.id],
    queryFn: () => getPersonalDocuments(user?.id || ""),
    enabled: !!user?.id,
  });

  // Mutation para subir documentos
  const uploadMutation = useMutation({
    mutationFn: (file: File) =>
      uploadPersonalDocument(user?.id || "", uploadType, file),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["personal-documents", user?.id],
      });
    },
  });

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("es-GT", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const getContractTypeLabel = (type: string) => {
    return type === "prestamo" ? "Préstamo" : "Inversión";
  };

  const getContractTypeColor = (type: string) => {
    return type === "prestamo"
      ? "text-blue-400 bg-blue-500/10 border-blue-500/30"
      : "text-green-400 bg-green-500/10 border-green-500/30";
  };

  const handleFileSelect = (type: PersonalDocumentType) => {
    setUploadType(type);
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      uploadMutation.mutate(file);
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleDownload = (url: string) => {
    // Aquí va la lógica de descarga
    window.open(url, "_blank");
  };

  const isMobile = useIsMobile();

  const isLoading = loadingContracts || loadingPersonalDocs;

  if (isLoading) {
    return (
      <div>
        <NavBar />
        <div className="max-w-7xl mx-auto mt-26 mb-20">
          <div className="flex justify-center items-center py-20">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
          </div>
        </div>
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
                  {contracts.map((contract) => (
                    <div
                      key={contract.id}
                      className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4 lg:p-5 hover:border-primary/30 transition-colors"
                    >
                      {/* Header con tipo */}
                      <div className="flex items-start justify-between mb-3">
                        <h3 className="text-base font-semibold line-clamp-2 flex-1 mr-4">
                          {contract.nombre}
                        </h3>
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-semibold border shrink-0 ${getContractTypeColor(
                            contract.tipo
                          )}`}
                        >
                          {getContractTypeLabel(contract.tipo)}
                        </span>
                      </div>

                      {/* Fecha */}
                      <p className="text-sm text-white/65 mb-4">
                        Fecha: {formatDate(contract.fechaRealizado)}
                      </p>

                      {/* Botón de descarga */}
                      <motion.button
                        onClick={() => handleDownload(contract.url)}
                        className="w-full px-4 py-2 text-sm lg:text-base text-primary border border-primary/30 font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                        style={{
                          background:
                            "linear-gradient(180deg, rgba(148, 153, 236, 0.25) 0%, rgba(84, 87, 134, 0.25) 100%)",
                        }}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                      >
                        <IconDownload width={isMobile ? 18 : 24} height={isMobile ? 18 : 24} />
                        Descargar Contrato
                      </motion.button>
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

              {/* Input file oculto */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={handleFileChange}
                className="hidden"
              />

              <div className="space-y-6">
                {/* DPI */}
                <div>
                  <h3 className="lg:text-lg font-semibold mb-2">DPI</h3>
                  {personalDocs?.dpi ? (
                    <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <p className="text-base font-semibold">
                            {personalDocs.dpi.nombre}
                          </p>
                          <p className="text-sm text-white/65">
                            Subido: {formatDate(personalDocs.dpi.fechaCarga)}
                          </p>
                        </div>
                        <motion.button
                          onClick={() => handleDownload(personalDocs.dpi!.url)}
                          className="p-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg transition-colors"
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                        >
                          <IconDownload width={isMobile ? 18 : 24} height={isMobile ? 18 : 24} />
                        </motion.button>
                      </div>
                      <motion.button
                        onClick={() => handleFileSelect("dpi")}
                        disabled={uploadMutation.isPending}
                        className="w-full px-4 py-2 bg-white/5 hover:bg-white/10 text-white/80 border border-white/10 rounded-lg transition-colors text-sm disabled:opacity-50"
                        whileHover={{
                          scale: uploadMutation.isPending ? 1 : 1.02,
                        }}
                        whileTap={{
                          scale: uploadMutation.isPending ? 1 : 0.98,
                        }}
                      >
                        {uploadMutation.isPending && uploadType === "dpi"
                          ? "Subiendo..."
                          : "Actualizar DPI"}
                      </motion.button>
                    </div>
                  ) : (
                    <motion.button
                      onClick={() => handleFileSelect("dpi")}
                      disabled={uploadMutation.isPending}
                      className="w-full p-4 lg:p-6 bg-white/5 hover:bg-white/10 border-2 border-dashed border-white/20 rounded-xl transition-colors flex flex-col items-center gap-2 disabled:opacity-50"
                      whileHover={{
                        scale: uploadMutation.isPending ? 1 : 1.02,
                      }}
                      whileTap={{ scale: uploadMutation.isPending ? 1 : 0.98 }}
                    >
                      <IconPlus className="w-8 h-8 text-white/40" />
                      <span className="text-sm text-white/65">
                        {uploadMutation.isPending && uploadType === "dpi"
                          ? "Subiendo..."
                          : "Subir DPI"}
                      </span>
                    </motion.button>
                  )}
                </div>

                {/* Estados de Cuenta */}
                <div>
                  <h3 className="lg:text-lg font-semibold mb-3">
                    Estados de Cuenta
                  </h3>
                  <div className="space-y-3">
                    {personalDocs?.estadosCuenta &&
                    personalDocs.estadosCuenta.length > 0 ? (
                      <>
                        {personalDocs.estadosCuenta.map((doc) => (
                          <div
                            key={doc.id}
                            className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4 flex items-center justify-between"
                          >
                            <div>
                              <p className="text-base font-semibold">
                                {doc.nombre}
                              </p>
                              <p className="text-sm text-white/65">
                                Subido: {formatDate(doc.fechaCarga)}
                              </p>
                            </div>
                            <motion.button
                              onClick={() => handleDownload(doc.url)}
                              className="p-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg transition-colors"
                              whileHover={{ scale: 1.05 }}
                              whileTap={{ scale: 0.95 }}
                            >
                              <IconDownload width={isMobile ? 18 : 24} height={isMobile ? 18 : 24} />
                            </motion.button>
                          </div>
                        ))}
                        <motion.button
                          onClick={() => handleFileSelect("estado_cuenta")}
                          disabled={uploadMutation.isPending}
                          style={{
                            background:
                              "linear-gradient(180deg, rgba(148, 153, 236, 0.25) 0%, rgba(84, 87, 134, 0.25) 100%)",
                          }}
                          className="w-full px-4 py-2 text-sm lg:text-base lg:py-3 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                          whileHover={{
                            scale: uploadMutation.isPending ? 1 : 1.02,
                          }}
                          whileTap={{
                            scale: uploadMutation.isPending ? 1 : 0.98,
                          }}
                        >
                          <IconPlus width={isMobile ? 18 : 24} height={isMobile ? 18 : 24} />
                          {uploadMutation.isPending &&
                          uploadType === "estado_cuenta"
                            ? "Subiendo..."
                            : "Agregar Estado de Cuenta"}
                        </motion.button>
                      </>
                    ) : (
                      <motion.button
                        onClick={() => handleFileSelect("estado_cuenta")}
                        disabled={uploadMutation.isPending}
                        className="w-full p-4 lg:p-6  bg-white/5 hover:bg-white/10 border-2 border-dashed border-white/20 rounded-xl transition-colors flex flex-col items-center gap-2 disabled:opacity-50"
                        whileHover={{
                          scale: uploadMutation.isPending ? 1 : 1.02,
                        }}
                        whileTap={{
                          scale: uploadMutation.isPending ? 1 : 0.98,
                        }}
                      >
                        <IconPlus width={isMobile ? 18 : 24} height={isMobile ? 18 : 24} className="text-white/40" />
                        <span className="text-sm text-white/65">
                          {uploadMutation.isPending &&
                          uploadType === "estado_cuenta"
                            ? "Subiendo..."
                            : "Subir Estado de Cuenta"}
                        </span>
                      </motion.button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </ContainerMenu>
    </div>
  );
};
