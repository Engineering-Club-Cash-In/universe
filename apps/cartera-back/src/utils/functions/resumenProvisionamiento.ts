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
  fallos: EntradaResumen[];
  sinCorreo: EntradaResumen[];
  sinNombre: EntradaResumen[];
  correosRedirigidos: EntradaResumen[];
  correosNoEnviados: EntradaResumen[];
  correoDistinto: EntradaResumen[];
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
    fallos: [],
    sinCorreo: [],
    sinNombre: [],
    correosRedirigidos: [],
    correosNoEnviados: [],
    correoDistinto: [],
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
  }

  resumen.hayQueReportar =
    resumen.creadas.length > 0 ||
    resumen.fallos.length > 0 ||
    resumen.correosRedirigidos.length > 0 ||
    resumen.correosNoEnviados.length > 0 ||
    resumen.correoDistinto.length > 0 ||
    resumen.sinNombre.length > 0;

  return resumen;
};

const lista = (titulo: string, filas: EntradaResumen[]): string => {
  if (filas.length === 0) return "";
  const items = filas
    .map(
      (f) =>
        `<li>#${f.inversionistaId} — ${f.nombre}${f.motivo ? ` <em>(${f.motivo})</em>` : ""}</li>`,
    )
    .join("");
  return `<h3>${titulo} (${filas.length})</h3><ul>${items}</ul>`;
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

  const subject = redirigido
    ? "⚠️ Portal: cuentas creadas con los correos DESVIADOS"
    : "Portal del Inversionista: resumen de accesos";

  const html = `
    ${banner}
    <p>Revisados ${resumen.total} inversionistas: ${resumen.yaTenian} ya tenían
       acceso, ${resumen.empresas} son empresas (entran con su representante).</p>
    ${lista("Cuentas creadas", resumen.creadas)}
    ${lista("No se pudo dar acceso", resumen.fallos)}
    ${lista("El correo no salió", resumen.correosNoEnviados)}
    ${lista("Correo de cartera distinto al de la cuenta (revisar a mano)", resumen.correoDistinto)}
    ${lista("Parecen sociedades y recibieron cuenta propia: falta capturarles el representante legal", resumen.dudosas)}
    ${lista("Sin correo en cartera: no pueden tener acceso", resumen.sinCorreo)}
    ${lista("Sin nombre en cartera", resumen.sinNombre)}
  `;

  return { subject, html };
};

