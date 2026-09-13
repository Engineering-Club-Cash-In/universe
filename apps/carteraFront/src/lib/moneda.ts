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
