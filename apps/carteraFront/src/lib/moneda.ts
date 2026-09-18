/**
 * Formato de quetzales de la app: `Q 1,234.56`.
 *
 * Definición única — vivía copiada en Latefee.tsx, ModalHistorialMora.tsx y
 * MoraHistorial.tsx, con el riesgo de que una copia cambiara de decimales y las
 * otras no.
 */
export const fmtQ = (v: unknown): string =>
  `Q ${Number(v ?? 0).toLocaleString("es-GT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/**
 * Un monto en centavos enteros, o `null` si el valor no es un número.
 *
 * Dos trampas, las dos con consecuencias en pantalla:
 *
 * 1. `Number(v) * 100` arrastra el error del producto binario: `1.005 * 100` no
 *    da 100.5 sino 100.49999999999999, y `Math.round` lo baja a 100 — un
 *    centavo menos por ítem contra el `Big` del backend. `toPrecision(15)`
 *    recorta los dígitos basura (un double conserva ~15-17 significativos)
 *    antes de redondear, así que el `.xx5` vuelve a ser un empate real.
 * 2. El empate se rompe ALEJÁNDOSE del cero, que es el `ROUND_HALF_UP` por
 *    defecto de `big.js`. `Math.round` sube siempre (`-100.5 → -100`) y
 *    discreparía con el backend en cada monto negativo.
 */
const aCentavos = (v: unknown): number | null => {
  /**
   * Si viene como TEXTO decimal se parsea directo a centavos, sin pasar por un
   * `number` intermedio.
   *
   * El camino numérico de abajo usa `toPrecision(15)` para recortar los dígitos
   * basura del double, y con más de 15 significativos eso recorta centavos
   * REALES: `"12345678901234.56"` salía `12345678901234.6`, mientras el `Big`
   * del backend los conserva. La columna es `numeric(18,2)`, así que el caso
   * cabe en la base y los dos lados discrepaban.
   *
   * Los montos que llegan del backend son justamente strings (`"500.00"`), así
   * que esta rama es la que corre casi siempre.
   *
   * ⚠️ El techo que queda NO es del parseo sino del `number`: los centavos son
   * exactos hasta `Number.MAX_SAFE_INTEGER`, o sea ~Q90,071,992,547,409. Más
   * arriba el valor ya no cabe en un double y ningún parseo lo arregla — haría
   * falta una librería decimal en el front. `numeric(18,2)` admite más que eso,
   * así que el límite se documenta en vez de taparse.
   */
  if (typeof v === "string") {
    const m = /^\s*([+-]?)(\d*)(?:\.(\d*))?\s*$/.exec(v);
    if (m && (m[2] || m[3])) {
      const signo = m[1] === "-" ? -1 : 1;
      const enteros = m[2] || "0";
      const dec = (m[3] ?? "").padEnd(3, "0");
      // Se toman dos decimales y el tercero decide el redondeo, alejándose del
      // cero igual que el `ROUND_HALF_UP` de `big.js`.
      const centavos = Number(enteros) * 100 + Number(dec.slice(0, 2));
      const sube = Number(dec[2]) >= 5 ? 1 : 0;
      return signo * (centavos + sube);
    }
  }

  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return null;
  const centavos = Number((n * 100).toPrecision(15));
  return centavos < 0 ? -Math.round(-centavos) : Math.round(centavos);
};

/**
 * Suma exacta de montos de dinero.
 *
 * Sumar con `+` nativo acumula el error del binario: `0.1 + 0.2` da
 * `0.30000000000000004`, y un total de rubros o de cuotas termina descuadrado
 * contra el mismo número calculado en el backend (que usa `Big`). Acá se pasa
 * cada monto a centavos enteros —donde no hay decimales que redondear— se suma
 * en enteros y se vuelve a quetzales al final.
 *
 * Un valor que no es número se DESCARTA en vez de envenenar el total: antes un
 * solo `"1,234.56"` (o cualquier string con formato) daba `NaN` y el
 * encabezado entero mostraba "Q NaN", escondiendo también los montos sanos.
 * Perder un sumando es malo; perder el total es peor, y un `NaN` no le dice al
 * usuario ni cuál de los valores vino roto.
 *
 * `big.js` sería lo natural, pero hoy es dependencia SOLO de `cartera-back`;
 * mientras no esté en el front, esto es lo que mantiene la aritmética honesta
 * sin meter un paquete al bundle.
 */
export const sumaQ = (valores: readonly unknown[]): number =>
  valores.reduce<number>((acc, v) => {
    const centavos = aCentavos(v);
    return centavos === null ? acc : acc + centavos;
  }, 0) / 100;
