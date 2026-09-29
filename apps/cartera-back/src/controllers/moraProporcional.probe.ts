/**
 * Sonda de zona horaria para los helpers de fecha de mora.
 *
 * `moraProporcional.test.ts` (su test hermano, al lado) la corre con `Bun.spawnSync` bajo TZ distintos
 * (la zona del proceso se fija al arrancar y no se puede cambiar en caliente)
 * y exige que las DOS corridas den exactamente el mismo JSON: producción corre
 * en UTC (el Dockerfile arranca de `oven/bun` y no fija TZ) y desarrollo en
 * America/Guatemala, así que cualquier resultado que dependa de la zona del
 * proceso es un corrimiento de día esperando a pasar.
 *
 * NO toca la base: solo importa helpers puros. `../database` se carga al
 * importar latefee.ts, pero `new Pool()` es perezoso y acá no se ejecuta
 * ninguna query; el runner igual le pasa una URL local de mentira.
 *
 * Vive junto a su test y NO como `*.test.ts` a propósito: es un script que el
 * test lanza como proceso hijo, no una suite — si el runner la globeara, la
 * correría suelta como "archivo sin pruebas".
 */
import {
  diasAtrasoMora,
  fechaCalendarioGT,
  hoyGuatemala,
  isOverdueInstallmentForMora,
} from "./latefee";

// Instante fijo: 09:00 de Guatemala del 21-sep-2026 (15:00 UTC). Fijarlo hace
// la sonda determinista sin importar cuándo corra.
const AHORA = new Date("2026-09-21T15:00:00.000Z");
const hoy = hoyGuatemala(AHORA);

const cuota = (fecha_vencimiento: Date | string) => ({
  fecha_vencimiento,
  pagado: false,
  hasPaidPayment: false,
  statusCredit: "ACTIVO",
});

/**
 * Formas en que la fecha de vencimiento puede llegar a los helpers:
 *  - "YYYY-MM-DD": lo que devuelve drizzle HOY para la columna `date`.
 *  - "YYYY-MM-DD HH:MM:SS": literal crudo de Postgres sin zona.
 *  - Date con campos LOCALES: lo que construye `pg` si el valor se parsea.
 *  - String con zona explícita: no sale de la base, pero varios tests la usan.
 */
const CASOS: Record<string, Date | string> = {
  "iso vence hoy": "2026-09-21",
  "iso ayer": "2026-09-20",
  "iso hace 15": "2026-09-06",
  "iso futuro": "2026-10-15",
  "literal pg vence hoy": "2026-09-21 00:00:00",
  "literal pg ayer": "2026-09-20 00:00:00",
  "Date local vence hoy": new Date(2026, 8, 21),
  "Date local ayer": new Date(2026, 8, 20),
  "Date local a media tarde": new Date(2026, 8, 20, 17, 30),
  "string con zona ayer": "2026-09-20T06:00:00.000Z",
  "string con zona vence hoy": "2026-09-21T06:00:00.000Z",
};

const salida: Record<string, { dias: number; vencida: boolean; cal: number }> = {};
for (const [nombre, fecha] of Object.entries(CASOS)) {
  salida[nombre] = {
    dias: diasAtrasoMora(fecha, hoy),
    vencida: isOverdueInstallmentForMora(cuota(fecha), hoy),
    cal: fechaCalendarioGT(fecha),
  };
}

console.log(JSON.stringify(salida));
