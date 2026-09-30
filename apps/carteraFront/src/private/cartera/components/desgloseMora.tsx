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
 * con sus días, lo que generó, lo ya abonado y lo que falta. Los números vienen
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
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="text-[11px] font-semibold text-red-600 underline decoration-dotted hover:text-red-700"
      >
        {abierto ? "Ocultar explicación" : `¿Por qué ${q(moraRegistrada)} de mora?`}
      </button>

      {abierto && (
        <div className="mt-2 rounded-md border border-red-100 bg-red-50/60 p-2 text-[11px] text-gray-700 space-y-2">
          <p>
            Cada cuota atrasada suma <b>{q(desglose.cargoDiario)} por día</b> (capital{" "}
            {q(capital)} × 1.12% ÷ 30), hasta un máximo de <b>{q(desglose.cargoMensual)}</b> por
            cuota (30 días). Lo ya abonado a la mora de cada cuota (pagado o condonado) se descuenta de esa cuota.
          </p>

          <table className="w-full border-separate border-spacing-x-1">
            <thead>
              <tr className="text-left text-[10px] uppercase text-gray-500">
                <th className="font-semibold">Cuota</th>
                <th className="font-semibold">Días</th>
                <th className="font-semibold text-right whitespace-nowrap">Generó</th>
                <th className="font-semibold text-right whitespace-nowrap">Abonado</th>
                <th className="font-semibold text-right whitespace-nowrap">Debe</th>
              </tr>
            </thead>
            <tbody>
              {desglose.cuotas.map((c) => (
                <tr key={c.numero_cuota} className="align-top">
                  <td>
                    #{c.numero_cuota}
                    <div className="text-[10px] text-gray-500">venció {fecha(c.fecha_vencimiento)}</div>
                    {c.en_validacion && (
                      <div className="text-[10px] font-semibold text-amber-700">
                        ⏳ pago en validación: sigue generando mora
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap">
                    {c.dias_atraso}
                    {c.topada && <div className="text-[10px] text-gray-500">tope</div>}
                  </td>
                  <td className="text-right whitespace-nowrap">{q(c.generado)}</td>
                  <td className="text-right whitespace-nowrap">{Number(c.abonado) > 0 ? `−${q(c.abonado)}` : "—"}</td>
                  <td className="text-right whitespace-nowrap font-semibold text-red-600">{q(c.pendiente)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {Math.abs(ajuste) >= 0.01 && (
                <tr>
                  <td colSpan={4} className="pt-1 text-gray-500">Ajuste por redondeo</td>
                  <td className="pt-1 text-right whitespace-nowrap text-gray-500">
                    {ajuste > 0 ? "+" : "−"}
                    {q(Math.abs(ajuste))}
                  </td>
                </tr>
              )}
              <tr className="border-t border-red-100">
                <td colSpan={4} className="pt-1 font-semibold">Total calculado hoy</td>
                <td className="pt-1 text-right font-bold text-red-700">{q(desglose.total)}</td>
              </tr>
            </tfoot>
          </table>

          {hayEnValidacion && (
            <p className="text-amber-700">
              Las cuotas con pago en validación no aparecen como atrasadas, pero generan mora hasta
              que contabilidad valide el pago.
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
