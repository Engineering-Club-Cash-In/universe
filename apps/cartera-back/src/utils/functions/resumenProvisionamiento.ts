import type { ResultadoProvisionamientoCartera } from "../../services/portalProvisioning";
import { pareceSociedad } from "./provisionamientoPortal";

/**
 * El resumen que lee un humano, separado del job para poder probarlo sin base
 * de datos.
 */

export interface EntradaResumen {
  inversionistaId: number;
  nombre: string;
  motivo?: string | null;
  destinatarioReal?: string | null;
  usuarioEmail?: string | null;
}

export interface ResumenProvisionamiento {
  total: number;
  yaTenian: number;
  empresas: number;
  creadas: EntradaResumen[];
  /** Solo en dry-run: filas que serían provisionadas. */
  candidatas: EntradaResumen[];
  fallos: EntradaResumen[];
  sinCorreo: EntradaResumen[];
  sinNombre: EntradaResumen[];
  correosRedirigidos: EntradaResumen[];
  correosNoEnviados: EntradaResumen[];
  correoDistinto: EntradaResumen[];
  /**
   * Cuenta creada cuya contraseña NO se entregó. El peor desenlace, y el único
   * que no se arregla solo: la contraseña no se persiste ni se devuelve, y no
   * hay ruta de reenvío. Hay que resetearles el acceso a mano.
   */
  accesosPerdidos: EntradaResumen[];
  /**
   * Cuenta que quedó sin rol o sin DPI escrito. Importa más de lo que parece:
   * sin DPI, a esa persona solo se la encuentra por correo, y en cuanto alguien
   * le corrige el correo en cartera la corrida siguiente le crea OTRA cuenta.
   */
  cuentasSinIdentidad: EntradaResumen[];
  dudosas: EntradaResumen[];
  hayQueReportar: boolean;
}

const entrada = (
  r: ResultadoProvisionamientoCartera,
  nombres: Map<number, string>,
): EntradaResumen => ({
  inversionistaId: r.inversionistaId,
  nombre: nombres.get(r.inversionistaId) ?? `#${r.inversionistaId}`,
  motivo: r.motivo,
  destinatarioReal: r.correo.destinatarioReal,
  usuarioEmail: r.usuarioEmail,
});

/**
 * Convierte los resultados en el resumen que lee un humano.
 *
 * `hayQueReportar` NO se dispara con los "sin correo". Son seis filas crónicas:
 * si dispararan el resumen, llegaría un correo idéntico todos los días para
 * siempre y a la semana nadie lo volvería a abrir. Se listan cuando el resumen
 * sale por otra razón, así que nunca quedan ocultos, pero lo que hace sonar la
 * campana es siempre algo que CAMBIÓ o algo que FALLÓ.
 */
export const resumirProvisionamiento = (
  resultados: ResultadoProvisionamientoCartera[],
  nombres: Map<number, string>,
): ResumenProvisionamiento => {
  const resumen: ResumenProvisionamiento = {
    total: resultados.length,
    yaTenian: 0,
    empresas: 0,
    creadas: [],
    candidatas: [],
    fallos: [],
    sinCorreo: [],
    sinNombre: [],
    correosRedirigidos: [],
    correosNoEnviados: [],
    correoDistinto: [],
    accesosPerdidos: [],
    cuentasSinIdentidad: [],
    dudosas: [],
    hayQueReportar: false,
  };

  for (const r of resultados) {
    const e = entrada(r, nombres);

    if (r.estado === "creada") {
      resumen.creadas.push(e);
      // Solo se marca dudosa la sociedad que acaba de recibir cuenta PROPIA.
      // Las que ya la tenían son el estado normal del sistema desde hace
      // tiempo; reportarlas cada día sería ruido, no trabajo pendiente.
      if (pareceSociedad(e.nombre)) resumen.dudosas.push(e);
    } else if (r.estado === "candidata") {
      // El dry-run no sale a la red: no sabe quién ya tiene cuenta. Contarlas
      // como "ya tenían" sería inventar un dato que no se midió.
      resumen.candidatas.push(e);
    } else if (r.estado === "ya_tenia" || r.estado === "avisada") {
      resumen.yaTenian += 1;
    } else if (r.estado === "fallo") {
      resumen.fallos.push(e);
    } else if (r.estado === "omitida") {
      if (r.motivo === "sin_correo") resumen.sinCorreo.push(e);
      else if (r.motivo === "sin_nombre") resumen.sinNombre.push(e);
      else resumen.empresas += 1;
    }

    if (r.advertencias.includes("correo_redirigido_por_modo_no_prod")) {
      resumen.correosRedirigidos.push(e);
    }
    if (r.advertencias.includes("correo_no_enviado")) {
      resumen.correosNoEnviados.push(e);
    }
    if (r.advertencias.includes("correo_de_cartera_distinto_al_de_la_cuenta")) {
      resumen.correoDistinto.push(e);
    }
    if (r.advertencias.includes("cuenta_creada_sin_contrasena_entregada")) {
      resumen.accesosPerdidos.push(e);
    }
    if (
      r.advertencias.includes("cuenta_creada_sin_rol_ni_dpi") ||
      r.advertencias.includes("rol_no_promovido")
    ) {
      resumen.cuentasSinIdentidad.push(e);
    }
  }

  resumen.hayQueReportar =
    resumen.creadas.length > 0 ||
    resumen.fallos.length > 0 ||
    resumen.correosRedirigidos.length > 0 ||
    resumen.correosNoEnviados.length > 0 ||
    resumen.correoDistinto.length > 0 ||
    resumen.accesosPerdidos.length > 0 ||
    resumen.cuentasSinIdentidad.length > 0 ||
    resumen.sinNombre.length > 0;

  return resumen;
};

/**
 * Escapa el texto que viene de la base antes de meterlo en el HTML del correo.
 *
 * `nombre` y `motivo` salen de `cartera.inversionistas` y de mensajes de error:
 * texto libre capturado a mano. Sin escapar, un nombre con `<` rompe el
 * resumen, y uno con etiquetas mete markup ajeno en un correo interno que leen
 * las personas que tienen las contraseñas de todos.
 */
const escaparHtml = (valor: string): string =>
  valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const lista = (titulo: string, filas: EntradaResumen[]): string => {
  if (filas.length === 0) return "";
  const items = filas
    .map((f) => {
      const nombre = escaparHtml(f.nombre);
      const motivo = f.motivo ? ` <em>(${escaparHtml(f.motivo)})</em>` : "";
      return `<li>#${f.inversionistaId} — ${nombre}${motivo}</li>`;
    })
    .join("");
  return `<h3>${escaparHtml(titulo)} (${filas.length})</h3><ul>${items}</ul>`;
};

export const construirCorreoResumen = (
  resumen: ResumenProvisionamiento,
): { subject: string; html: string } => {
  const redirigido = resumen.correosRedirigidos.length > 0;
  const destino = resumen.correosRedirigidos[0]?.destinatarioReal;

  // El aviso va ARRIBA de todo y en el asunto: si los correos se están
  // desviando, ese es el dato más importante del mensaje. Este mismo resumen
  // llegó desviado a la misma bandeja, así que quien lo lee es justo quien
  // tiene las contraseñas de todos.
  const banner = redirigido
    ? `<p style="background:#fee;border:2px solid #c00;padding:12px">
         <strong>⚠️ MODO NO-PROD:</strong> los correos de acceso NO llegaron a
         sus destinatarios: se desviaron todos a <strong>${destino}</strong>.
         Las cuentas SÍ quedaron creadas, así que sus dueños no pueden entrar y
         no lo saben. Hay que verificar <code>SERVER=PROD</code> y reenviarles
         la contraseña.
       </p>`
    : "";

  // El acceso perdido manda sobre todo lo demás en el asunto: es lo único que
  // no se puede ver mañana. A partir de la corrida siguiente esa cuenta se
  // cuenta como "ya tenía acceso", indistinguible de una sana.
  const perdidos = resumen.accesosPerdidos.length;

  const avisoPerdidos = perdidos
    ? `<p style="background:#fee;border:2px solid #c00;padding:12px">
         <strong>⚠️ ${perdidos} cuenta(s) creada(s) SIN entregar la contraseña.</strong>
         Sus dueños no pueden entrar y no lo saben. La contraseña no se guarda en
         ningún lado, así que hay que resetearles el acceso A MANO. Este aviso
         sale UNA sola vez: desde mañana esas cuentas se cuentan como "ya tenían
         acceso".
       </p>`
    : "";

  const subject = perdidos
    ? `⚠️ Portal: ${perdidos} cuenta(s) creada(s) SIN contraseña entregada`
    : redirigido
      ? "⚠️ Portal: cuentas creadas con los correos DESVIADOS"
      : "Portal del Inversionista: resumen de accesos";

  const html = `
    ${avisoPerdidos}
    ${banner}
    <p>Revisados ${resumen.total} inversionistas: ${resumen.yaTenian} ya tenían
       acceso, ${resumen.empresas} son empresas (entran con su representante).</p>
    ${lista("Serían provisionadas (corrida en seco)", resumen.candidatas)}
    ${lista("Cuentas creadas", resumen.creadas)}
    ${lista("Cuenta creada pero SIN contraseña entregada (resetear a mano)", resumen.accesosPerdidos)}
    ${lista("Cuenta creada sin rol o sin DPI (arreglar o mañana se duplica)", resumen.cuentasSinIdentidad)}
    ${lista("No se pudo dar acceso", resumen.fallos)}
    ${lista("El correo no salió", resumen.correosNoEnviados)}
    ${lista("Correo de cartera distinto al de la cuenta (revisar a mano)", resumen.correoDistinto)}
    ${lista("Parecen sociedades y recibieron cuenta propia: falta capturarles el representante legal", resumen.dudosas)}
    ${lista("Sin correo en cartera: no pueden tener acceso", resumen.sinCorreo)}
    ${lista("Sin nombre en cartera", resumen.sinNombre)}
  `;

  return { subject, html };
};

