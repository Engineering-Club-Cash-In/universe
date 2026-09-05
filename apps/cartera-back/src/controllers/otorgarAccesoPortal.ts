import { inArray } from "drizzle-orm";
import { db } from "../database/index";
import { inversionistas } from "../database/db/schema";
import {
  provisionarInversionista,
  type ResultadoProvisionamientoCartera,
} from "../services/portalProvisioning";
import { buscarRepresentanteEnCartera } from "../utils/functions/buscarRepresentante";

/**
 * Abre el acceso al portal de uno o varios inversionistas. Lo dispara UNA
 * PERSONA, nunca un cron.
 *
 * POR QUÉ EXISTE
 * --------------
 * La reconciliación diaria (provisionarCuentasPortal.ts) recorre la tabla
 * entera y no puede saber quién escribió cada fila: `cartera.inversionistas`
 * se escribe desde caminos que no prueban identidad —el registro del portal, y
 * `POST /api/cartera/investor`, cuyo `requireAuth` no mira el rol sobre un
 * Better Auth de sign-up abierto—. Mientras crear una cuenta signifique mandar
 * una contraseña por correo, esa decisión necesita a alguien que pueda mirar la
 * fila y decir "este correo no cuadra con este nombre". Aquí es donde ocurre.
 *
 * Y no basta con marcar en la fila quién la creó: el upsert legacy resuelve por
 * DPI y REESCRIBE el correo de una fila existente (investor.ts:672-678), así
 * que un atacante puede envenenar el correo de un inversionista REAL sin tocar
 * su procedencia. La fila queda legítima y apuntando a otro buzón. Contra eso
 * solo sirve un par de ojos.
 *
 * POR QUÉ ESTA RUTA ES DE BACK OFFICE
 * -----------------------------------
 * Dos candados, y el segundo es el que importa:
 *
 *  1. Exige `role === "ADMIN"` (misma línea que aseguradoras.ts:16).
 *  2. `auth-google` enumera UNA POR UNA las rutas de cartera que proxea
 *     (cartera.routes.ts). Esta no está en esa lista, así que no es alcanzable
 *     desde el portal ni con una sesión válida. El candado (1) no bastaría
 *     solo: todo lo que viene de auth-google entra a cartera con el mismo
 *     token de servicio ADMIN. NO agregar esta ruta a ese proxy.
 */
export const otorgarAccesoPortal = async ({
  body,
  user,
  set,
}: {
  body: { inversionista_ids?: unknown };
  user?: { role?: string };
  set: { status?: number };
}) => {
  if (user?.role !== "ADMIN") {
    set.status = 403;
    return {
      message: "Solo un ADMIN puede abrir accesos al portal",
      error: "forbidden",
    };
  }

  const ids = Array.isArray(body?.inversionista_ids)
    ? [...new Set(
        (body.inversionista_ids as unknown[])
          .map((v) => Number(v))
          .filter((n) => Number.isInteger(n) && n > 0),
      )]
    : [];

  if (ids.length === 0) {
    set.status = 400;
    return {
      message: "Hay que indicar al menos un inversionista_id",
      error: "sin_inversionistas",
    };
  }

  const filas = await db
    .select({
      inversionista_id: inversionistas.inversionista_id,
      nombre: inversionistas.nombre,
      email: inversionistas.email,
      dpi: inversionistas.dpi,
      dpi_rep_legal: inversionistas.dpi_rep_legal,
    })
    .from(inversionistas)
    .where(inArray(inversionistas.inversionista_id, ids));

  const porId = new Map(filas.map((f) => [f.inversionista_id, f]));

  const resultados: ResultadoProvisionamientoCartera[] = [];

  // Secuencial: son unos pocos ids por click y en paralelo dispararíamos varios
  // signUp simultáneos contra Better Auth.
  for (const id of ids) {
    const fila = porId.get(id);

    if (!fila) {
      // Un id que no existe se NOMBRA. Callarlo dejaría a quien apretó el botón
      // creyendo que esa persona quedó con acceso.
      resultados.push({
        inversionistaId: id,
        estado: "fallo",
        usuarioEmail: null,
        resueltoPor: null,
        correo: { enviado: false, plantilla: null, redirigido: false, destinatarioReal: null },
        advertencias: [],
        motivo: "inversionista_no_encontrado",
      });
      continue;
    }

    // `soloAsegurarCuenta`: el aviso de "ahora representas a X" es del camino de
    // alta, que pasa una sola vez. Desde aquí se le repetiría al representante
    // cada vez que alguien toque el botón.
    resultados.push(
      await provisionarInversionista(fila, {
        soloAsegurarCuenta: true,
        buscarRepresentante: buscarRepresentanteEnCartera,
      }),
    );
  }

  return {
    message: `Procesados ${resultados.length} inversionista(s)`,
    resultados,
  };
};
