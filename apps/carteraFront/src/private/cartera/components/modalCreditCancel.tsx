/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useMemo, useReducer, useRef } from "react";
import { AxiosError } from "axios";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { getApiErrorMessage } from "@/lib/apiError";
import {
  usePendingCancelCredit,
  useInfoCancelCredit,
} from "../hooks/cancelCredit";
import {
  useContactosEstadoCuentaCancelacion,
  useEnviarEstadoCuentaCancelacion,
  usePreviewEstadoCuentaCancelacion,
} from "../hooks/estadoCuentaCancelacion";
import {
  estadoInicialCancelacion,
  falloConfirmacionEsDefinitivo,
  falloEnvioEsReintentable,
  falloPreviewPermiteSinDocumento,
  flujoCancelacionReducer,
  payloadConfirmacionDesdeDocumento,
  puedeEnviar,
} from "../hooks/estadoCuentaCancelacionFlow";
import {
  descargarPdfEstadoCuentaCancelacion,
  formatearTelefonoGT,
  type PreviewEstadoCuentaBody,
} from "../services/estadoCuentaCancelacion.services";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  Loader2,
  MessageCircle,
  AlertCircle,
  Banknote,
  PercentCircle,
  BadgeDollarSign,
  ShieldCheck,
  ReceiptText,
  FileText,
  X,
  AlertTriangle,
  Hash,
  Calculator,
  Plus,
  MapPin,
} from "lucide-react";
import { toast } from "sonner";

interface MotivoExtra {
  motivo: string;
  monto: number;
}

const fmt = (n: number) =>
  n.toLocaleString("es-GT", { minimumFractionDigits: 2 });

// Montos del backend (texto): se muestran tal cual, con al menos 2 decimales.
const fmtTexto = (s: string) =>
  Number(s).toLocaleString("es-GT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });

const fmtFechaHoraGT = (iso: string) =>
  new Date(iso).toLocaleString("es-GT", {
    timeZone: "America/Guatemala",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

const FASES_CONFIRMADAS = ["PENDIENTE_CONFIRMADO", "ENVIANDO", "ENVIADO", "ERROR_ENVIO"];

export function ModalCancelCredit({
  open,
  onClose,
  creditId,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  creditId: number;
  onSuccess?: () => void;
}) {
  const cancelCredit = useInfoCancelCredit();
  const creditActionMutation = usePendingCancelCredit();

  const [motivos, setMotivos] = useState<MotivoExtra[]>([]);
  const [motivo, setMotivo] = useState("");
  const [monto, setMonto] = useState("");
  const [motivoCancel, setMotivoCancel] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [traspaso, setTraspaso] = useState("");
  const [garantiaMobiliaria, setGarantiaMobiliaria] = useState("");
  const [otros, setOtros] = useState("");
  const [cuotasRestantes, setCuotasRestantes] = useState("");

  // Estado de cuenta previo a la confirmación (ver estadoCuentaCancelacionFlow).
  const previewMutation = usePreviewEstadoCuentaCancelacion();
  const enviarMutation = useEnviarEstadoCuentaCancelacion();
  const [flujo, dispatch] = useReducer(
    flujoCancelacionReducer,
    estadoInicialCancelacion
  );
  // Candado síncrono contra doble clic (el estado del reducer llega en el
  // siguiente render; dos clics en el mismo tick verían la misma fase).
  const accionEnCurso = useRef(false);
  // Sesión del modal: cambia con cada apertura, cambio de crédito o cierre. La
  // respuesta de un preview de otra sesión se descarta: ese documento es de
  // otro crédito, o de un formulario que ya se cerró.
  const sesionModal = useRef(0);
  const [pdfObjectUrl, setPdfObjectUrl] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  // Teléfono elegido de la lista del CRM (`+502XXXXXXXX`); no se escribe a mano.
  const [destinatario, setDestinatario] = useState("");
  // Marcada por defecto: al confirmar, también se envía por WhatsApp.
  const [enviarPorWhatsapp, setEnviarPorWhatsapp] = useState(true);
  // Los teléfonos se consultan desde la vista previa: el envío sale con el
  // mismo clic de «Confirmar cancelación».
  const contactosQuery = useContactosEstadoCuentaCancelacion(
    creditId,
    flujo.documento !== null
  );
  const contactos = useMemo(() => contactosQuery.data ?? [], [contactosQuery.data]);

  // Preselecciona el sugerido (el primero en el orden de Cobros), también
  // cuando el elegido ya no aparece en la lista recién consultada.
  useEffect(() => {
    if (contactos.length > 0 && !contactos.some((c) => c.telefono === destinatario)) {
      setDestinatario((contactos.find((c) => c.sugerido) ?? contactos[0]).telefono);
    }
  }, [contactos, destinatario]);

  // Tras un fallo reintentable se vuelven a consultar los teléfonos: si el
  // número ya no está en el CRM (422), el reintento ofrece los vigentes.
  const refetchContactos = contactosQuery.refetch;
  useEffect(() => {
    if (flujo.fase === "ERROR_ENVIO" && flujo.envioReintentable) void refetchContactos();
  }, [flujo.fase, flujo.envioReintentable, refetchContactos]);

  const destinatarioValido = contactos.some((c) => c.telefono === destinatario);
  // Se envía al confirmar solo si la casilla está marcada y hay un número
  // válido del CRM elegido.
  const envioActivo = enviarPorWhatsapp && destinatarioValido;
  // Con la casilla marcada se espera a conocer el teléfono antes de confirmar.
  const esperandoContactos = enviarPorWhatsapp && contactosQuery.isLoading;

  useEffect(() => {
    if (open && creditId) {
      cancelCredit.mutate(creditId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, creditId]);

  // Cada apertura empieza sin documento: un documentoId nunca pasa de una
  // sesión del modal (ni de un crédito) a otra.
  useEffect(() => {
    dispatch({ type: "REINICIAR" });
    accionEnCurso.current = false;
    sesionModal.current += 1;
    setDestinatario("");
    setEnviarPorWhatsapp(true);
  }, [open, creditId]);

  // Carga los bytes del PDF guardado con la sesión del operador.
  useEffect(() => {
    const doc = flujo.documento;
    if (!doc) return;
    let cancelado = false;
    let url: string | null = null;
    setPdfError(null);
    descargarPdfEstadoCuentaCancelacion(doc.pdfUrl)
      .then((blob) => {
        if (cancelado) return;
        url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
        setPdfObjectUrl(url);
      })
      .catch((err) => {
        if (!cancelado) setPdfError(getApiErrorMessage(err, "No se pudo cargar el PDF"));
      });
    return () => {
      cancelado = true;
      if (url) URL.revokeObjectURL(url);
      setPdfObjectUrl(null);
    };
  }, [flujo.documento]);

  const agregarMotivo = () => {
    const montoNum = Number(monto);
    if (!motivo.trim()) return;
    if (Number.isNaN(montoNum)) return;
    setMotivos((prev) => [...prev, { motivo: motivo.trim(), monto: montoNum }]);
    setMotivo("");
    setMonto("");
  };

  const removeMotivo = (idx: number) =>
    setMotivos((prev) => prev.filter((_, i) => i !== idx));

  const credit = cancelCredit.data?.credito;

  // Valores base del crédito
  const capital = Number(credit?.capital ?? 0);
  const interes = Number(credit?.interes ?? 0);
  const membresias = Number(credit?.membresias ?? 0);
  const seguro = Number(credit?.seguro ?? 0);
  const iva = Number(credit?.iva ?? 0);
  const gps = Number(credit?.gps ?? 0);
  const mora = Number(credit?.mora ?? 0);

  // Cuotas restantes - multiplica interes, membresias, seguro, iva, gps
  const numCuotas = Math.max(0, Math.floor(Number(cuotasRestantes || 0)));
  const totalInteres = interes * numCuotas;
  const totalMembresias = membresias * numCuotas;
  const totalSeguro = seguro * numCuotas;
  const totalIva = iva * numCuotas;
  const totalGps = gps * numCuotas;
  const totalCuotas =
    totalInteres + totalMembresias + totalSeguro + totalIva + totalGps;

  const totalMotivos = motivos.reduce((acc, curr) => acc + curr.monto, 0);
  const totalCamposExtra =
    Number(traspaso || 0) +
    Number(garantiaMobiliaria || 0) +
    Number(otros || 0);
  const total = capital + totalCuotas + mora + totalMotivos + totalCamposExtra;

  const handleClose = () => {
    setMotivos([]);
    setMotivo("");
    setMonto("");
    setMotivoCancel("");
    setObservaciones("");
    setTraspaso("");
    setGarantiaMobiliaria("");
    setOtros("");
    setCuotasRestantes("");
    dispatch({ type: "REINICIAR" });
    accionEnCurso.current = false;
    sesionModal.current += 1;
    setDestinatario("");
    setEnviarPorWhatsapp(true);
    onClose();
  };

  // Flujo actual sin documento: solo se ofrece como «Continuar sin documento»
  // cuando falla la vista previa. Usa el total que calcula el modal.
  const handleCancelCredit = () => {
    if (!motivoCancel.trim()) {
      toast.warning("Debes escribir el motivo principal de la cancelación.");
      return;
    }
    const payload = {
      creditId,
      accion: "PENDIENTE_CANCELACION" as const,
      motivo: motivoCancel.trim(),
      observaciones: observaciones?.trim() || undefined,
      monto_cancelacion: total,
      traspaso: Number(traspaso || 0),
      garantia_mobiliaria: Number(garantiaMobiliaria || 0),
      otros: Number(otros || 0),
      cuotas_atrasadas: numCuotas > 0 ? numCuotas : undefined,
      montosAdicionales: motivos.map((m) => ({
        concepto: m.motivo,
        monto: m.monto,
      })),
    };

    creditActionMutation.mutate(payload, {
      onSuccess: (data: any) => {
        toast.success(data?.message || "Crédito marcado como pendiente de cancelación");
        handleClose();
        onSuccess?.();
      },
      onError: (err: any) => {
        toast.error(err?.message || "No se pudo procesar la solicitud");
      },
    });
  };

  // Primer clic en «Cancelar Crédito»: SOLO genera el estado de cuenta. No
  // llama a /creditAction.
  const handleGenerarPreview = () => {
    if (!motivoCancel.trim()) {
      toast.warning("Debes escribir el motivo principal de la cancelación.");
      return;
    }
    if (flujo.fase !== "FORMULARIO" || accionEnCurso.current) return;
    accionEnCurso.current = true;

    const body: PreviewEstadoCuentaBody = {
      cuotasRestantes: numCuotas,
      traspaso: Number(traspaso || 0),
      garantiaMobiliaria: Number(garantiaMobiliaria || 0),
      otros: Number(otros || 0),
      montosAdicionales: motivos.map((m) => ({
        concepto: m.motivo,
        monto: m.monto,
      })),
      motivo: motivoCancel.trim(),
      observaciones: observaciones?.trim() || undefined,
    };

    const sesion = sesionModal.current;
    dispatch({ type: "GENERAR" });
    previewMutation.mutate(
      { creditId, body },
      {
        onSuccess: (documento) => {
          if (sesion !== sesionModal.current) return;
          accionEnCurso.current = false;
          dispatch({ type: "PREVIEW_OK", documento, entrada: body });
        },
        onError: (err) => {
          if (sesion !== sesionModal.current) return;
          accionEnCurso.current = false;
          dispatch({
            type: "PREVIEW_ERROR",
            mensaje: getApiErrorMessage(err, "No se pudo generar el estado de cuenta"),
            permiteSinDocumento: falloPreviewPermiteSinDocumento(
              err instanceof AxiosError ? err.response?.status : undefined
            ),
          });
        },
      }
    );
  };

  // Envía el enlace por WhatsApp. Solo se llama DESPUÉS del `ok: true` de
  // /creditAction; cada llamada lleva un intentoId nuevo y nunca repite
  // /creditAction. Si sale bien se cierra el modal; si falla, queda abierto
  // con el error.
  const enviarEstadoCuentaWhatsapp = (documentoId: string, telefono: string) => {
    accionEnCurso.current = true;
    dispatch({ type: "ENVIAR" });
    enviarMutation.mutate(
      {
        creditId,
        documentoId,
        destinatarioTelefono: telefono,
        intentoId: crypto.randomUUID(),
      },
      {
        onSuccess: (envio) => {
          accionEnCurso.current = false;
          dispatch({ type: "ENVIO_RESULTADO", envio });
          if (envio.estado === "ENVIADO") {
            toast.success(
              `Crédito pendiente de cancelación · estado de cuenta enviado a ${formatearTelefonoGT(envio.destinatarioTelefono)}${envio.modoPrueba ? " (modo prueba)" : ""}`
            );
            handleClose();
          }
        },
        onError: (err) => {
          accionEnCurso.current = false;
          dispatch({
            type: "ENVIO_FALLO",
            mensaje: getApiErrorMessage(err, "Mensaje no enviado"),
            reintentable: falloEnvioEsReintentable(
              err instanceof AxiosError ? err.response?.status : undefined
            ),
          });
        },
      }
    );
  };

  // Segundo clic: confirma UNA sola vez con el total y conceptos del documento
  // y, si la casilla está marcada, envía el WhatsApp en el mismo paso.
  const handleConfirmar = () => {
    const { documento, entrada } = flujo;
    if (flujo.fase !== "VISTA_PREVIA" || !documento || !entrada) return;
    if (accionEnCurso.current) return;
    accionEnCurso.current = true;
    // El destino se fija al hacer clic: lo que se ve es lo que se envía.
    const telefonoAEnviar = envioActivo ? destinatario : null;

    dispatch({ type: "CONFIRMAR" });
    creditActionMutation.mutate(
      payloadConfirmacionDesdeDocumento(creditId, documento, entrada),
      {
        onSuccess: (data: any) => {
          accionEnCurso.current = false;
          if (data?.ok === false) {
            dispatch({
              type: "CONFIRMAR_ERROR",
              mensaje: data?.message || "No se pudo procesar la solicitud",
            });
            return;
          }
          dispatch({ type: "CONFIRMAR_OK" });
          onSuccess?.();
          if (telefonoAEnviar) {
            enviarEstadoCuentaWhatsapp(documento.documentoId, telefonoAEnviar);
            return;
          }
          toast.success(data?.message || "Crédito marcado como pendiente de cancelación");
          handleClose();
        },
        onError: (err: any) => {
          accionEnCurso.current = false;
          const status = err instanceof AxiosError ? err.response?.status : undefined;
          if (falloConfirmacionEsDefinitivo(status)) {
            dispatch({
              type: "CONFIRMAR_ERROR",
              mensaje: getApiErrorMessage(err, "No se pudo procesar la solicitud"),
            });
            return;
          }
          // Sin respuesta o 5xx: pudo quedar registrada. No se ofrece
          // reconfirmar; se refresca la lista para que se vea el estado real.
          dispatch({
            type: "CONFIRMAR_INCIERTO",
            mensaje: getApiErrorMessage(err, "No se recibió respuesta del servidor"),
          });
          onSuccess?.();
        },
      }
    );
  };

  const handleDescargarPdf = () => {
    const doc = flujo.documento;
    if (!pdfObjectUrl || !doc) return;
    const a = document.createElement("a");
    a.href = pdfObjectUrl;
    a.download = `estado-cuenta-cancelacion-${doc.numeroCredito}-${doc.fechaCorteGT}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // Reintento manual tras un fallo seguro (el crédito ya quedó pendiente).
  const handleReintentarEnvio = () => {
    const doc = flujo.documento;
    if (!doc || !puedeEnviar(flujo) || accionEnCurso.current || !destinatarioValido) return;
    enviarEstadoCuentaWhatsapp(doc.documentoId, destinatario);
  };

  const mostrandoDocumento = flujo.documento !== null;
  const solicitudConfirmada = FASES_CONFIRMADAS.includes(flujo.fase);
  // /creditAction pudo haber quedado registrada: solo se ofrece cerrar.
  const confirmacionIncierta = flujo.fase === "CONFIRMACION_INCIERTA";
  // Mientras se confirma o se envía no se cierra por ninguna vía (X, Escape,
  // clic afuera): el resultado del envío —y su reintento— solo existe en este
  // modal, y un crédito ya pendiente no lo vuelve a abrir.
  const cierreBloqueado = flujo.fase === "CONFIRMANDO" || flujo.fase === "ENVIANDO";

  // Teléfonos del CRM: en la vista previa (antes de confirmar) y, tras un
  // fallo reintentable, en el panel de error con la lista recién consultada.
  const selectorContactos = (habilitado: boolean, sinContactos: string) =>
    contactosQuery.isLoading ? (
      <p className="flex items-center gap-2 text-xs text-gray-500">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Buscando teléfono del cliente...
      </p>
    ) : contactosQuery.isError ? (
      <div className="space-y-1">
        <p className="text-xs text-red-600 whitespace-pre-line">
          {getApiErrorMessage(
            contactosQuery.error,
            "No se pudo consultar el teléfono del cliente"
          )}
        </p>
        <button
          type="button"
          className="text-xs font-medium text-green-700 underline"
          onClick={() => contactosQuery.refetch()}
        >
          Reintentar
        </button>
      </div>
    ) : contactos.length === 0 ? (
      <p className="text-xs text-gray-600">{sinContactos}</p>
    ) : contactos.length === 1 ? (
      <p className="text-sm text-gray-800">
        Al <strong>{formatearTelefonoGT(contactos[0].telefono)}</strong>
      </p>
    ) : (
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {contactos.map((c) => (
          <label key={c.telefono} className="flex items-center gap-1.5 text-sm text-gray-800">
            <input
              type="radio"
              name="destinatario-whatsapp"
              checked={destinatario === c.telefono}
              onChange={() => setDestinatario(c.telefono)}
              disabled={!habilitado}
            />
            <strong>{formatearTelefonoGT(c.telefono)}</strong>
          </label>
        ))}
      </div>
    );

  const InfoRow = ({
    icon: Icon,
    iconColor,
    label,
    value,
    valueColor,
  }: {
    icon: any;
    iconColor: string;
    label: string;
    value: string;
    valueColor: string;
  }) => (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0">
      <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${iconColor}`} />
        <span className="text-sm text-gray-600">{label}</span>
      </div>
      <span className={`text-sm font-semibold ${valueColor}`}>{value}</span>
    </div>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(abierto) => {
        if (!abierto && cierreBloqueado) return;
        onClose();
      }}
    >
      <DialogContent
        showCloseButton={!cierreBloqueado}
        className={`
          bg-white
          shadow-xl
          border border-gray-200
          rounded-2xl
          ${mostrandoDocumento ? "max-w-4xl" : "max-w-lg"}
          w-[98vw]
          mx-auto
          p-0
        `}
      >
        <div className="max-h-[85vh] overflow-y-auto">
          {/* Header */}
          <div className="bg-gradient-to-r from-red-50 to-orange-50 border-b border-gray-200 px-6 py-4 rounded-t-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
                <AlertCircle className="text-red-600 w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  Cancelar crédito
                </h2>
                <p className="text-xs text-gray-500">
                  {solicitudConfirmada
                    ? "Solicitud de cancelación registrada"
                    : mostrandoDocumento
                      ? "Revisa el estado de cuenta antes de confirmar"
                      : "Revisa los montos antes de continuar"}
                </p>
              </div>
            </div>
          </div>

          <div className="px-6 py-4 space-y-4">
            {!mostrandoDocumento && (
            // Bloqueado mientras se genera: el PDF debe reflejar exactamente lo enviado.
            <fieldset disabled={flujo.fase === "GENERANDO"} className="space-y-4 min-w-0">
            {flujo.errorPreview && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-3">
                <p className="text-sm text-red-600 whitespace-pre-line">
                  {flujo.errorPreview}
                </p>
                {/* Solo tras una falla técnica: si el backend rechazó la
                    solicitud (p. ej. 409, el crédito ya no es elegible), no
                    se ofrece mandarla igual por /creditAction. */}
                {flujo.previewPermiteSinDocumento && (
                  <p className="text-xs text-gray-600">
                    Puedes reintentar, o continuar sin documento:{" "}
                    <strong>esta solicitud no tendrá PDF ni envío al cliente</strong>{" "}
                    y se usará el total calculado en esta pantalla.
                  </p>
                )}
                <div className="flex gap-2 justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-gray-300 text-gray-700"
                    onClick={handleGenerarPreview}
                    disabled={
                      flujo.fase !== "FORMULARIO" ||
                      creditActionMutation.status === "pending"
                    }
                  >
                    Reintentar
                  </Button>
                  {flujo.previewPermiteSinDocumento && (
                    <Button
                      size="sm"
                      className="bg-amber-600 hover:bg-amber-700 text-white"
                      onClick={handleCancelCredit}
                      disabled={
                        flujo.fase !== "FORMULARIO" ||
                        creditActionMutation.status === "pending" ||
                        !motivoCancel.trim()
                      }
                    >
                      {creditActionMutation.status === "pending"
                        ? "Cancelando..."
                        : "Continuar sin documento"}
                    </Button>
                  )}
                </div>
              </div>
            )}

            {cancelCredit.error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm text-red-600">
                  {cancelCredit.error.message}
                </p>
              </div>
            )}

            {/* Valores por cuota del crédito */}
            {credit && (
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                  Valores del crédito
                </h3>
                <InfoRow
                  icon={Banknote}
                  iconColor="text-emerald-600"
                  label="Capital"
                  value={`Q${fmt(capital)}`}
                  valueColor="text-emerald-700"
                />
                <InfoRow
                  icon={PercentCircle}
                  iconColor="text-blue-600"
                  label="Interés"
                  value={`Q${fmt(interes)}`}
                  valueColor="text-blue-700"
                />
                <InfoRow
                  icon={BadgeDollarSign}
                  iconColor="text-amber-600"
                  label="Membresías"
                  value={`Q${fmt(membresias)}`}
                  valueColor="text-amber-700"
                />
                <InfoRow
                  icon={ShieldCheck}
                  iconColor="text-indigo-600"
                  label="Seguro"
                  value={`Q${fmt(seguro)}`}
                  valueColor="text-indigo-700"
                />
                <InfoRow
                  icon={ReceiptText}
                  iconColor="text-pink-600"
                  label="IVA"
                  value={`Q${fmt(iva)}`}
                  valueColor="text-pink-700"
                />
                {gps > 0 && (
                  <InfoRow
                    icon={MapPin}
                    iconColor="text-cyan-600"
                    label="GPS"
                    value={`Q${fmt(gps)}`}
                    valueColor="text-cyan-700"
                  />
                )}
                {mora > 0 && (
                  <InfoRow
                    icon={AlertTriangle}
                    iconColor="text-orange-600"
                    label="Mora"
                    value={`Q${fmt(mora)}`}
                    valueColor="text-orange-700"
                  />
                )}
              </div>
            )}

            {/* Cuotas restantes input */}
            {credit && (
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-200">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                    <Hash className="w-4 h-4 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-blue-800">
                      Cuotas restantes
                    </h3>
                    <p className="text-xs text-blue-500">
                      Multiplica interés, membresía, seguro, IVA y GPS
                    </p>
                  </div>
                </div>
                <Input
                  type="number"
                  placeholder="0"
                  value={cuotasRestantes}
                  min={0}
                  step={1}
                  onChange={(e) => setCuotasRestantes(e.target.value)}
                  onKeyDown={(e) => {
                    if (["e", "E", "+", "-", "."].includes(e.key))
                      e.preventDefault();
                  }}
                  className="bg-white border-blue-200 text-center text-lg font-bold text-blue-800 h-12 rounded-lg focus:border-blue-400 focus:ring-blue-400"
                />

                {numCuotas > 0 && (
                  <div className="mt-3 bg-white/70 rounded-lg p-3 border border-blue-100">
                    <div className="flex items-center gap-2 mb-2">
                      <Calculator className="w-3.5 h-3.5 text-blue-500" />
                      <span className="text-xs font-semibold text-blue-600 uppercase tracking-wider">
                        Proyección &times; {numCuotas}
                      </span>
                    </div>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Intereses</span>
                        <span className="font-medium text-blue-700">
                          Q{fmt(totalInteres)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Membresías</span>
                        <span className="font-medium text-amber-700">
                          Q{fmt(totalMembresias)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Seguro</span>
                        <span className="font-medium text-indigo-700">
                          Q{fmt(totalSeguro)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">IVA</span>
                        <span className="font-medium text-pink-700">
                          Q{fmt(totalIva)}
                        </span>
                      </div>
                      {gps > 0 && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">GPS</span>
                          <span className="font-medium text-cyan-700">
                            Q{fmt(totalGps)}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between pt-1 border-t border-blue-100">
                        <span className="font-semibold text-gray-700">
                          Subtotal cuotas
                        </span>
                        <span className="font-bold text-blue-800">
                          Q{fmt(totalCuotas)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Costos adicionales */}
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Costos adicionales
              </h3>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs text-gray-500 mb-1 block">
                    Traspaso
                  </Label>
                  <Input
                    placeholder="0.00"
                    type="number"
                    value={traspaso}
                    step="0.01"
                    onChange={(e) => setTraspaso(e.target.value)}
                    onKeyDown={(e) => {
                      if (["e", "E", "+"].includes(e.key)) e.preventDefault();
                    }}
                    className="bg-white border-gray-200 text-sm h-9 text-gray-900"
                  />
                </div>
                <div>
                  <Label className="text-xs text-gray-500 mb-1 block">
                    Garantía mob.
                  </Label>
                  <Input
                    placeholder="0.00"
                    type="number"
                    value={garantiaMobiliaria}
                    step="0.01"
                    onChange={(e) => setGarantiaMobiliaria(e.target.value)}
                    onKeyDown={(e) => {
                      if (["e", "E", "+"].includes(e.key)) e.preventDefault();
                    }}
                    className="bg-white border-gray-200 text-sm h-9 text-gray-900"
                  />
                </div>
                <div>
                  <Label className="text-xs text-gray-500 mb-1 block">
                    Otros
                  </Label>
                  <Input
                    placeholder="0.00"
                    type="number"
                    value={otros}
                    step="0.01"
                    onChange={(e) => setOtros(e.target.value)}
                    onKeyDown={(e) => {
                      if (["e", "E", "+"].includes(e.key)) e.preventDefault();
                    }}
                    className="bg-white border-gray-200 text-sm h-9 text-gray-900"
                  />
                </div>
              </div>
            </div>

            {/* Montos adicionales */}
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Montos adicionales
              </h3>
              <div className="flex gap-2">
                <Input
                  placeholder="Motivo"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") agregarMotivo();
                  }}
                  className="bg-white border-gray-200 text-sm h-9 flex-1 text-gray-900"
                />
                <Input
                  placeholder="Monto"
                  type="number"
                  value={monto}
                  step="0.01"
                  onChange={(e) => setMonto(e.target.value)}
                  onKeyDown={(e) => {
                    if (["e", "E", "+"].includes(e.key)) e.preventDefault();
                  }}
                  className="bg-white border-gray-200 text-sm h-9 w-28 text-gray-900"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 px-3 border-gray-300 hover:bg-gray-100"
                  onClick={agregarMotivo}
                  disabled={
                    !motivo ||
                    monto.trim() === "" ||
                    Number.isNaN(Number(monto))
                  }
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              {motivos.length > 0 && (
                <div className="mt-2 max-h-24 overflow-y-auto space-y-1">
                  {motivos.map((m, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 text-sm bg-white rounded-lg px-3 py-1.5 border border-gray-100"
                    >
                      <FileText className="w-3.5 h-3.5 text-gray-400" />
                      <span className="text-gray-600 flex-1 truncate">
                        {m.motivo}
                      </span>
                      <span className="font-semibold text-gray-800">
                        Q{fmt(m.monto)}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeMotivo(i)}
                        className="text-gray-400 hover:text-red-500 transition"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Motivo + observaciones */}
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Motivo de cancelación
              </h3>
              <Input
                placeholder="Motivo de la cancelación *"
                value={motivoCancel}
                onChange={(e) => setMotivoCancel(e.target.value)}
                className="bg-white border-gray-200 text-sm h-9 mb-2 text-gray-900"
                required
              />
              <Input
                placeholder="Observaciones (opcional)"
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                className="bg-white border-gray-200 text-sm h-9 text-gray-900"
              />
            </div>

            {/* Total */}
            <div className="bg-gradient-to-r from-emerald-50 to-green-50 rounded-xl p-4 border border-emerald-200">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-600">
                  Total de cancelación
                </span>
                <span className="text-2xl font-extrabold text-emerald-700">
                  Q{fmt(total)}
                </span>
              </div>
            </div>
            </fieldset>
            )}

            {/* Vista previa del estado de cuenta (datos del backend) */}
            {flujo.documento && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs bg-gray-50 rounded-xl p-3 border border-gray-200">
                  <div>
                    <span className="text-gray-400 block">Folio</span>
                    <span className="font-mono text-gray-700 break-all">
                      {flujo.documento.documentoId}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400 block">Fecha de corte</span>
                    <span className="text-gray-700">{flujo.documento.fechaCorteGT}</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block">Emitido (Guatemala)</span>
                    <span className="text-gray-700">
                      {fmtFechaHoraGT(flujo.documento.generadoAt)}
                    </span>
                  </div>
                </div>

                <div className="rounded-xl border border-gray-200 overflow-hidden bg-gray-100 h-[50vh]">
                  {pdfObjectUrl ? (
                    <iframe
                      src={pdfObjectUrl}
                      title="Estado de cuenta para solicitud de cancelación"
                      className="w-full h-full"
                    />
                  ) : pdfError ? (
                    <div className="h-full flex items-center justify-center p-4">
                      <p className="text-sm text-red-600 whitespace-pre-line">{pdfError}</p>
                    </div>
                  ) : (
                    <div className="h-full flex items-center justify-center gap-2 text-sm text-gray-500">
                      <Loader2 className="w-4 h-4 animate-spin" /> Cargando PDF...
                    </div>
                  )}
                </div>

                <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 text-sm space-y-1">
                  {(() => {
                    const d = flujo.documento.desglose;
                    const filas: [string, string][] = [
                      ["Capital actual", d.capital],
                      [`Cuotas restantes (${d.cuotasRestantes})`, d.totalesCuotas.subtotal],
                      ["Mora activa", d.mora],
                      ["Traspaso", d.traspaso],
                      ["Garantía mobiliaria", d.garantiaMobiliaria],
                      ["Otros", d.otros],
                      ...d.montosAdicionales.map(
                        (m) => [m.concepto, m.monto] as [string, string]
                      ),
                    ];
                    return filas.map(([etiqueta, monto], i) => (
                      <div key={i} className="flex justify-between gap-3">
                        <span className="text-gray-500 truncate">{etiqueta}</span>
                        <span className="font-medium text-gray-800">Q{fmtTexto(monto)}</span>
                      </div>
                    ));
                  })()}
                  <div className="flex justify-between pt-2 mt-1 border-t border-gray-200">
                    <span className="font-semibold text-gray-700">Total de cancelación</span>
                    <span className="text-xl font-extrabold text-emerald-700">
                      Q{fmtTexto(flujo.documento.montoCancelacion)}
                    </span>
                  </div>
                </div>

                {flujo.errorConfirmacion && !confirmacionIncierta && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                    <p className="text-sm text-red-600">
                      No se confirmó la solicitud: {flujo.errorConfirmacion}
                    </p>
                  </div>
                )}

                {confirmacionIncierta && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
                    <p className="text-sm font-semibold text-amber-800">
                      No se pudo confirmar si la solicitud quedó registrada.
                    </p>
                    <p className="text-xs text-amber-800">
                      Cierra y revisa el estado del crédito antes de intentarlo de nuevo.
                    </p>
                    {flujo.errorConfirmacion && (
                      <p className="text-xs text-amber-700 whitespace-pre-line">
                        {flujo.errorConfirmacion}
                      </p>
                    )}
                  </div>
                )}

                {/* WhatsApp: se elige ANTES de confirmar y sale con el mismo clic.
                    Textos a la izquierda; la casilla a la derecha, centrada. */}
                {!solicitudConfirmada && !confirmacionIncierta && (
                  <div className="bg-green-50 rounded-xl px-4 py-3 border border-green-200 flex items-center justify-between gap-4">
                    <div className="min-w-0 space-y-1">
                      <label
                        htmlFor="enviar-estado-cuenta-whatsapp"
                        className="flex items-center gap-2 text-sm font-semibold text-green-800 cursor-pointer"
                      >
                        <MessageCircle className="w-4 h-4 text-green-700 shrink-0" />
                        Enviar estado de cuenta por WhatsApp
                      </label>

                      {selectorContactos(
                        enviarPorWhatsapp && flujo.fase === "VISTA_PREVIA",
                        "El cliente no tiene un celular válido registrado; se confirmará sin enviar."
                      )}
                    </div>

                    <input
                      id="enviar-estado-cuenta-whatsapp"
                      type="checkbox"
                      className="h-5 w-5 shrink-0 cursor-pointer accent-green-600 disabled:cursor-not-allowed"
                      checked={enviarPorWhatsapp && contactos.length > 0}
                      onChange={(e) => setEnviarPorWhatsapp(e.target.checked)}
                      disabled={contactos.length === 0 || flujo.fase !== "VISTA_PREVIA"}
                    />
                  </div>
                )}

                {solicitudConfirmada && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <p className="text-sm text-emerald-700">
                      Crédito marcado como pendiente de cancelación.
                    </p>
                  </div>
                )}

                {flujo.fase === "ENVIANDO" && (
                  <p className="flex items-center gap-2 text-sm text-gray-600">
                    <Loader2 className="w-4 h-4 animate-spin" /> Enviando estado de cuenta por
                    WhatsApp...
                  </p>
                )}

                {/* Si el envío falla, el modal queda abierto con el error */}
                {flujo.fase === "ERROR_ENVIO" && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
                    <p className="text-sm font-semibold text-red-700">
                      Solicitud pendiente; mensaje no enviado.
                    </p>
                    {flujo.errorEnvio && (
                      <p className="text-xs text-red-600 whitespace-pre-line">{flujo.errorEnvio}</p>
                    )}
                    {flujo.envioReintentable ? (
                      <div className="space-y-2">
                        {selectorContactos(
                          true,
                          "El cliente ya no tiene un celular válido registrado en el CRM; no se puede reenviar."
                        )}
                        <div className="flex justify-end">
                          <Button
                            size="sm"
                            className="bg-green-600 hover:bg-green-700 text-white"
                            onClick={handleReintentarEnvio}
                            disabled={!destinatarioValido || contactosQuery.isFetching}
                          >
                            {contactosQuery.isFetching ? "Verificando teléfonos..." : "Reintentar envío"}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-red-700">
                        El resultado es incierto: el mensaje pudo haber salido. Revisa
                        manualmente antes de volver a enviarlo.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer buttons */}
          <div className="bg-white border-t border-gray-200 px-6 py-4 rounded-b-2xl">
            <div className="flex flex-wrap gap-3 justify-end">
              {!mostrandoDocumento && (
                <>
                  <Button
                    variant="outline"
                    className="h-10 px-5 text-sm font-medium border-gray-300 text-gray-600 hover:bg-gray-50"
                    onClick={handleClose}
                  >
                    Cerrar
                  </Button>
                  <Button
                    className="h-10 px-5 text-sm font-medium bg-red-600 hover:bg-red-700 text-white shadow-sm"
                    onClick={handleGenerarPreview}
                    disabled={
                      flujo.fase !== "FORMULARIO" ||
                      creditActionMutation.status === "pending" ||
                      !motivoCancel.trim()
                    }
                    title={
                      !motivoCancel.trim()
                        ? "Escribe el motivo de cancelación"
                        : ""
                    }
                  >
                    {flujo.fase === "GENERANDO"
                      ? "Generando estado de cuenta..."
                      : "Cancelar Crédito"}
                  </Button>
                </>
              )}

              {mostrandoDocumento && !solicitudConfirmada && !confirmacionIncierta && (
                <>
                  <Button
                    variant="outline"
                    className="h-10 px-4 text-sm font-medium border-gray-300 text-gray-600 hover:bg-gray-50"
                    onClick={() => dispatch({ type: "VOLVER_A_EDITAR" })}
                    disabled={flujo.fase !== "VISTA_PREVIA"}
                  >
                    <ArrowLeft className="w-4 h-4 mr-1" /> Volver y editar
                  </Button>
                  <Button
                    variant="outline"
                    className="h-10 px-4 text-sm font-medium border-gray-300 text-gray-700 hover:bg-gray-50"
                    onClick={handleDescargarPdf}
                    disabled={!pdfObjectUrl}
                  >
                    <Download className="w-4 h-4 mr-1" /> Descargar PDF
                  </Button>
                  <Button
                    className="h-10 px-5 text-sm font-medium bg-red-600 hover:bg-red-700 text-white shadow-sm"
                    onClick={handleConfirmar}
                    disabled={flujo.fase !== "VISTA_PREVIA" || esperandoContactos}
                  >
                    {flujo.fase === "CONFIRMANDO"
                      ? "Confirmando..."
                      : envioActivo
                        ? "Confirmar cancelación y enviar"
                        : "Confirmar cancelación"}
                  </Button>
                </>
              )}

              {(solicitudConfirmada || confirmacionIncierta) && (
                <>
                  <Button
                    variant="outline"
                    className="h-10 px-4 text-sm font-medium border-gray-300 text-gray-700 hover:bg-gray-50"
                    onClick={handleDescargarPdf}
                    disabled={!pdfObjectUrl}
                  >
                    <Download className="w-4 h-4 mr-1" /> Descargar PDF
                  </Button>
                  <Button
                    variant="outline"
                    className="h-10 px-5 text-sm font-medium border-gray-300 text-gray-600 hover:bg-gray-50"
                    onClick={handleClose}
                    disabled={cierreBloqueado}
                  >
                    Cerrar
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
