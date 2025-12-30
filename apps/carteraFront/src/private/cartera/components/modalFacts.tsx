// src/components/payments/ModalFacturasPago.tsx

import React from "react";
import { X, Download, Trash2, Loader2, Receipt, CheckCircle, XCircle, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useAnularFactura, usePagoCompleto } from "../hooks/cofidi";
import { useQueryClient } from "@tanstack/react-query"; // 🆕 NUEVO

interface ModalFacturasPagoProps {
  open: boolean;
  onClose: () => void;
  pagoId: number | null;
  onFacturasActualizadas?: () => void;
}

const formatCurrency = (val?: string | number | null) =>
  val == null || isNaN(Number(val))
    ? "--"
    : Number(val).toLocaleString("es-GT", {
        style: "currency",
        currency: "GTQ",
        minimumFractionDigits: 2,
      });

const formatDate = (d?: string | null) => {
  if (!d) return "--";
  const fecha = new Date(d);
  return fecha.toLocaleDateString("es-GT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export function ModalFacturasPago({
  open,
  onClose,
  pagoId,
  onFacturasActualizadas,
}: ModalFacturasPagoProps) {
  const queryClient = useQueryClient(); // 🆕 NUEVO
  const { data: pagoCompleto, isLoading } = usePagoCompleto(pagoId);
  const anularFactura = useAnularFactura();

  const [facturaParaAnular, setFacturaParaAnular] = React.useState<string | null>(null);
  const [motivoAnulacion, setMotivoAnulacion] = React.useState("");

  if (!open) return null;

  const handleAnular = async () => {
    if (!facturaParaAnular || !motivoAnulacion.trim()) {
      toast.error("Debes escribir un motivo de anulación");
      return;
    }

    anularFactura.mutate(
      {
        uuid: facturaParaAnular,
        motivo: motivoAnulacion,
        xmlAnulacion: "",
        userId: 0
      },
      {
        onSuccess: () => {
          // 🆕 REFETCH de las facturas del pago
          queryClient.invalidateQueries({ queryKey: ['pago-completo', pagoId] });
          
          setFacturaParaAnular(null);
          setMotivoAnulacion("");
          onFacturasActualizadas?.();
          
          toast.success("✅ Factura anulada exitosamente");
        },
      }
    );
  };

  const facturas = pagoCompleto?.data?.facturas?.listado || [];
  const facturasActivas = facturas.filter((f) => f.status === "ACTIVA");

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden" // 🔥 FONDO BLANCO
        onClick={(e) => e.stopPropagation()}
      >
        {/* 🔹 HEADER */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-800 px-6 py-5 flex items-center justify-between border-b border-blue-500">
          <div className="flex items-center gap-3">
            <Receipt className="w-8 h-8 text-white" />
            <div>
              <h2 className="text-2xl font-bold text-white">
                Facturas del Pago #{pagoId}
              </h2>
              {pagoCompleto?.data && (
                <p className="text-blue-100 text-sm font-semibold">
                  Cliente: {pagoCompleto.data.cliente.nombre} | NIT: {pagoCompleto.data.cliente.nit}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white hover:bg-blue-700 rounded-full p-2 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* 🔹 CONTENIDO */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-100px)] bg-gray-50"> {/* 🔥 FONDO GRIS CLARO */}
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 className="w-12 h-12 animate-spin text-blue-600 mb-4" />
              <p className="text-gray-800 font-semibold text-lg">Cargando facturas...</p>
            </div>
          ) : facturas.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Receipt className="w-20 h-20 text-gray-400 mb-4" />
              <p className="text-gray-800 font-semibold text-xl mb-2">
                No hay facturas para este pago
              </p>
              <p className="text-gray-600">
                Este pago aún no ha sido facturado
              </p>
            </div>
          ) : (
            <>
              {/* 📊 RESUMEN */}
              {pagoCompleto?.data && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div className="bg-white border-2 border-blue-500 rounded-xl p-4 shadow-sm">
                    <p className="text-blue-700 text-sm font-semibold mb-1">Total Facturas</p>
                    <p className="text-gray-900 text-2xl font-bold">{facturas.length}</p>
                  </div>
                  <div className="bg-white border-2 border-green-500 rounded-xl p-4 shadow-sm">
                    <p className="text-green-700 text-sm font-semibold mb-1">Activas</p>
                    <p className="text-gray-900 text-2xl font-bold">{facturasActivas.length}</p>
                  </div>
                  <div className="bg-white border-2 border-yellow-500 rounded-xl p-4 shadow-sm">
                    <p className="text-yellow-700 text-sm font-semibold mb-1">Total Facturado</p>
                    <p className="text-gray-900 text-2xl font-bold">
                      {formatCurrency(pagoCompleto.data.facturas.estadisticas.monto_total_facturado)}
                    </p>
                  </div>
                </div>
              )}

              {/* 📄 LISTADO DE FACTURAS */}
              <div className="space-y-4">
                {facturas.map((factura, index) => (
                  <div
                    key={factura.factura_id}
                    className={`border-2 rounded-xl p-5 transition-all bg-white shadow-md ${
                      factura.status === "ACTIVA"
                        ? "border-blue-500 hover:border-blue-600"
                        : "border-red-500 opacity-75"
                    }`}
                  >
                    {/* Header de la factura */}
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-12 h-12 rounded-full flex items-center justify-center ${
                            factura.status === "ACTIVA"
                              ? "bg-green-500"
                              : "bg-red-500"
                          }`}
                        >
                          {factura.status === "ACTIVA" ? (
                            <CheckCircle className="w-6 h-6 text-white" />
                          ) : (
                            <XCircle className="w-6 h-6 text-white" />
                          )}
                        </div>
                        <div>
                          <h3 className="text-gray-900 text-xl font-bold">
                            Factura #{index + 1}
                          </h3>
                          <p className="text-blue-700 font-semibold">
                            Serie: {factura.serie} | Número: {factura.numero}
                          </p>
                          <p
                            className={`text-sm font-semibold mt-1 ${
                              factura.status === "ACTIVA"
                                ? "text-green-600"
                                : "text-red-600"
                            }`}
                          >
                            Estado: {factura.status}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-gray-900 text-3xl font-bold">
                          {formatCurrency(factura.monto_total)}
                        </p>
                        <p className="text-gray-600 text-sm">
                          IVA: {formatCurrency(factura.monto_iva)}
                        </p>
                      </div>
                    </div>

                    {/* Detalles */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-300">
                        <p className="text-blue-700 text-xs font-semibold mb-1">UUID</p>
                        <p className="text-gray-900 text-sm font-mono break-all">
                          {factura.uuid}
                        </p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-300">
                        <p className="text-blue-700 text-xs font-semibold mb-1">
                          Tipo Documento
                        </p>
                        <p className="text-gray-900 text-sm font-bold">
                          {factura.tipo_documento}
                        </p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-300">
                        <p className="text-blue-700 text-xs font-semibold mb-1">
                          Fecha Emisión
                        </p>
                        <p className="text-gray-900 text-sm">
                          {formatDate(factura.fecha_emision)}
                        </p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-300">
                        <p className="text-blue-700 text-xs font-semibold mb-1">
                          Fecha Certificación
                        </p>
                        <p className="text-gray-900 text-sm">
                          {formatDate(factura.fecha_certificacion)}
                        </p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-300">
                        <p className="text-blue-700 text-xs font-semibold mb-1">Receptor</p>
                        <p className="text-gray-900 text-sm font-semibold">
                          {factura.receptor_nombre}
                        </p>
                        <p className="text-gray-600 text-xs">
                          NIT: {factura.receptor_nit}
                        </p>
                      </div>
                      {factura.fecha_anulacion && (
                        <div className="bg-red-50 rounded-lg p-3 border border-red-400">
                          <p className="text-red-700 text-xs font-semibold mb-1">
                            Fecha Anulación
                          </p>
                          <p className="text-gray-900 text-sm">
                            {formatDate(factura.fecha_anulacion)}
                          </p>
                        </div>
                      )}
                      {factura.motivo_anulacion && (
                        <div className="bg-red-50 rounded-lg p-3 border border-red-400 md:col-span-2">
                          <p className="text-red-700 text-xs font-semibold mb-1">
                            Motivo de Anulación
                          </p>
                          <p className="text-gray-900 text-sm">{factura.motivo_anulacion}</p>
                        </div>
                      )}
                    </div>

                    {/* Acciones */}
                    <div className="flex gap-3 flex-wrap">
                      {/* Descargar PDF */}
                      <a
                        href={factura.link_pdf}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors"
                      >
                        <Download className="w-4 h-4" />
                        Descargar PDF
                      </a>

                      {/* Ver en Portal FEL */}
                      <a
                        href={factura.link_fel}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold transition-colors"
                      >
                        <ExternalLink className="w-4 h-4" />
                        Ver en Portal FEL
                      </a>

                      {/* Anular Factura */}
                      {factura.status === "ACTIVA" && (
                        <button
                          onClick={() => setFacturaParaAnular(factura.uuid)}
                          disabled={anularFactura.isPending}
                          className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold transition-colors disabled:opacity-50"
                        >
                          <Trash2 className="w-4 h-4" />
                          Anular Factura
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* 🔹 FOOTER */}
        <div className="bg-gray-100 px-6 py-4 border-t border-gray-300 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>

      {/* 🔹 MODAL DE CONFIRMACIÓN PARA ANULAR */}
      {facturaParaAnular && (
        <div
          className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[60]"
          onClick={() => {
            if (!anularFactura.isPending) {
              setFacturaParaAnular(null);
              setMotivoAnulacion("");
            }
          }}
        >
          <div
            className="bg-white border-2 border-red-500 rounded-xl p-6 max-w-md w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-2xl font-bold text-gray-900 mb-2 flex items-center gap-2">
              <Trash2 className="w-7 h-7 text-red-600" />
              Anular Factura
            </h3>
            <p className="text-gray-700 mb-4">
              Esta acción es <span className="font-bold text-red-600">IRREVERSIBLE</span>.
              Ingresá el motivo de anulación:
            </p>

            <textarea
              value={motivoAnulacion}
              onChange={(e) => setMotivoAnulacion(e.target.value)}
              placeholder="Ej: Error en datos del cliente, Factura duplicada, etc."
              className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 mb-4"
              rows={4}
            />

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setFacturaParaAnular(null);
                  setMotivoAnulacion("");
                }}
                disabled={anularFactura.isPending}
                className="flex-1 px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg font-semibold transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleAnular}
                disabled={anularFactura.isPending || !motivoAnulacion.trim()}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold transition-colors disabled:opacity-50"
              >
                {anularFactura.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Anulando...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Confirmar Anulación
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}