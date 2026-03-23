/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  FileText,
  Trash2,
  Upload,
  Loader2,
  ExternalLink,
  Plus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  getInvestorDocuments,
  uploadInvestorDocument,
  toggleDocumentVisibility,
  deleteInvestorDocument,
} from "../services/services";

// ─── Types ────────────────────────────────────────────────────────────────────
interface InvestorDocument {
  documento_id: number;
  inversionista_id: number;
  key: string;
  nombre: string;
  descripcion: string | null;
  visible: boolean;
  created_by: string | null;
  created_at: string;
  url: string;
}

interface InvestorDocumentsModalProps {
  open: boolean;
  onClose: () => void;
  investor: { id: number; nombre: string } | null;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DocumentRow({
  doc,
  onToggleVisibility,
  onDelete,
  togglingId,
}: {
  doc: InvestorDocument;
  onToggleVisibility: (doc: InvestorDocument) => void;
  onDelete: (doc: InvestorDocument) => void;
  togglingId: number | null;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const fileName = doc.key.split("/").pop() ?? doc.key;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 transition-colors hover:bg-gray-50">
      {/* Icon + Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 shrink-0 text-blue-500" />
          <span className="truncate text-sm font-medium" style={{ color: "#1f2937" }}>
            {doc.nombre || fileName}
          </span>
        </div>
        {doc.descripcion && (
          <p className="mt-0.5 truncate text-xs pl-6" style={{ color: "#6b7280" }}>{doc.descripcion}</p>
        )}
      </div>

      {/* Open link */}
      <a
        href={doc.url}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 rounded-md p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
        title="Abrir documento"
      >
        <ExternalLink className="h-4 w-4" />
      </a>

      {/* Visibility toggle */}
      <div className="flex items-center gap-1.5 shrink-0" title="Visible para el cliente">
        <Switch
          checked={doc.visible}
          onCheckedChange={() => onToggleVisibility(doc)}
          disabled={togglingId === doc.documento_id}
          className="data-[state=checked]:bg-green-500 data-[state=unchecked]:bg-gray-300 border border-gray-400"
        />
        <span className="text-xs w-14" style={{ color: "#6b7280" }}>
          {doc.visible ? "Visible" : "Oculto"}
        </span>
      </div>

      {/* Delete */}
      {!confirmDelete ? (
        <button
          type="button"
          className="shrink-0 h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors"
          style={{ color: "#9ca3af" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.backgroundColor = "#fef2f2"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "#9ca3af"; e.currentTarget.style.backgroundColor = "transparent"; }}
          onClick={() => setConfirmDelete(true)}
          title="Eliminar documento"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      ) : (
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            className="h-7 text-xs px-2 rounded-md font-medium transition-colors"
            style={{ backgroundColor: "#ef4444", color: "#ffffff" }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#dc2626"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "#ef4444"; }}
            onClick={() => {
              onDelete(doc);
              setConfirmDelete(false);
            }}
          >
            Eliminar
          </button>
          <button
            type="button"
            className="h-7 w-7 inline-flex items-center justify-center rounded-md transition-colors"
            style={{ color: "#6b7280" }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#f3f4f6"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
            onClick={() => setConfirmDelete(false)}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function UploadSection({
  investorId,
  onUploadComplete,
}: {
  investorId: number;
  onUploadComplete: () => void;
}) {
  const [files, setFiles] = useState<{ file: File; visible: boolean }[]>([]);
  const [descripcion, setDescripcion] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFilesSelected = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        const newFiles = Array.from(e.target.files).map((file) => ({ file, visible: false }));
        setFiles((prev) => [...prev, ...newFiles]);
      }
    },
    []
  );

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const toggleFileVisibility = useCallback((index: number) => {
    setFiles((prev) =>
      prev.map((item, i) => (i === index ? { ...item, visible: !item.visible } : item))
    );
  }, []);

  const handleUpload = async () => {
    if (files.length === 0) return;

    setUploading(true);
    setProgress({ current: 0, total: files.length });

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < files.length; i++) {
      setProgress({ current: i + 1, total: files.length });
      try {
        await uploadInvestorDocument({
          file: files[i].file,
          inversionista_id: investorId,
          nombre: files[i].file.name,
          descripcion: descripcion || undefined,
          visible: files[i].visible,
        });
        successCount++;
      } catch {
        errorCount++;
        toast.error(`Error al subir: ${files[i].file.name}`);
      }
    }

    setUploading(false);
    setFiles([]);
    setDescripcion("");
    if (fileInputRef.current) fileInputRef.current.value = "";

    if (successCount > 0) {
      toast.success(
        `${successCount} documento${successCount > 1 ? "s" : ""} subido${successCount > 1 ? "s" : ""} correctamente`
      );
    }
    if (errorCount > 0) {
      toast.error(`${errorCount} documento${errorCount > 1 ? "s" : ""} fallaron`);
    }

    onUploadComplete();
  };

  return (
    <div className="space-y-3 rounded-xl border-2 border-dashed border-gray-300 p-4" style={{ backgroundColor: "#f9fafb" }}>
      <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: "#374151" }}>
        <Plus className="h-4 w-4" />
        Subir documentos
      </div>

      <div>
        <Label htmlFor="doc-files" className="text-xs" style={{ color: "#6b7280" }}>
          Archivos (puedes seleccionar varios)
        </Label>
        <Input
          ref={fileInputRef}
          id="doc-files"
          type="file"
          multiple
          onChange={handleFilesSelected}
          className="mt-1 cursor-pointer"
          style={{ color: "#1f2937" }}
          disabled={uploading}
        />
      </div>

      {/* File list preview */}
      {files.length > 0 && (
        <div className="space-y-1.5">
          {files.map((f, i) => (
            <div
              key={`${f.file.name}-${i}`}
              className="flex items-center gap-2 rounded-md bg-white px-2.5 py-1.5 text-sm border border-gray-200"
            >
              <FileText className="h-3.5 w-3.5 text-blue-400 shrink-0" />
              <span className="truncate flex-1" style={{ color: "#374151" }}>{f.file.name}</span>
              <span className="text-xs shrink-0" style={{ color: "#9ca3af" }}>
                {(f.file.size / 1024).toFixed(0)} KB
              </span>
              <div className="flex items-center gap-1 shrink-0" title="Visible para el cliente">
                <Switch
                  checked={f.visible}
                  onCheckedChange={() => toggleFileVisibility(i)}
                  disabled={uploading}
                  className="data-[state=checked]:bg-green-500 data-[state=unchecked]:bg-gray-300 border border-gray-400 h-4 w-7"
                />
                <span className="text-xs w-10" style={{ color: "#6b7280" }}>
                  {f.visible ? "Visible" : "Oculto"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => removeFile(i)}
                className="text-gray-400 hover:text-red-500 shrink-0"
                disabled={uploading}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div>
        <Label htmlFor="doc-desc" className="text-xs" style={{ color: "#6b7280" }}>
          Descripcion (opcional, aplica a todos)
        </Label>
        <Textarea
          id="doc-desc"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          placeholder="Ej: Contrato de inversión 2025"
          rows={2}
          className="mt-1 resize-none"
          style={{ color: "#1f2937" }}
          disabled={uploading}
        />
      </div>

      <Button
        onClick={handleUpload}
        disabled={files.length === 0 || uploading}
        className="w-full"
        style={{ backgroundColor: "#2563eb", color: "#ffffff" }}
      >
        {uploading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Subiendo {progress.current}/{progress.total}...
          </>
        ) : (
          <>
            <Upload className="mr-2 h-4 w-4" />
            Subir {files.length > 0 ? `(${files.length})` : ""}
          </>
        )}
      </Button>
    </div>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

export function InvestorDocumentsModal({
  open,
  onClose,
  investor,
}: InvestorDocumentsModalProps) {
  const [documents, setDocuments] = useState<InvestorDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const fetchDocuments = useCallback(async () => {
    if (!investor) return;
    setLoading(true);
    try {
      const res = await getInvestorDocuments(investor.id);
      setDocuments(res.data ?? []);
    } catch {
      toast.error("Error al cargar documentos");
    } finally {
      setLoading(false);
    }
  }, [investor]);

  // Fetch on open
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen && investor) {
      fetchDocuments();
    }
    if (!isOpen) {
      onClose();
      setDocuments([]);
    }
  };

  const handleToggleVisibility = async (doc: InvestorDocument) => {
    setTogglingId(doc.documento_id);
    try {
      await toggleDocumentVisibility(doc.documento_id, !doc.visible);
      setDocuments((prev) =>
        prev.map((d) =>
          d.documento_id === doc.documento_id ? { ...d, visible: !d.visible } : d
        )
      );
    } catch {
      toast.error("Error al actualizar visibilidad");
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (doc: InvestorDocument) => {
    try {
      await deleteInvestorDocument(doc.documento_id);
      setDocuments((prev) =>
        prev.filter((d) => d.documento_id !== doc.documento_id)
      );
      toast.success("Documento eliminado");
    } catch {
      toast.error("Error al eliminar documento");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col" style={{ backgroundColor: "#ffffff", color: "#1f2937" }}>
        <DialogHeader>
          <DialogTitle className="text-lg" style={{ color: "#111827" }}>
            Documentos — {investor?.nombre}
          </DialogTitle>
          <DialogDescription style={{ color: "#6b7280" }}>
            Gestiona contratos y documentos del inversionista.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {/* Upload section */}
          {investor && (
            <UploadSection
              investorId={investor.id}
              onUploadComplete={fetchDocuments}
            />
          )}

          {/* Documents list */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold" style={{ color: "#4b5563" }}>
              Documentos existentes ({documents.length})
            </h4>

            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
              </div>
            ) : documents.length === 0 ? (
              <p className="py-6 text-center text-sm" style={{ color: "#9ca3af" }}>
                No hay documentos aun.
              </p>
            ) : (
              <div className="space-y-2">
                {documents.map((doc) => (
                  <DocumentRow
                    key={doc.documento_id}
                    doc={doc}
                    onToggleVisibility={handleToggleVisibility}
                    onDelete={handleDelete}
                    togglingId={togglingId}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
