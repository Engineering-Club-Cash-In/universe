import { inArray } from "drizzle-orm";
import { db } from "../database/index";
import { inversionistas } from "../database/db/schema";
import {
  provisionarInversionista,
  type ResultadoProvisionamientoCartera,
} from "../services/portalProvisioning";
import { buscarRepresentanteEnCartera } from "../utils/functions/buscarRepresentante";
import { normalizeEmail } from "../utils/functions/email";

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

/**
 * SE APRUEBA UN CORREO, NO UN ID.
 *
 * El único control real de este botón es el vistazo humano de arriba: el
 * diálogo del CRM le enseña a una persona EL CORREO al que va a caer la
 * contraseña y ella responde por él. Pero hasta ahora el clic mandaba solo el
 * `inversionista_id`, y cartera volvía a LEER la tabla para saber a dónde
 * escribir. O sea que lo aprobado y lo usado eran dos lecturas distintas de una
 * fila que se puede reescribir entre una y otra, y quien aprueba no tiene forma
 * de notarlo: el diálogo ya está pintado.
 *
 * La ventana no es teórica ni hace falta ganarle una carrera de milisegundos:
 * dura lo que la persona tarde en leer el diálogo y decidir. Y quien puede
 * moverla NO es quien aprueba — `editarInversionista` del CRM lo alcanzan once
 * familias de rol, este botón solo cuatro—, así que el atacante y el aprobador
 * son áreas distintas. Sumado al upsert legacy por DPI que REESCRIBE el correo
 * de una fila existente (investor.ts:672-678), envenenar el destino de una
 * contraseña ya aprobada no pedía más que capturar un correo en el momento
 * justo.
 *
 * Así que el cuerpo trae el correo que se APROBÓ y aquí se revalida contra la
 * fila antes de provisionar. Si ya no coincide NO SE PROVISIONA NADA: se
 * devuelve `correo_aprobado_no_coincide` y quien apretó vuelve a mirar. No se
 * provisiona "al correo aprobado" ignorando la fila —eso convertiría el cuerpo
 * de la petición en la fuente de verdad del destinatario, que es un agujero más
 * grande que el que cierra—: la fila sigue mandando, el correo aprobado solo
 * tiene poder de VETO.
 *
 * La comparación se hace contra el MISMO objeto `fila` que después viaja a
 * `provisionarInversionista`, nunca contra una segunda lectura: si hubiera dos
 * lecturas volvería a existir la ventana, solo que más corta.
 *
 * POR QUÉ ES OPCIONAL
 * -------------------
 * Porque hay un camino donde no hay nada que aprobar: la EMPRESA. Su diálogo no
 * enseña ningún correo —la cuenta es del REPRESENTANTE, no de ella— así que no
 * puede mandar uno aprobado, y ese camino ya corta antes con
 * `es_empresa_el_acceso_es_del_representante` sin crear cuenta ni mandar
 * correo (portalProvisioning.ts, rama `soloAsegurarCuenta`). Exigirlo siempre
 * rompería el único caso que hoy está bien resuelto.
 *
 * Que sea opcional NO deja el agujero abierto: el que provisiona sin aprobación
 * sería un llamador que decide no mandar el campo, y el único llamador es el
 * diálogo del CRM. Lo que esto cierra es la carrera, no un cuerpo hostil —contra
 * un cuerpo hostil el candado sigue siendo ADMIN + no estar en el proxy—.
 */

/** El correo de la fila ya no es el que se aprobó. NO se provisionó nada. */
const MOTIVO_CORREO_CAMBIADO = "correo_aprobado_no_coincide";

/**
 * Un desenlace de "no pasó nada, y por esto". Mismo molde que usa
 * `portalProvisioning` para sus propios fallos: quien lee la respuesta no tiene
 * que distinguir de dónde salió cada resultado del arreglo.
 */
const fallo = (
  inversionistaId: number,
  motivo: string,
): ResultadoProvisionamientoCartera => ({
  inversionistaId,
  estado: "fallo",
  usuarioEmail: null,
  resueltoPor: null,
  correo: {
    enviado: false,
    plantilla: null,
    redirigido: false,
    destinatarioReal: null,
  },
  advertencias: [],
  motivo,
});

export const otorgarAccesoPortal = async ({
  body,
  user,
  set,
}: {
  body: { inversionista_ids?: unknown; correo_aprobado?: unknown };
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

  // El MISMO criterio con el que se guarda el correo (investor.ts:1253, y el
  // `.trim().toLowerCase()` de `decidirProvisionamiento`): recortar y minúsculas.
  // Se reusa `normalizeEmail` en vez de escribirlo otra vez a propósito — dos
  // definiciones del mismo normalizador es exactamente cómo aparece una
  // asimetría silenciosa, y comparar `Ana@Example.com` contra `ana@example.com`
  // daría un "cambió" falso que bloquearía a gente legítima.
  const correoAprobado = normalizeEmail(body?.correo_aprobado);

  // Mandar la llave vacía (`""`, espacios, `null` explícito junto a un string
  // que se quedó sin valor) NO es lo mismo que no mandarla: es un llamador roto.
  // Tratarlo como "no se aprobó nada" saltaría el control justo cuando el front
  // se equivoca, que es cuando más falta hace. Se rechaza en voz alta.
  const mandoLaLlave =
    body?.correo_aprobado !== undefined && body?.correo_aprobado !== null;

  if (mandoLaLlave && !correoAprobado) {
    set.status = 400;
    return {
      message: "El correo aprobado viene vacío",
      error: "correo_aprobado_invalido",
    };
  }

  // Un correo aprobado es de UN inversionista: quien confirmó vio UNA dirección.
  // Con varios ids el campo es ambiguo, y las dos salidas son malas: aplicarlo a
  // todos rechazaría a los que legítimamente tienen otro correo
  // (`inversionistas.email` no es UNIQUE ni NOT NULL en el schema, así que N
  // filas no comparten dirección por regla ninguna), y aplicarlo solo a uno
  // dejaría pasar a los otros N-1 SIN aprobación. Se rechaza la combinación
  // entera: es la única lectura que no inventa una aprobación que nadie dio.
  if (correoAprobado && ids.length > 1) {
    set.status = 400;
    return {
      message:
        "El correo aprobado es de un solo inversionista: mandá un id a la vez",
      error: "correo_aprobado_con_varios_inversionistas",
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
      resultados.push(fallo(id, "inversionista_no_encontrado"));
      continue;
    }

    // EL VETO. Va ANTES de provisionar y antes de cualquier otra decisión sobre
    // la fila: lo que está en juego es una contraseña saliendo hacia un buzón, y
    // el orden que falla cerrado es "primero comprobar, después actuar".
    //
    // `fila.email` es el MISMO valor que `decidirProvisionamiento` va a
    // normalizar y mandar a auth-google (mismo objeto, misma lectura), así que
    // esto compara contra el destinatario real y no contra un parecido.
    //
    // Una fila que se quedó SIN correo (`null`) tampoco coincide, y así debe ser:
    // se aprobó una dirección y ahora no hay ninguna. Ese es un cambio, no un
    // caso aparte.
    //
    // No se devuelve el correo de la fila en la respuesta: el motivo dice QUÉ
    // pasó, y a quién apunta ahora la fila se ve en la pantalla del CRM, que es
    // donde hay que ir a mirar de todas formas.
    if (correoAprobado && correoAprobado !== normalizeEmail(fila.email)) {
      resultados.push(fallo(id, MOTIVO_CORREO_CAMBIADO));
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
