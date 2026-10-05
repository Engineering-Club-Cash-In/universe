/**
 * Ventana proporcional de un inversionista que entra a mitad de mes.
 *
 * Lógica extraída de `insertPagosCreditoInversionistas` (payments.ts, rama
 * `esMesAnterior`) para poder testearla sin arrastrar la BD.
 *
 * El interés del primer mes se cobra por los días que el inversionista estuvo
 * dentro: `diasProporcionales / diasDelMes`.
 *
 * ⚠️ Zona horaria: usa los getters LOCALES a propósito, porque el llamador
 *    parsea `fecha_inicio_participacion` como `new Date(fecha + "T00:00:00")`
 *    (medianoche local). El prorrateo por compra de cartera
 *    (`cofidi/prorrateoPciInteres.ts`) hace lo mismo en UTC porque allá la fecha
 *    llega directo de una columna `date`. No unificar sin decidir primero cuál
 *    de las dos interpretaciones es la correcta — cambia el día del corte en GT.
 */
export function calcularVentanaProporcional(fechaInicio: Date): {
  diasDelMes: number;
  diaInicio: number;
  diasProporcionales: number;
} {
  // Truco JS: día 0 del mes siguiente = último día del mes actual.
  const diasDelMes = new Date(
    fechaInicio.getFullYear(),
    fechaInicio.getMonth() + 1,
    0
  ).getDate();
  const diaInicio = fechaInicio.getDate(); // ej: 7

  // 🩹 Piso de 1 día: si la fecha de inicio cae el ÚLTIMO día del mes la resta da
  //    0 y el inversionista cobraría CERO interés pese a haber participado.
  const diasProporcionales = Math.max(1, diasDelMes - diaInicio); // ej: 31 - 7 = 24

  return { diasDelMes, diaInicio, diasProporcionales };
}
