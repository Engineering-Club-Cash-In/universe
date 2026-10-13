import { createHash } from "crypto";
import {
  calcularDesgloseCancelacion,
  fechaCorteGuatemala,
  normalizarEntradaEstadoCuenta,
  type DesgloseEstadoCuentaCancelacion,
  type EntradaEstadoCuentaCancelacion,
  type MontosCreditoCancelacion,
  type PreviewEstadoCuentaBody,
} from "./estadoCuentaCancelacionCalculo";
import {
  renderEstadoCuentaCancelacionHTML,
  type HistorialPagosRenderizado,
} from "./estadoCuentaCancelacionHtml";

// ================================================================
// Estado de cuenta al solicitar la cancelación — orquestación.
//
// Este módulo NO cambia el estado del crédito, NO crea pagos y NO toca
// `credit_cancelations`: la confirmación sigue siendo el `POST /creditAction`
// de siempre. Aquí solo se emite el documento (preview), se sirve el mismo
// archivo (pdf) y se le manda al cliente por WhatsApp un enlace a ese mismo
// archivo (enviar), que abre sin sesión mientras no venza (enlace público).
//
// Cartera no tiene teléfonos de clientes ni conexión con WhatsApp: los dos los
// pone el CRM. Todo lo que toca BD, R2, Puppeteer o el CRM entra por
// `EstadoCuentaCancelacionDeps`, para poder probarlo sin infraestructura y sin
// mandar mensajes reales.
// ================================================================

/** Estados en los que hoy se ve «Cancelar crédito» (`canCancel` del front). */
export const ESTADOS_PERMITIDOS_PREVIEW = ["ACTIVO", "MOROSO"] as const;

export interface CreditoParaEstadoCuenta {
  creditoId: number;
  numeroCreditoSifco: string;
  clienteNombre: string;
  statusCredit: string;
  montos: MontosCreditoCancelacion;
}

export interface DocumentoEstadoCuenta {
  id: string;
  creditoId: number;
  numeroCreditoSifco: string;
  clienteNombre: string;
  fechaCorteGT: string;
  generadoAt: Date;
  generadoPorId: number;
  montoCancelacion: string;
  entrada: EntradaEstadoCuentaCancelacion;
  desglose: DesgloseEstadoCuentaCancelacion;
  pdfKey: string;
  pdfSha256: string;
}

export type EstadoEnvio = "EN_PROCESO" | "ENVIADO" | "ERROR";

/** De dónde salió el teléfono en el CRM (mismo orden de prioridad que Cobros). */
export type FuenteTelefono = "CASO_COBROS" | "LEAD" | "SOLICITUD";

export interface ContactoTelefono {
  /** `+502XXXXXXXX`. */
  telefono: string;
  fuente: FuenteTelefono;
  sugerido: boolean;
}

export interface EnvioEstadoCuenta {
  id: string;
  documentoId: string;
  enlaceId: string | null;
  canal: "WHATSAPP";
  destinatarioTelefono: string;
  destinatarioFuente: FuenteTelefono;
  solicitadoPorId: number;
  estado: EstadoEnvio;
  /** "SimpleTech", o "SimpleTech (prueba)" si el CRM lo desvió a un número de prueba. */
  proveedor: string | null;
  proveedorMensajeId: string | null;
  errorResumen: string | null;
  solicitadoAt: Date | null;
  finalizadoAt: Date | null;
}

export interface EnlaceEstadoCuenta {
  id: string;
  documentoId: string;
  /** Huella del código: el código en claro solo viaja en el mensaje. */
  codigoSha256: string;
  creadoPorId: number;
  creadoAt: Date;
  venceAt: Date;
  revocadoAt: Date | null;
  aperturas: number;
}

/**
 * Resultado del envío, separado en lo que SÍ se sabe:
 *  - NO_ENVIADO: el proveedor rechazó o nunca se le llamó → se puede reintentar.
 *  - INCIERTO:   timeout/caída tras la llamada → pudo salir; revisión manual.
 */
export type ResultadoProveedorWhatsapp =
  | { resultado: "ENVIADO"; proveedor: string; mensajeId: string | null; modoPrueba: boolean }
  | { resultado: "NO_ENVIADO" | "INCIERTO"; proveedor: string; error: string; modoPrueba?: boolean };

export interface WhatsappEstadoCuentaParams {
  intentoId: string;
  telefono: string;
  mensaje: string;
  numeroCreditoSifco: string;
}

export interface EstadoCuentaCancelacionDeps {
  cargarCredito(creditoId: number): Promise<CreditoParaEstadoCuenta | null>;
  cargarHistorial(numeroCreditoSifco: string, capitalActual: string | null): Promise<HistorialPagosRenderizado>;
  generarPdf(html: string): Promise<Buffer>;
  subirPdf(key: string, bytes: Buffer): Promise<void>;
  borrarPdf(key: string): Promise<void>;
  descargarPdf(key: string): Promise<Buffer>;
  insertarDocumento(doc: DocumentoEstadoCuenta): Promise<void>;
  buscarDocumento(documentoId: string, creditoId: number): Promise<DocumentoEstadoCuenta | null>;
  buscarEnvio(intentoId: string): Promise<EnvioEstadoCuenta | null>;
  /** Inserta EN_PROCESO; `false` si ese `intentoId` ya existía (conflicto de PK). */
  crearEnvio(envio: EnvioEstadoCuenta): Promise<boolean>;
  finalizarEnvio(
    intentoId: string,
    cambios: Pick<
      EnvioEstadoCuenta,
      "estado" | "proveedor" | "proveedorMensajeId" | "errorResumen" | "finalizadoAt" | "enlaceId"
    >
  ): Promise<void>;
  /** Celulares válidos del cliente según el CRM, ya ordenados. */
  obtenerContactos(numeroCreditoSifco: string): Promise<ContactoTelefono[]>;
  /** Pide al CRM el envío por WhatsApp. */
  enviarWhatsapp(params: WhatsappEstadoCuentaParams): Promise<ResultadoProveedorWhatsapp>;
  crearEnlace(enlace: EnlaceEstadoCuenta): Promise<void>;
  buscarEnlacePorHash(
    codigoSha256: string
  ): Promise<{ enlace: EnlaceEstadoCuenta; documento: DocumentoEstadoCuenta } | null>;
  registrarApertura(enlaceId: string, cuando: Date): Promise<void>;
  /** Base pública del enlace (dominio de Cartera); null si no está configurada. */
  enlaceBaseUrl(): string | null;
  vigenciaEnlaceDias(): number;
  /** Código aleatorio del enlace (128 bits, base64url). */
  generarCodigo(): string;
  ahora(): Date;
  nuevoId(): string;
  logoUrl(): string;
}

export type Resultado<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

const falla = (status: number, message: string): { ok: false; status: number; message: string } => ({
  ok: false,
  status,
  message,
});

export const sha256Hex = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export const pdfKeyEstadoCuenta = (creditoId: number, documentoId: string) =>
  `estados-cuenta-cancelacion/${creditoId}/${documentoId}.pdf`;

export const pdfUrlEstadoCuenta = (creditoId: number, documentoId: string) =>
  `/credit/${creditoId}/cancelacion/estado-cuenta/${documentoId}/pdf`;

export const nombreArchivoEstadoCuenta = (doc: Pick<DocumentoEstadoCuenta, "numeroCreditoSifco" | "fechaCorteGT">) =>
  `estado-cuenta-cancelacion-${doc.numeroCreditoSifco.replace(/[^a-zA-Z0-9_-]/g, "_")}-${doc.fechaCorteGT}.pdf`;

const resumenError = (err: unknown) =>
  String((err as any)?.message ?? err ?? "Error desconocido").slice(0, 500);

// ----------------------------------------------------------------
// Preview
// ----------------------------------------------------------------

export interface PreviewEstadoCuentaRespuesta {
  documentoId: string;
  numeroCredito: string;
  fechaCorteGT: string;
  generadoAt: string;
  desglose: DesgloseEstadoCuentaCancelacion;
  montoCancelacion: string;
  pdfUrl: string;
}

export async function generarPreviewEstadoCuenta(
  deps: EstadoCuentaCancelacionDeps,
  input: { creditoId: number; usuarioId: number; body: PreviewEstadoCuentaBody }
): Promise<Resultado<PreviewEstadoCuentaRespuesta>> {
  const credito = await deps.cargarCredito(input.creditoId);
  if (!credito) return falla(404, "Crédito no encontrado.");
  if (!(ESTADOS_PERMITIDOS_PREVIEW as readonly string[]).includes(credito.statusCredit)) {
    return falla(
      409,
      `El estado de cuenta para cancelación solo se genera para créditos ACTIVO o MOROSO (estado actual: ${credito.statusCredit}).`
    );
  }

  const entrada = normalizarEntradaEstadoCuenta(input.body);
  const desglose = calcularDesgloseCancelacion(credito.montos, entrada);
  const historial = await deps.cargarHistorial(credito.numeroCreditoSifco, credito.montos.capital);

  const documentoId = deps.nuevoId();
  const generadoAt = deps.ahora();
  const fechaCorteGT = fechaCorteGuatemala(generadoAt);

  const html = renderEstadoCuentaCancelacionHTML({
    documentoId,
    numeroCredito: credito.numeroCreditoSifco,
    clienteNombre: credito.clienteNombre,
    generadoAt,
    fechaCorteGT,
    logoUrl: deps.logoUrl(),
    historial,
    entrada,
    desglose,
  });

  let pdf: Buffer;
  try {
    pdf = await deps.generarPdf(html);
  } catch (err) {
    console.error("[estadoCuentaCancelacion] Error generando PDF:", err);
    return falla(500, "No se pudo generar el PDF del estado de cuenta.");
  }

  const pdfKey = pdfKeyEstadoCuenta(credito.creditoId, documentoId);
  try {
    await deps.subirPdf(pdfKey, pdf);
  } catch (err) {
    console.error("[estadoCuentaCancelacion] Error subiendo PDF a R2:", err);
    return falla(502, "No se pudo guardar el PDF del estado de cuenta.");
  }

  const doc: DocumentoEstadoCuenta = {
    id: documentoId,
    creditoId: credito.creditoId,
    numeroCreditoSifco: credito.numeroCreditoSifco,
    clienteNombre: credito.clienteNombre,
    fechaCorteGT,
    generadoAt,
    generadoPorId: input.usuarioId,
    montoCancelacion: desglose.montoCancelacion,
    entrada,
    desglose,
    pdfKey,
    pdfSha256: sha256Hex(pdf),
  };

  try {
    await deps.insertarDocumento(doc);
  } catch (err) {
    console.error("[estadoCuentaCancelacion] Error registrando documento:", err);
    // Solo se borra el objeto si se CONFIRMA que la fila no quedó: si el
    // insert llegó a confirmarse (timeout tras commit), borrarlo dejaría un
    // documento apuntando a un archivo inexistente.
    try {
      const quedo = await deps.buscarDocumento(documentoId, credito.creditoId);
      if (!quedo) {
        await deps.borrarPdf(pdfKey).catch((e) =>
          console.error("[estadoCuentaCancelacion] No se pudo limpiar el PDF huérfano:", pdfKey, e)
        );
        return falla(500, "No se pudo registrar el estado de cuenta.");
      }
    } catch (e) {
      console.error("[estadoCuentaCancelacion] No se pudo verificar el registro; se conserva el PDF:", pdfKey, e);
      return falla(500, "No se pudo registrar el estado de cuenta.");
    }
  }

  return {
    ok: true,
    data: {
      documentoId,
      numeroCredito: credito.numeroCreditoSifco,
      fechaCorteGT,
      generadoAt: generadoAt.toISOString(),
      desglose,
      montoCancelacion: desglose.montoCancelacion,
      pdfUrl: pdfUrlEstadoCuenta(credito.creditoId, documentoId),
    },
  };
}

// ----------------------------------------------------------------
// PDF
// ----------------------------------------------------------------

async function leerPdfVerificado(
  deps: EstadoCuentaCancelacionDeps,
  doc: DocumentoEstadoCuenta
): Promise<Resultado<Buffer>> {
  let bytes: Buffer;
  try {
    bytes = await deps.descargarPdf(doc.pdfKey);
  } catch (err) {
    console.error("[estadoCuentaCancelacion] Error leyendo PDF de R2:", doc.pdfKey, err);
    return falla(502, "No se pudo recuperar el PDF del estado de cuenta.");
  }
  if (sha256Hex(bytes) !== doc.pdfSha256) {
    console.error("[estadoCuentaCancelacion] SHA-256 no coincide:", doc.id, doc.pdfKey);
    return falla(500, "El PDF almacenado no coincide con el emitido (verificación de integridad).");
  }
  return { ok: true, data: bytes };
}

export async function obtenerPdfEstadoCuenta(
  deps: EstadoCuentaCancelacionDeps,
  input: { creditoId: number; documentoId: string }
): Promise<Resultado<{ bytes: Buffer; filename: string }>> {
  const doc = await deps.buscarDocumento(input.documentoId, input.creditoId);
  if (!doc) return falla(404, "Documento no encontrado para este crédito.");
  const pdf = await leerPdfVerificado(deps, doc);
  if (!pdf.ok) return pdf;
  return { ok: true, data: { bytes: pdf.data, filename: nombreArchivoEstadoCuenta(doc) } };
}

// ----------------------------------------------------------------
// Contactos (teléfonos del cliente, desde el CRM)
// ----------------------------------------------------------------

/** Últimos 8 dígitos de un teléfono de Guatemala (con o sin 502), o null. */
export function digitosTelefonoGT(raw: string): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("502")) d = d.slice(3);
  return d.length === 8 ? d : null;
}

export async function obtenerContactosEstadoCuenta(
  deps: EstadoCuentaCancelacionDeps,
  input: { creditoId: number }
): Promise<Resultado<{ contactos: ContactoTelefono[] }>> {
  const credito = await deps.cargarCredito(input.creditoId);
  if (!credito) return falla(404, "Crédito no encontrado.");
  try {
    return { ok: true, data: { contactos: await deps.obtenerContactos(credito.numeroCreditoSifco) } };
  } catch (err) {
    console.error("[estadoCuentaCancelacion] Error consultando contactos en CRM:", err);
    return falla(502, "No se pudieron consultar los teléfonos del cliente en el CRM.");
  }
}

// ----------------------------------------------------------------
// Enviar (WhatsApp con enlace)
// ----------------------------------------------------------------

export const PREFIJO_NO_ENVIADO = "NO_ENVIADO: ";
export const PREFIJO_INCIERTO = "INCIERTO: ";
export const PROVEEDOR_WHATSAPP = "SimpleTech";
const SUFIJO_PRUEBA = " (prueba)";

export const sha256Texto = (texto: string) => createHash("sha256").update(texto, "utf8").digest("hex");

export const urlEnlaceEstadoCuenta = (base: string, codigo: string) =>
  `${base.replace(/\/+$/, "")}/ec/${codigo}`;

const formatearVencimiento = (instante: Date) => {
  const tz = { timeZone: "America/Guatemala" } as const;
  const fecha = instante.toLocaleDateString("es-GT", { ...tz, day: "numeric", month: "long", year: "numeric" });
  const hora = instante.toLocaleTimeString("es-GT", { ...tz, hour: "2-digit", minute: "2-digit", hour12: false });
  return `${fecha} a las ${hora}`;
};

/**
 * Texto que va dentro de la plantilla genérica del CRM. Cada párrafo es un
 * parámetro de la plantilla (aquí 3 → `mensaje3parametro`), y WhatsApp no
 * acepta saltos de línea dentro de un parámetro: el nombre se aplana.
 * La plantilla ya agrega «Hola, te compartimos la siguiente información
 * importante:» arriba y «Att, Club Cash In» abajo.
 */
export function mensajeWhatsappEstadoCuenta(p: {
  clienteNombre: string;
  numeroCredito: string;
  venceAt: Date;
  enlace: string;
}): string {
  const nombre = p.clienteNombre.replace(/\s+/g, " ").trim();
  return [
    `Hola ${nombre}, el estado de cuenta de tu crédito ${p.numeroCredito} para tu solicitud de cancelación ya está disponible.`,
    `Puedes verlo aquí (disponible hasta el ${formatearVencimiento(p.venceAt)}): ${p.enlace}`,
    "Si tienes alguna duda, no dudes en contactarnos.",
  ].join("\n\n");
}

export interface EnvioEstadoCuentaRespuesta {
  intentoId: string;
  documentoId: string;
  canal: "WHATSAPP";
  destinatarioTelefono: string;
  destinatarioFuente: FuenteTelefono;
  estado: EstadoEnvio;
  proveedor: string | null;
  proveedorMensajeId: string | null;
  errorResumen: string | null;
  /** true solo si se sabe que el mensaje NO salió: se puede reintentar con un intentoId nuevo. */
  reintentable: boolean;
  /** true si la respuesta es de un intento ya registrado (mismo intentoId). */
  repetido: boolean;
  /** true si el CRM lo desvió a un número de prueba (TEST_MESSAGE). */
  modoPrueba: boolean;
  /** Hasta cuándo abre el enlace enviado (solo en la respuesta del envío nuevo). */
  enlaceVenceAt: string | null;
}

const aRespuesta = (
  e: EnvioEstadoCuenta,
  repetido: boolean,
  enlaceVenceAt: Date | null = null
): EnvioEstadoCuentaRespuesta => ({
  intentoId: e.id,
  documentoId: e.documentoId,
  canal: e.canal,
  destinatarioTelefono: e.destinatarioTelefono,
  destinatarioFuente: e.destinatarioFuente,
  estado: e.estado,
  proveedor: e.proveedor,
  proveedorMensajeId: e.proveedorMensajeId,
  errorResumen: e.errorResumen,
  reintentable: e.estado === "ERROR" && (e.errorResumen ?? "").startsWith(PREFIJO_NO_ENVIADO),
  repetido,
  modoPrueba: (e.proveedor ?? "").endsWith(SUFIJO_PRUEBA),
  enlaceVenceAt: enlaceVenceAt ? enlaceVenceAt.toISOString() : null,
});

function respuestaDeExistente(
  existente: EnvioEstadoCuenta,
  documentoId: string
): Resultado<EnvioEstadoCuentaRespuesta> {
  if (existente.documentoId !== documentoId) {
    return falla(409, "El intentoId ya se usó con otro documento.");
  }
  return { ok: true, data: aRespuesta(existente, true) };
}

export async function enviarEstadoCuenta(
  deps: EstadoCuentaCancelacionDeps,
  input: {
    creditoId: number;
    documentoId: string;
    usuarioId: number;
    destinatarioTelefono: string;
    intentoId: string;
  }
): Promise<Resultado<EnvioEstadoCuentaRespuesta>> {
  const base = deps.enlaceBaseUrl();
  if (!base) {
    return falla(503, "Falta configurar la dirección pública del enlace (ESTADO_CUENTA_ENLACE_BASE_URL).");
  }

  const doc = await deps.buscarDocumento(input.documentoId, input.creditoId);
  if (!doc) return falla(404, "Documento no encontrado para este crédito.");

  const existente = await deps.buscarEnvio(input.intentoId);
  if (existente) return respuestaDeExistente(existente, input.documentoId);

  // Solo se envía a un número que el CRM tenga registrado para este cliente:
  // el asesor no puede escribir uno a mano (se vuelve a consultar aquí, no se
  // confía en lo que diga el navegador).
  const pedidos = digitosTelefonoGT(input.destinatarioTelefono);
  let contactos: ContactoTelefono[];
  try {
    contactos = await deps.obtenerContactos(doc.numeroCreditoSifco);
  } catch (err) {
    console.error("[estadoCuentaCancelacion] Error consultando contactos en CRM:", err);
    // 424 y no 502: un 502/504 también lo da el proxy cuando un envío se corta
    // a medias (resultado incierto). Este caso es seguro: aún no se envió nada.
    return falla(424, "No se pudieron verificar los teléfonos del cliente en el CRM. No se envió nada; intenta de nuevo.");
  }
  const contacto = pedidos ? contactos.find((c) => digitosTelefonoGT(c.telefono) === pedidos) : undefined;
  if (!contacto) {
    return falla(422, "El número no está entre los teléfonos registrados del cliente en el CRM.");
  }

  const envio: EnvioEstadoCuenta = {
    id: input.intentoId,
    documentoId: doc.id,
    enlaceId: null,
    canal: "WHATSAPP",
    destinatarioTelefono: contacto.telefono,
    destinatarioFuente: contacto.fuente,
    solicitadoPorId: input.usuarioId,
    estado: "EN_PROCESO",
    proveedor: null,
    proveedorMensajeId: null,
    errorResumen: null,
    solicitadoAt: null,
    finalizadoAt: null,
  };
  const creado = await deps.crearEnvio(envio);
  if (!creado) {
    // Otro request con el mismo intentoId ganó la carrera: devolver lo suyo.
    const ganador = await deps.buscarEnvio(input.intentoId);
    if (!ganador) return falla(409, "Intento de envío en conflicto; intenta de nuevo.");
    return respuestaDeExistente(ganador, input.documentoId);
  }

  const cerrar = async (
    cambios: Pick<EnvioEstadoCuenta, "estado" | "proveedor" | "proveedorMensajeId" | "errorResumen" | "enlaceId">,
    venceAt: Date | null = null
  ): Promise<Resultado<EnvioEstadoCuentaRespuesta>> => {
    const final = { ...cambios, finalizadoAt: deps.ahora() };
    try {
      await deps.finalizarEnvio(envio.id, final);
    } catch (err) {
      console.error("[estadoCuentaCancelacion] No se pudo registrar el resultado del envío:", envio.id, cambios.estado, err);
      return falla(500, "No se pudo registrar el resultado del envío. Revisa manualmente antes de reintentar.");
    }
    return { ok: true, data: aRespuesta({ ...envio, ...final }, false, venceAt) };
  };

  // El enlace abre el PDF GUARDADO: se verifica antes de mandarlo.
  const pdf = await leerPdfVerificado(deps, doc);
  if (!pdf.ok) {
    return cerrar({
      estado: "ERROR",
      proveedor: null,
      proveedorMensajeId: null,
      errorResumen: `${PREFIJO_NO_ENVIADO}${pdf.message}`,
      enlaceId: null,
    });
  }

  const creadoAt = deps.ahora();
  const codigo = deps.generarCodigo();
  const enlace: EnlaceEstadoCuenta = {
    id: deps.nuevoId(),
    documentoId: doc.id,
    codigoSha256: sha256Texto(codigo),
    creadoPorId: input.usuarioId,
    creadoAt,
    venceAt: new Date(creadoAt.getTime() + deps.vigenciaEnlaceDias() * 24 * 60 * 60 * 1000),
    revocadoAt: null,
    aperturas: 0,
  };
  try {
    await deps.crearEnlace(enlace);
  } catch (err) {
    console.error("[estadoCuentaCancelacion] Error creando el enlace:", err);
    return cerrar({
      estado: "ERROR",
      proveedor: null,
      proveedorMensajeId: null,
      errorResumen: `${PREFIJO_NO_ENVIADO}No se pudo crear el enlace.`,
      enlaceId: null,
    });
  }

  const mensaje = mensajeWhatsappEstadoCuenta({
    clienteNombre: doc.clienteNombre,
    numeroCredito: doc.numeroCreditoSifco,
    venceAt: enlace.venceAt,
    enlace: urlEnlaceEstadoCuenta(base, codigo),
  });

  let res: ResultadoProveedorWhatsapp;
  try {
    res = await deps.enviarWhatsapp({
      intentoId: envio.id,
      telefono: contacto.telefono,
      mensaje,
      numeroCreditoSifco: doc.numeroCreditoSifco,
    });
  } catch (err) {
    res = { resultado: "INCIERTO", proveedor: PROVEEDOR_WHATSAPP, error: resumenError(err) };
  }

  const proveedor = `${res.proveedor || PROVEEDOR_WHATSAPP}${res.modoPrueba ? SUFIJO_PRUEBA : ""}`.slice(0, 40);
  if (res.resultado === "ENVIADO") {
    return cerrar(
      { estado: "ENVIADO", proveedor, proveedorMensajeId: res.mensajeId, errorResumen: null, enlaceId: enlace.id },
      enlace.venceAt
    );
  }
  return cerrar(
    {
      estado: "ERROR",
      proveedor,
      proveedorMensajeId: null,
      errorResumen: `${res.resultado === "NO_ENVIADO" ? PREFIJO_NO_ENVIADO : PREFIJO_INCIERTO}${res.error.slice(0, 500)}`,
      enlaceId: enlace.id,
    },
    enlace.venceAt
  );
}

// ----------------------------------------------------------------
// Enlace público (/ec/:codigo) — sin sesión
// ----------------------------------------------------------------

/** 16 bytes en base64url = 22 caracteres. */
export const FORMATO_CODIGO_ENLACE = /^[A-Za-z0-9_-]{22}$/;

export type AperturaEnlace =
  | { ok: true; bytes: Buffer; filename: string }
  | { ok: false; status: 404 | 410 | 500 | 502; motivo: "NO_EXISTE" | "VENCIDO" | "ANULADO" | "ERROR" };

export async function abrirEnlaceEstadoCuenta(
  deps: EstadoCuentaCancelacionDeps,
  input: { codigo: string }
): Promise<AperturaEnlace> {
  if (!FORMATO_CODIGO_ENLACE.test(input.codigo)) return { ok: false, status: 404, motivo: "NO_EXISTE" };

  const encontrado = await deps.buscarEnlacePorHash(sha256Texto(input.codigo));
  if (!encontrado) return { ok: false, status: 404, motivo: "NO_EXISTE" };

  const { enlace, documento } = encontrado;
  const ahora = deps.ahora();
  if (enlace.revocadoAt) return { ok: false, status: 410, motivo: "ANULADO" };
  if (enlace.venceAt.getTime() <= ahora.getTime()) return { ok: false, status: 410, motivo: "VENCIDO" };

  const pdf = await leerPdfVerificado(deps, documento);
  if (!pdf.ok) return { ok: false, status: pdf.status === 502 ? 502 : 500, motivo: "ERROR" };

  try {
    await deps.registrarApertura(enlace.id, ahora);
  } catch (err) {
    // Contar la apertura es un extra: no le niega el documento al cliente.
    console.error("[estadoCuentaCancelacion] No se pudo registrar la apertura:", enlace.id, err);
  }
  return { ok: true, bytes: pdf.data, filename: nombreArchivoEstadoCuenta(documento) };
}
