import { useEffect, useState, Fragment } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Loader2,
  Upload,
  ChevronsUpDown,
  Eye,
  X,
} from "lucide-react";
import { Combobox, Transition } from "@headlessui/react";

import { useCatalogs } from "../hooks/catalogs";
import {
  useCreateBoleta,
  useGetBoletasPendientes,
} from "../hooks/useBoletasInversionistas";
import { uploadFileService, type Investor } from "../services/services";
 
interface CrearBoletaInversionistaProps {
  open: boolean;
  onClose: () => void;
  inversionistaPredeterminado?: {
    id: number;
    nombre: string;
    dpi: string;
  };
}

const inputBase =
  "w-full rounded-lg border border-blue-300 bg-white px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none";

export function CrearBoletaInversionista({
  open,
  onClose,
  inversionistaPredeterminado,
}: CrearBoletaInversionistaProps) {
  const [inversionistaId, setInversionistaId] = useState<number>(0);
  const [montoBoleta, setMontoBoleta] = useState("");
  const [notas, setNotas] = useState("");
  const [archivos, setArchivos] = useState<File[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [query, setQuery] = useState("");

  const createBoleta = useCreateBoleta();
  const { investors = [] } = useCatalogs() as { investors: Investor[] };

  // 🔥 CAMBIADO: Usa inversionistaId (que puede ser el predeterminado o el seleccionado)
  const { data } = useGetBoletasPendientes(inversionistaId || inversionistaPredeterminado?.id);
  const pendientes = data?.data ?? [];
  const tienePendientes = pendientes.length > 0;

  useEffect(() => {
    if (inversionistaPredeterminado?.id) {
      setInversionistaId(inversionistaPredeterminado.id);
    }
  }, [inversionistaPredeterminado]);

  const filtered =
    query === ""
      ? investors
      : investors.filter((i) =>
          i.nombre.toLowerCase().includes(query.toLowerCase())
        );

  const handleClose = () => {
    if (subiendo || createBoleta.isPending) return;
    setMontoBoleta("");
    setNotas("");
    setArchivos([]);
    setPreviewUrl(null);
    setQuery("");
    onClose();
  };

  const handleFileChange = (files: FileList | null) => {
    if (!files?.length) return;
    const file = files[0];
    setArchivos([file]);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inversionistaId || archivos.length === 0) return;

    try {
      setSubiendo(true);

      // 🔥 SUBE DESDE FRONT (IGUAL QUE PAGOS)
      const { filename } = await uploadFileService(archivos[0]);

      await createBoleta.mutateAsync({
        inversionista_id: inversionistaId,
        boleta_url: filename,
        monto_boleta: montoBoleta || undefined,
        notas: notas || undefined,
      });

      handleClose();
    } finally {
      setSubiendo(false);
    }
  };

  const file = archivos[0];
  const isPdf = file?.type === "application/pdf";
  const isImage = file?.type?.startsWith("image/");

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-lg bg-white">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-blue-700">
            📄 Subir Boleta de Inversionista
          </DialogTitle>
          <DialogDescription />
        </DialogHeader>

        {/* 🔥 ALERTA DE PENDIENTES */}
        {tienePendientes && (
          <div className="mt-3 rounded-lg border-2 border-red-300 bg-red-50 p-4">
            <div className="text-sm font-bold text-red-900 mb-3 flex items-center gap-2">
              ⚠️ Este inversionista tiene {pendientes.length} boleta(s) pendiente(s) de validar
            </div>

            <div className="space-y-2">
              {pendientes.map((b: any) => (
                <div
                  key={b.boleta.boleta_id}
                  className="flex items-center justify-between rounded-lg border border-red-200 bg-white px-3 py-2"
                >
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-gray-900">
                      {new Date(b.boleta.fecha_subida).toLocaleDateString("es-GT", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    </div>
                    {b.boleta.monto_boleta && (
                      <div className="text-xs text-gray-600">
                        Monto: Q{Number(b.boleta.monto_boleta).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      window.open(
                        `${b.boleta.boleta_url}`,
                        "_blank"
                      )
                    }
                    className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
                  >
                    <Eye className="w-4 h-4" />
                    Ver
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-3 text-xs text-red-800 font-semibold">
              💡 No se pueden subir nuevas boletas hasta que las pendientes sean validadas.
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* INVERSIONISTA */}
          <div>
            <Label className="text-blue-900 font-semibold">Inversionista *</Label>

            {inversionistaPredeterminado ? (
              <div className="mt-1 rounded-lg border-2 border-blue-300 bg-blue-50 px-4 py-3">
                <div className="text-blue-900 font-bold text-lg">
                  {inversionistaPredeterminado.nombre}
                </div>
                <div className="text-sm text-blue-700">
                  DPI: {inversionistaPredeterminado.dpi || "N/A"}
                </div>
              </div>
            ) : (
              <Combobox 
                value={inversionistaId} 
                onChange={setInversionistaId}
                disabled={tienePendientes} // 🔥 Deshabilitar si hay pendientes
              >
                <div className="relative mt-1">
                  <Combobox.Input
                    className={`${inputBase} ${tienePendientes ? "opacity-50 cursor-not-allowed" : ""}`}
                    displayValue={(id) =>
                      investors.find((i) => i.inversionista_id === id)
                        ?.nombre || "Selecciona un inversionista"
                    }
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Buscar inversionista..."
                  />
                  <Combobox.Button className="absolute right-3 top-2">
                    <ChevronsUpDown className="w-5 h-5 text-blue-600" />
                  </Combobox.Button>

                  <Transition
                    as={Fragment}
                    leave="transition ease-in duration-100"
                    leaveFrom="opacity-100"
                    leaveTo="opacity-0"
                  >
                    <Combobox.Options className="absolute z-50 mt-1 w-full rounded-lg border-2 border-blue-200 bg-white shadow-xl max-h-60 overflow-auto">
                      {filtered.length === 0 ? (
                        <div className="px-4 py-3 text-center text-gray-500">
                          No se encontró inversionista
                        </div>
                      ) : (
                        filtered.map((inv) => (
                          <Combobox.Option
                            key={inv.inversionista_id}
                            value={inv.inversionista_id}
                            className={({ active }) =>
                              `cursor-pointer px-4 py-2 transition-colors ${
                                active ? "bg-blue-50 text-blue-900" : "text-gray-900"
                              }`
                            }
                          >
                            {({ selected }) => (
                              <div className="flex items-center gap-2">
                                {selected && <span className="text-green-600">✓</span>}
                                <div>
                                  <div className="font-semibold">{inv.nombre}</div>
                                  <div className="text-xs text-gray-600">DPI: {inv.dpi || "N/A"}</div>
                                </div>
                              </div>
                            )}
                          </Combobox.Option>
                        ))
                      )}
                    </Combobox.Options>
                  </Transition>
                </div>
              </Combobox>
            )}
          </div>

          {/* MONTO */}
          <div>
            <Label className="text-blue-900 font-semibold">Monto (Opcional)</Label>
            <Input
              className={`${inputBase} ${tienePendientes ? "opacity-50 cursor-not-allowed" : ""}`}
              type="number"
              step="0.01"
              placeholder="1000.00"
              value={montoBoleta}
              onChange={(e) => setMontoBoleta(e.target.value)}
              disabled={tienePendientes}
            />
          </div>

          {/* NOTAS */}
          <div>
            <Label className="text-blue-900 font-semibold">Notas (Opcional)</Label>
            <Textarea
              className={`${inputBase} min-h-[80px] ${tienePendientes ? "opacity-50 cursor-not-allowed" : ""}`}
              placeholder="Notas adicionales sobre la boleta..."
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              disabled={tienePendientes}
            />
          </div>

          {/* FILE */}
          <div>
            <Label className="text-blue-900 font-semibold">Archivo de Boleta *</Label>
            <input
              type="file"
              accept="image/*,.pdf"
              className={`block w-full text-sm text-gray-900 mt-1
                file:mr-4 file:rounded-lg file:border-0
                file:bg-blue-600 file:px-4 file:py-2
                file:text-white hover:file:bg-blue-700
                ${tienePendientes ? "opacity-50 cursor-not-allowed" : ""}`}
              onChange={(e) => handleFileChange(e.target.files)}
              disabled={tienePendientes}
            />
          </div>

          {/* PREVIEW */}
          {previewUrl && (
            <div className="relative border-2 border-blue-200 rounded-lg p-3 bg-blue-50">
              <div className="flex items-center gap-2 mb-2 text-blue-700 font-semibold">
                <Eye className="w-4 h-4" />
                Vista previa
              </div>

              {isImage && (
                <img
                  src={previewUrl}
                  alt="Preview"
                  className="max-h-64 mx-auto rounded-lg border-2 border-blue-300"
                />
              )}

              {isPdf && (
                <iframe
                  src={previewUrl}
                  className="w-full h-64 border-2 border-blue-300 rounded-lg"
                  title="PDF Preview"
                />
              )}

              <button
                type="button"
                onClick={() => {
                  setArchivos([]);
                  setPreviewUrl(null);
                }}
                className="absolute top-2 right-2 bg-white border-2 border-red-300 rounded-full p-1 hover:bg-red-50 transition-colors"
              >
                <X className="w-4 h-4 text-red-600" />
              </button>
            </div>
          )}

          {/* ACTIONS */}
          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              className="flex-1 border-blue-300 text-blue-700 hover:bg-blue-50"
              disabled={subiendo || createBoleta.isPending}
            >
              Cancelar
            </Button>

            <Button
              type="submit"
              disabled={subiendo || tienePendientes || archivos.length === 0 || !inversionistaId}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {subiendo ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Subiendo...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  Crear Boleta
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}