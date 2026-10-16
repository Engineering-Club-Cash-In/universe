import { useState } from "react";
import type { DesgloseMora } from "../services/services";

const q = (v: string | number) =>
  `Q${Number(v).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fecha = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return a && m && d ? `${d}/${m}/${a}` : iso;
};

/**
 * Explica al asesor de dónde sale la mora: la regla en una línea y cada cuota
 * con sus días y lo que falta (y lo generado/abonado si hubo abono). Es una
 * lista y no una tabla: la card es angosta y 5 columnas se salían. Los números vienen
 * del back, calculados igual que el cron: acá no se recalcula nada.
 */
export function DesgloseMoraPanel({
  desglose,
  moraRegistrada,
  capital,
  abiertoInicial = false,
}: {
  desglose: DesgloseMora;
  moraRegistrada: number;
  capital: number | string;
  /** Solo para pruebas: arranca desplegado. */
  abiertoInicial?: boolean;
}) {
  const [abierto, setAbierto] = useState(abiertoInicial);
  if (desglose.cuotas.length === 0 && moraRegistrada <= 0) return null;

  const subenManana =
    desglose.cuotasQueSubenManana ?? desglose.cuotas.filter((c) => !c.topada).length;
  // Lo que REALMENTE sube (el back corre el mismo cálculo con un día más): el
  // cargo diario ya viene redondeado y multiplicarlo puede errar un centavo.
  const sumaManana =
    desglose.totalManana != null ? Number(desglose.totalManana) - Number(desglose.total) : NaN;
  const ajuste = Number(desglose.ajusteRedondeo ?? 0);
  // En centavos enteros: restando en punto flotante, 0.03 − 0.02 da
  // 0.00999… y una diferencia de un centavo no se avisaría.
  const centavos = (x: number) => Math.round(x * 100);
  const difiere = centavos(Number(desglose.total)) !== centavos(moraRegistrada);
  const hayEnValidacion = desglose.cuotas.some((c) => c.en_validacion);

  return (
    <div className="mt-2 min-w-0">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="text-left text-[11px] font-semibold text-red-600 underline decoration-dotted hover:text-red-700 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
      >
        {abierto ? "Ocultar explicación" : `¿Por qué ${q(moraRegistrada)} de mora?`}
      </button>

      {abierto && (
        <div className="mt-2 min-w-0 break-words rounded-md border border-red-100 bg-red-50/60 p-2 text-[11px] text-gray-700 space-y-2">
          <div>
            <p>
              Cada cuota atrasada suma <b>{q(desglose.cargoDiario)} por día</b>, hasta{" "}
              <b>{q(desglose.cargoMensual)}</b> por cuota (30 días).
            </p>
            <p className="text-[10px] text-gray-500">
              capital {q(capital)} × 1.12% ÷ 30. Lo ya pagado o condonado de la mora de cada cuota se descuenta.
            </p>
          </div>

          <ul className="divide-y divide-red-100">
            {desglose.cuotas.map((c) => (
              <li key={c.numero_cuota} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 py-1">
                <div className="min-w-0">
                  <div className="font-semibold">Cuota #{c.numero_cuota}</div>
                  <div className="text-[10px] text-gray-500">
                    venció {fecha(c.fecha_vencimiento)} · {c.dias_atraso} {c.dias_atraso === 1 ? "día" : "días"}{c.topada && " (tope)"}
                  </div>
                  {Number(c.abonado) > 0 && (
                    <div className="text-[10px] text-gray-500">
                      generó {q(c.generado)} · abonado {q(c.abonado)}
                    </div>
                  )}
                  {c.en_validacion && (
                    <div className="text-[10px] font-semibold text-amber-700">
                      ⏳ pago sin validar hace más de 7 días: genera mora
                    </div>
                  )}
                </div>
                <div className="text-right tabular-nums whitespace-nowrap font-semibold text-red-600">
                  {q(c.pendiente)}
                </div>
              </li>
            ))}
            {Math.abs(ajuste) >= 0.01 && (
              <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 py-1 text-gray-500">
                <span className="min-w-0">Ajuste por redondeo</span>
                <span className="text-right tabular-nums whitespace-nowrap">
                  {ajuste > 0 ? "+" : "−"}
                  {q(Math.abs(ajuste))}
                </span>
              </li>
            )}
          </ul>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 border-t border-red-200 pt-1">
            <span className="min-w-0 font-semibold">Total calculado hoy</span>
            <span className="text-right tabular-nums whitespace-nowrap font-bold text-red-700">{q(desglose.total)}</span>
          </div>

          {hayEnValidacion && (
            <p className="text-amber-700">
              Las cuotas con pago en validación no aparecen como atrasadas. El pago les frena la mora
              hasta 7 días; si pasado ese plazo contabilidad no lo valida, la cuota vuelve a generar mora.
            </p>
          )}
          {/* Si lo registrado difiere del cálculo, «sube Q…» engaña: el cierre
              REEMPLAZA la mora por el cálculo de mañana, que puede quedar por
              debajo de lo registrado. Ahí se dice a cuánto queda. */}
          {difiere && Number.isFinite(sumaManana) && (
            <p>
              Si no paga, con el próximo cierre la mora queda en <b>{q(Number(desglose.totalManana))}</b>
              {sumaManana > 0 && <> (el cálculo de hoy más {q(sumaManana)} de un día más)</>}.
            </p>
          )}
          {!difiere && subenManana > 0 && Number.isFinite(sumaManana) && sumaManana > 0 && (
            <p>
              Si no paga, mañana la mora sube al menos <b>{q(sumaManana)}</b> ({subenManana}{" "}
              {subenManana === 1 ? "cuota sigue sumando" : "cuotas siguen sumando"}).
            </p>
          )}
          {difiere && (
            <p className="text-gray-500">
              La mora registrada ({q(moraRegistrada)}) es la del cierre de anoche; el cálculo de hoy
              da {q(desglose.total)}. Se actualiza en el próximo cierre.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
