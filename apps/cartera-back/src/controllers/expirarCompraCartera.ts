import Big from "big.js";
import { and, eq, isNotNull } from "drizzle-orm";
import { sendCompraCarteraExpiradaNotification } from "@cci/email";
import { db } from "../database";
import {
  creditos,
  creditos_inversionistas_espejo,
  inversionistas,
  usuarios,
} from "../database/db";
import {
  calcularExpiracionCompraCartera,
  formatFechaLargaGT,
  gtDateKey,
  nowGT,
} from "../utils/functions/businessDays";
import { COMPRA_CARTERA_RECIPIENTS } from "../utils/functions/compraCarteraRecipients";
import { returnPendingInvestorsToCube } from "./replaceInvestorCredit";

// ================================================================
// JOB: Expira compras de cartera aceptadas que no se completaron
// dentro de los 3 días hábiles de vigencia.
//
// Regla:
//   - aceptada_at → expira = aceptada_at + 3 días hábiles GT
//   - diaBaja     = expira + 1 día hábil (siguiente lunes–viernes)
//   - Al correr el job, si hoy (GT) >= diaBaja y el row sigue en
//     "pendiente_revision", se considera vencido y se devuelve a CUBE.
//
// Corre cada día a las 00:00 GT (ver schedule.ts).
// Al finalizar, manda correo a los mismos destinatarios del aviso de
// aceptación indicando qué inversionista(s) y crédito(s) se cancelaron.
// ================================================================
export async function expirarCompraCarteraVencidas(): Promise<{
  success: boolean;
  escaneados: number;
  vencidos: number;
  creditosProcesados: number;
  resultado?: unknown;
}> {
  const ahora = nowGT();
  const hoyKey = gtDateKey(ahora);

  // 1) Traer candidatos junto con nombre de inversionista, SIFCO y cliente.
  //    Lo hacemos ANTES del return-to-cube porque ese paso limpia los rows
  //    del espejo y perderíamos la info para el correo.
  const candidatos = await db
    .select({
      id: creditos_inversionistas_espejo.id,
      credito_id: creditos_inversionistas_espejo.credito_id,
      inversionista_id: creditos_inversionistas_espejo.inversionista_id,
      inversionista_nombre: inversionistas.nombre,
      aceptada_at: creditos_inversionistas_espejo.aceptada_at,
      compra_cartera_extendida_at:
        creditos_inversionistas_espejo.compra_cartera_extendida_at,
      monto_aportado: creditos_inversionistas_espejo.monto_aportado,
      numero_credito_sifco: creditos.numero_credito_sifco,
      cliente_nombre: usuarios.nombre,
    })
    .from(creditos_inversionistas_espejo)
    .innerJoin(
      inversionistas,
      eq(
        creditos_inversionistas_espejo.inversionista_id,
        inversionistas.inversionista_id,
      ),
    )
    .innerJoin(
      creditos,
      eq(creditos_inversionistas_espejo.credito_id, creditos.credito_id),
    )
    .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
    .where(
      and(
        eq(creditos_inversionistas_espejo.status, "pendiente_revision"),
        isNotNull(creditos_inversionistas_espejo.aceptada_at),
      ),
    );

  // 2) Filtrar a los que ya cumplieron diaBaja.
  const vencidos = candidatos.filter((row) => {
    if (!row.aceptada_at) return false;
    const { diaBaja } = calcularExpiracionCompraCartera(
      row.aceptada_at,
      Boolean(row.compra_cartera_extendida_at),
    );
    return gtDateKey(diaBaja) <= hoyKey;
  });

  if (vencidos.length === 0) {
    console.log(
      `[expirarCompraCartera] ${candidatos.length} rows escaneados, ninguno vencido al ${hoyKey}`,
    );
    return {
      success: true,
      escaneados: candidatos.length,
      vencidos: 0,
      creditosProcesados: 0,
    };
  }

  // 3) Agrupar los vencidos por inversionista. Así la limpieza es
  //    quirúrgica: solo se sacan los rows del inversionista vencido,
  //    respetando cualquier otro pendiente que tenga el mismo crédito.
  type CreditoInfo = {
    numero_credito_sifco: string;
    cliente_nombre: string;
    monto_aportado: string;
  };
  const porInversionista = new Map<
    number,
    {
      inversionista_nombre: string;
      creditoIds: Set<number>;
      creditos: CreditoInfo[];
    }
  >();
  for (const row of vencidos) {
    const entry = porInversionista.get(row.inversionista_id) ?? {
      inversionista_nombre: row.inversionista_nombre,
      creditoIds: new Set<number>(),
      creditos: [],
    };
    entry.creditoIds.add(row.credito_id);
    entry.creditos.push({
      numero_credito_sifco: row.numero_credito_sifco,
      cliente_nombre: row.cliente_nombre,
      monto_aportado: new Big(row.monto_aportado).toFixed(2),
    });
    porInversionista.set(row.inversionista_id, entry);
  }

  const creditosUnicos = new Set(vencidos.map((r) => r.credito_id));
  console.log(
    `[expirarCompraCartera] ${vencidos.length} row(s) vencidos, ${porInversionista.size} inversionista(s) en ${creditosUnicos.size} crédito(s) al ${hoyKey}, devolviendo a CUBE...`,
  );

  // 4) Llamar al controller por inversionista con filtro específico.
  const inversionistasOk: Array<{
    inversionista_nombre: string;
    creditos: CreditoInfo[];
  }> = [];
  const resultadosPorInversionista: Array<{
    inversionista_id: number;
    status: number;
    resultado: unknown;
  }> = [];

  for (const [invId, entry] of porInversionista) {
    const mockSet: { status: number } = { status: 200 };
    const resultado = await returnPendingInvestorsToCube({
      body: {
        creditos: Array.from(entry.creditoIds),
        inversionista_id: invId,
      },
      set: mockSet,
    });
    resultadosPorInversionista.push({
      inversionista_id: invId,
      status: mockSet.status,
      resultado,
    });
    if (mockSet.status < 400) {
      inversionistasOk.push({
        inversionista_nombre: entry.inversionista_nombre,
        creditos: entry.creditos,
      });
    } else {
      console.error(
        `[expirarCompraCartera] Falló return-to-cube para inversionista ${invId}:`,
        resultado,
      );
    }
  }

  // 5) Un solo correo resumen con todos los inversionistas que sí se
  //    limpiaron. Si alguno falló, queda fuera del correo (pero logueado).
  if (inversionistasOk.length > 0) {
    try {
      await sendCompraCarteraExpiradaNotification({
        to: COMPRA_CARTERA_RECIPIENTS.to,
        cc: COMPRA_CARTERA_RECIPIENTS.cc,
        inversionistas: inversionistasOk,
        fechaEjecucionLabel: formatFechaLargaGT(ahora),
      });
    } catch (mailErr) {
      console.error(
        "[expirarCompraCartera] Falló el envío del correo de expiración:",
        mailErr,
      );
    }
  }

  return {
    success: inversionistasOk.length === porInversionista.size,
    escaneados: candidatos.length,
    vencidos: vencidos.length,
    creditosProcesados: creditosUnicos.size,
    resultado: resultadosPorInversionista,
  };
}
