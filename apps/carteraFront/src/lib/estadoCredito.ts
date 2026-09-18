import { STATUS_EXCLUIDOS_MORA } from "./cuotaAtrasada";

/**
 * Colores de las etiquetas de `creditos."statusCredit"`.
 *
 * Definición única: el mismo estado se veía de dos colores distintos según la
 * pantalla (Cierre de Cartera vs. Gestión de Moras). Incluye el color de borde
 * para las pantallas que dibujan la etiqueta con `border`; donde no se usa
 * `border`, la clase de color de borde es inerte.
 */
export const ESTADO_CREDITO_STYLE: Record<string, string> = {
  ACTIVO: "bg-green-100 text-green-700 border-green-200",
  MOROSO: "bg-red-100 text-red-700 border-red-200",
  EN_CONVENIO: "bg-amber-100 text-amber-700 border-amber-200",
  CAIDO: "bg-orange-100 text-orange-700 border-orange-200",
  INCOBRABLE: "bg-rose-100 text-rose-700 border-rose-200",
  PENDIENTE_CANCELACION: "bg-blue-100 text-blue-700 border-blue-200",
  CANCELADO: "bg-gray-100 text-gray-600 border-gray-200",
};

const ESTADO_CREDITO_STYLE_DEFECTO = "bg-gray-100 text-gray-600 border-gray-200";

export const estadoCreditoStyle = (estado?: string | null): string =>
  ESTADO_CREDITO_STYLE[estado ?? ""] ?? ESTADO_CREDITO_STYLE_DEFECTO;

/**
 * Estados de crédito donde el backend NO deja crear rubros (ni obligatorios).
 *
 * ESPEJO, no autoridad: la regla vive en el backend
 * (`STATUS_TERMINALES_RUBRO` en `apps/cartera-back/src/controllers/rubrosPolicy.ts`)
 * y ahí se aplica de verdad, devolviendo 409. Esta copia existe sólo para no
 * hacerle llenar al ADMIN un formulario condenado al rechazo. Si las dos listas
 * se desincronizan, manda el backend: un estado que acá falte simplemente
 * volverá a fallar al guardar, con el mensaje del servidor.
 *
 * Se DERIVA de `STATUS_EXCLUIDOS_MORA` con la misma resta que hace el backend,
 * en vez de escribir los cuatro estados a mano: el front ya tenía esa lista
 * para el criterio de cuotas en atraso, y dos copias de los mismos estados se
 * desincronizan en cuanto alguien agrega uno.
 *
 * La resta es `EN_CONVENIO`, y por la misma razón que en el backend: un crédito
 * en convenio no devenga mora nueva, pero sigue vivo y con gastos que Cartera
 * ya pagó, así que sí admite rubros OBLIGATORIOS. Lo mismo vale para `MOROSO`,
 * que ni siquiera está en la lista de origen. En los dos casos lo que se
 * bloquea son los rubros opcionales, y eso no se decide acá sino en
 * `creacionRubroBloqueada`, que necesita además el rol.
 */
export const STATUS_TERMINALES_RUBRO = STATUS_EXCLUIDOS_MORA.filter(
  (s) => s !== "EN_CONVENIO"
);

export const esEstadoTerminalRubro = (estado?: string | null): boolean =>
  STATUS_TERMINALES_RUBRO.includes(
    (estado ?? "") as (typeof STATUS_TERMINALES_RUBRO)[number]
  );

/**
 * Estados donde el backend sólo acepta rubros OBLIGATORIOS, que a su vez sólo
 * puede usar un ADMIN (403 para el resto). Espejo de las dos ramas de
 * `puedeCrearRubro` que miran el status.
 */
const STATUS_SOLO_RUBRO_OBLIGATORIO = ["MOROSO", "EN_CONVENIO"] as const;

/**
 * ¿Hay que apagar el "Agregar rubro"? Devuelve el motivo, o `null` si se puede.
 *
 * Dos negativas distintas, y la del estado terminal va primero porque ningún
 * rol la levanta:
 *
 *  - Estado terminal: no entra ningún rubro, sea quien sea el usuario.
 *  - MOROSO / EN_CONVENIO sin ser ADMIN: entran sólo los obligatorios, y el
 *    desplegable de creación se los filtra justamente a quien no es ADMIN. Sin
 *    este gate el asesor veía el formulario habilitado, elegía entre tipos que
 *    iban a dar 409 todos, lo llenaba y recién al guardar se enteraba.
 *
 * Al ADMIN NO se lo bloquea en esos dos estados: él sí tiene tipos obligatorios
 * disponibles y la operación es legítima.
 */
export const creacionRubroBloqueada = (
  estado?: string | null,
  rol?: string | null
): string | null => {
  if (esEstadoTerminalRubro(estado)) {
    return `No se pueden crear rubros: el crédito está ${estado}. Los rubros ya registrados se siguen consultando y editando.`;
  }
  if (
    rol !== "ADMIN" &&
    STATUS_SOLO_RUBRO_OBLIGATORIO.includes(
      (estado ?? "") as (typeof STATUS_SOLO_RUBRO_OBLIGATORIO)[number]
    )
  ) {
    return `El crédito está ${estado}: solo se le pueden crear rubros obligatorios, y esos únicamente los registra un administrador.`;
  }
  return null;
};
