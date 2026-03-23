import { useState } from "react";
import { IconTarget, Loading } from "@/components";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib";
import { getInvestorDocuments, type InvestorDocument } from "../services/investorService";
import { useIsMobile } from "@/hooks";
import { DocumentViewerModal } from "./DocumentViewerModal";

export const InvestorDocuments = () => {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [selectedDocument, setSelectedDocument] = useState<InvestorDocument | null>(null);

  const { data: documents, isLoading } = useQuery({
    queryKey: ["investor-documents", user?.email],
    queryFn: () => getInvestorDocuments(user?.email || ""),
    enabled: !!user?.email,
  });

  if (isLoading) {
    return <Loading />;
  }

  return (
    <>
      <div>
        <div className="flex items-center gap-3 mb-4 lg:mb-6 text-primary">
          <IconTarget
            width={isMobile ? 20 : 24}
            height={isMobile ? 20 : 24}
          />
          <h2 className="lg:text-2xl font-bold text-white">Documentos</h2>
        </div>

        {documents && documents.length > 0 ? (
          <div className="space-y-4">
            {documents.map((doc) => (
              <div
                key={doc.documento_id}
                className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4 lg:p-5 hover:border-primary/30 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold line-clamp-2 flex-1 mr-4">
                    {doc.nombre}
                  </h3>
                  <button
                    onClick={() => setSelectedDocument(doc)}
                    className="px-4 py-2 text-sm text-primary border border-primary/30 font-semibold rounded-lg transition-colors flex items-center gap-2 hover:bg-primary/10 shrink-0"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width={isMobile ? 16 : 20}
                      height={isMobile ? 16 : 20}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                    Ver
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-8 text-center">
            <IconTarget className="w-12 h-12 text-white/30 mx-auto mb-3" />
            <p className="text-white/65">No tienes documentos</p>
          </div>
        )}
      </div>

      <DocumentViewerModal
        isOpen={!!selectedDocument}
        documentName={selectedDocument?.nombre || ""}
        documentUrl={selectedDocument?.url || ""}
        onClose={() => setSelectedDocument(null)}
      />
    </>
  );
};
