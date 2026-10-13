/**
 * Lógica pura del envío de recibos por WhatsApp (sin base ni Puppeteer, para
 * poder probarla aislada): un recibo por boleta y un tope de Chromium a la vez.
 * La usa `reciboPagoWhatsapp.ts`.
 */

export interface ResultadoEnvioRecibo {
  success: boolean;
  message: string;
}

/**
 * Cada recibo abre un Chromium (Puppeteer) dentro del proceso de la API.
 * Validar muchos pagos seguidos lanzaba un navegador por pago, todos a la vez,
 * con riesgo de quedarse sin memoria. Se generan de a lo sumo 2 a la vez; el
 * resto espera su turno (el envío ya es asíncrono, nadie espera la respuesta).
 */
const MAX_RECIBOS_EN_PARALELO = 2;
let recibosEnCurso = 0;
const enEspera: Array<() => void> = [];

export async function conTurnoDeRecibo<T>(trabajo: () => Promise<T>): Promise<T> {
  if (recibosEnCurso >= MAX_RECIBOS_EN_PARALELO) {
    await new Promise<void>((resolve) => enEspera.push(resolve));
  }
  recibosEnCurso += 1;
  try {
    return await trabajo();
  } finally {
    recibosEnCurso -= 1;
    enEspera.shift()?.();
  }
}

/**
 * Un envío por BOLETA para los pagos dados. Devuelve un resultado por cada
 * `pagoId` de entrada, en el mismo orden: las filas de una misma boleta
 * comparten el resultado de su único envío. Con `soloBoletasCompletas`, una
 * boleta con filas sin validar no se manda (su resultado es success sin envío).
 */
export async function enviarPorBoleta(
  params: { pagoIds: number[]; soloBoletasCompletas?: boolean },
  deps: {
    boletaDe: (pagoId: number) => Promise<{ comprobante: number; completa: boolean }>;
    enviar: (pagoId: number) => Promise<ResultadoEnvioRecibo>;
  },
): Promise<ResultadoEnvioRecibo[]> {
  const porComprobante = new Map<number, ResultadoEnvioRecibo>();
  const resultados: ResultadoEnvioRecibo[] = [];
  for (const pagoId of params.pagoIds) {
    const boleta = await deps.boletaDe(pagoId);
    let resultado = porComprobante.get(boleta.comprobante);
    if (!resultado) {
      resultado =
        params.soloBoletasCompletas && !boleta.completa
          ? { success: true, message: "Boleta con filas sin validar: el recibo sale al validar la última" }
          : await deps.enviar(pagoId);
      porComprobante.set(boleta.comprobante, resultado);
    }
    resultados.push(resultado);
  }
  return resultados;
}
