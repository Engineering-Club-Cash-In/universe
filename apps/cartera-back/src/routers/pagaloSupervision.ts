import { Elysia } from "elysia";
import {
  buildPagaloSupervisionPDF,
  buildPagaloSupervisionWorkbook,
  nombreArchivoExport,
  traerDatasetCompletoPagalo,
} from "../controllers/pagaloSupervisionReporte";
import { getPagaloSupervision, type PagaloSupervisionParams } from "../services/crm.service";
import { authMiddleware } from "./midleware";

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// Espejo de PAGALO_PAYMENT_GROUP_STATUSES / PAGALO_PAYMENT_LINK_STATUSES
// (crm/apps/server/src/db/schema/pagalo-payments.ts), que a su vez reflejan el
// CHECK de la tabla. Copiados y no importados: el estado Págalo vive en la base
// del CRM, no en la de cartera, y montar un paquete compartido para diez
// strings estables obliga a tocar los Dockerfile de ambos servicios (listan los
// packages uno por uno) — se rompería en despliegue, no en local.
//
// AL AGREGAR UN ESTADO NUEVO, tocar los tres lados:
//   1. crm/apps/server/src/db/schema/pagalo-payments.ts  (fuente de verdad)
//   2. acá                                                (si no, se rechaza con 400)
//   3. carteraFront .../pagaloSupervision.helpers.ts      (si no, no aparece su chip;
//      ojo: esa lista excluye DRAFT a propósito, no es copia literal)
const ESTADOS_GRUPO_VALIDOS = [
  "DRAFT", "LINKS_PENDING", "PENDING_PAYMENT", "PARTIALLY_PAID", "READY_TO_APPLY",
  "APPLYING", "COMPLETED", "APPLICATION_FAILED", "REVIEW_REQUIRED", "CANCELLED",
];
const ESTADOS_LINK_VALIDOS = [
  "CREATING", "ACTIVE", "PAID", "REJECTED", "CANCELLED", "EXPIRED", "REPLACED", "ERROR",
];

function fechaValida(s: string): boolean {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function puedeVerSupervisionPagalo(user: { role?: string } | undefined): boolean {
  return user?.role === "ADMIN" || user?.role === "CONTA";
}

/** Devuelve el mensaje de error si algún filtro viene mal, o null si está OK. */
function validarFiltros(query: Record<string, string>): string | null {
  for (const campo of ["fechaDesde", "fechaHasta"] as const) {
    const valor = query[campo];
    if (!valor) continue;
    if (!FECHA_REGEX.test(valor)) return `Formato de ${campo} inválido. Use YYYY-MM-DD`;
    if (!fechaValida(valor)) return `${campo} inválida. Verifique que el día exista en el mes.`;
  }
  if (query.fechaDesde && query.fechaHasta && query.fechaDesde > query.fechaHasta) {
    return "fechaDesde debe ser menor o igual a fechaHasta";
  }
  if (
    query.sortBy &&
    !["totalAmount", "createdAt", "linksAmountCapital", "linksAmountMora"].includes(query.sortBy)
  ) {
    return "sortBy inválido. Valores: totalAmount, createdAt, linksAmountCapital, linksAmountMora";
  }
  if (query.sortDir && !["asc", "desc"].includes(query.sortDir)) {
    return "sortDir inválido. Valores: asc, desc";
  }
  for (const [campo, validos] of [
    ["estados", ESTADOS_GRUPO_VALIDOS],
    ["problemasLink", ESTADOS_LINK_VALIDOS],
  ] as const) {
    const csv = query[campo];
    if (!csv) continue;
    const invalido = csv
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
      .find((v) => !validos.includes(v));
    if (invalido) return `${campo} contiene un valor inválido: ${invalido}`;
  }
  // Sin esto, un valor no numérico llegaba al CRM, volvía como 400 y se
  // traducía en un 502 "no se pudo consultar" que no dice qué estaba mal.
  for (const campo of ["antiguedadMinDias", "limit", "offset"] as const) {
    const valor = query[campo];
    if (valor === undefined || valor === "") continue;
    const n = Number(valor);
    if (!Number.isInteger(n) || n < (campo === "offset" ? 0 : 1)) {
      return `${campo} debe ser un entero ${campo === "offset" ? "mayor o igual a 0" : "positivo"}`;
    }
  }
  return null;
}

function armarFiltros(query: Record<string, string>): PagaloSupervisionParams {
  return {
    estados: query.estados || undefined,
    problemasLink: query.problemasLink || undefined,
    soloHuerfanos: query.soloHuerfanos === "true" || undefined,
    antiguedadMinDias: query.antiguedadMinDias ? Number(query.antiguedadMinDias) : undefined,
    numeroSifco: query.numeroSifco || undefined,
    fechaDesde: query.fechaDesde || undefined,
    fechaHasta: query.fechaHasta || undefined,
    sortBy:
      (query.sortBy as "totalAmount" | "createdAt" | "linksAmountCapital" | "linksAmountMora") ||
      undefined,
    sortDir: (query.sortDir as "asc" | "desc") || undefined,
    // Sin chips de estado activos la bandeja muestra todo; el front manda
    // soloProblematicos=true solo cuando el usuario acotó por estado.
    soloProblematicos: query.soloProblematicos === "true",
    // Ausente (undefined) = sin recorte; presente (aunque "") = acotar exacto.
    // No usar `|| undefined`: convertiría un scope vacío legítimo en "sin scope".
    sifcosPermitidos: query.sifcosPermitidos,
  };
}

export const pagaloSupervisionRouter = new Elysia().use(authMiddleware)

  .get("/pagalo/supervision", async ({ query, set, user }) => {
    if (!puedeVerSupervisionPagalo(user)) {
      set.status = 403;
      return { error: "No autorizado" };
    }

    const q = query as Record<string, string>;
    const errorFiltro = validarFiltros(q);
    if (errorFiltro) {
      set.status = 400;
      return { error: errorFiltro };
    }

    try {
      return await getPagaloSupervision({
        ...armarFiltros(q),
        limit: q.limit ? Number(q.limit) : undefined,
        offset: q.offset ? Number(q.offset) : undefined,
      });
    } catch (error) {
      console.error("[/pagalo/supervision]", error);
      set.status = 502;
      return { error: "No se pudo consultar la supervisión Págalo" };
    }
  })

  .get("/pagalo/supervision/excel", async ({ query, set, user }) => {
    if (!puedeVerSupervisionPagalo(user)) {
      set.status = 403;
      return { error: "No autorizado" };
    }

    const q = query as Record<string, string>;
    const errorFiltro = validarFiltros(q);
    if (errorFiltro) {
      set.status = 400;
      return { error: errorFiltro };
    }

    try {
      const { filas, total, truncado, resumenKpis } = await traerDatasetCompletoPagalo(armarFiltros(q));
      const buf = await buildPagaloSupervisionWorkbook(filas, resumenKpis);
      return new Response(new Uint8Array(buf), {
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": `attachment; filename="${nombreArchivoExport("xlsx", truncado)}"`,
          // El archivo viaja como blob, así que la señal de "esto salió
          // incompleto" no cabe en el cuerpo: va por header para que el front
          // pueda avisarle al usuario que acote el rango.
          "x-export-truncado": String(truncado),
          "x-export-total": String(total),
          "x-export-cantidad": String(filas.length),
          "access-control-expose-headers":
            "x-export-truncado, x-export-total, x-export-cantidad",
        },
      });
    } catch (error) {
      console.error("[/pagalo/supervision/excel]", error);
      set.status = 500;
      return { error: "Error generando el reporte de supervisión Págalo" };
    }
  })

  .get("/pagalo/supervision/pdf", async ({ query, set, user }) => {
    if (!puedeVerSupervisionPagalo(user)) {
      set.status = 403;
      return { error: "No autorizado" };
    }

    const q = query as Record<string, string>;
    const errorFiltro = validarFiltros(q);
    if (errorFiltro) {
      set.status = 400;
      return { error: errorFiltro };
    }

    try {
      const { filas, total, truncado, resumenKpis } = await traerDatasetCompletoPagalo(armarFiltros(q));
      const buf = await buildPagaloSupervisionPDF(filas, { total, truncado, resumenKpis });
      return new Response(new Uint8Array(buf), {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `attachment; filename="${nombreArchivoExport("pdf", truncado)}"`,
          "x-export-truncado": String(truncado),
          "x-export-total": String(total),
          "x-export-cantidad": String(filas.length),
          "access-control-expose-headers":
            "x-export-truncado, x-export-total, x-export-cantidad",
        },
      });
    } catch (error) {
      console.error("[/pagalo/supervision/pdf]", error);
      set.status = 500;
      return { error: "Error generando el reporte de supervisión Págalo" };
    }
  });
