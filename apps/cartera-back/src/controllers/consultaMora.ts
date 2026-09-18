import { and, eq, inArray } from "drizzle-orm";
import { db } from "../database";
import {
  convenios_pago,
  creditos,
  moras_credito,
  moras_historial,
} from "../database/db/schema";
import { sifcoDb } from "../database/sifco";
import { prestamos } from "../database/sifco/schema";
import {
  buscarClientesPorIdentificacion,
  consultarPrestamosPorCliente,
} from "../services/sifcoIntegrations";
import {
  construirHistorialMora,
  construirRespuesta,
  fichasDelDpi,
  fusionarCreditosPorId,
  nombreClienteSifco,
  respuestaClienteNoEncontrado,
  respuestaServicioNoDisponible,
  unirNumerosCredito,
  type CreditoConsultaMora,
  type FilaCreditoMora,
  type RespuestaConsultaMora,
} from "./consultaMoraPolicy";

/**
 * Responde si el dueño de un DPI ya es cliente y si está en mora, para el gate
 * del CRM antes de dejar avanzar una solicitud.
 *
 * Fail-closed: cualquier fallo de SIFCO o de la base sale como
 * SERVICIO_NO_DISPONIBLE con `puedeContinuar: false`. Nunca se devuelve un
 * "sin mora" optimista ante un fallo.
 *
 * `numerosCreditoConocidos` los aporta quien pregunta (ver
 * `unirNumerosCredito`): son créditos que existen en `creditos` pero que SIFCO
 * no sabe asociar a este DPI.
 */
export async function consultarMoraPorDpi(
  dpi: string,
  numerosCreditoConocidos?: string[]
): Promise<RespuestaConsultaMora> {
  const consultadoEn = new Date();

  try {
    const dpiLimpio = dpi.trim();
    const clientes = await buscarClientesPorIdentificacion(dpiLimpio);

    // TODAS las fichas del DPI, no la primera: un mismo DPI puede tener varias
    // en el core (natural + jurídica, o duplicados sin unificar) y los créditos
    // cuelgan de la ficha. Con la primera, un moroso con dos fichas pasaba
    // limpio si la primera estaba al día. Ver `fichasDelDpi`.
    const fichas = fichasDelDpi(clientes, dpiLimpio);
    const codigosCliente = fichas.map((ficha) => String(ficha.CodigoCliente));

    // Secuencial y no en paralelo: son pocas fichas (casi siempre una) y el
    // core aguanta mal las ráfagas. Si una falla, el throw sube y el veredicto
    // sale SERVICIO_NO_DISPONIBLE — fail-closed: una ficha no consultada no
    // puede leerse como una ficha sin mora.
    const numerosSifco: string[] = [];
    for (const codigo of codigosCliente) {
      numerosSifco.push(...(await obtenerNumerosPrestamo(codigo)));
    }

    const numerosPrestamo = unirNumerosCredito(
      numerosSifco,
      numerosCreditoConocidos
    );

    // Sin ficha en el core Y sin un solo número que mirar no hay nada que
    // consultar. Ya NO alcanza con `!fichas.length`: el cliente cuyos créditos
    // nacieron todos en el CRM no tiene ficha, y cortar acá era justo el agujero
    // que lo dejaba pasar como CLIENTE_NO_ENCONTRADO.
    if (!numerosPrestamo.length) {
      return respuestaClienteNoEncontrado(consultadoEn);
    }

    const creditosCliente = await obtenerCreditosConMora(numerosPrestamo);

    // Ni ficha ni crédito: el DPI no le consta a nadie.
    if (!fichas.length && !creditosCliente.length) {
      return respuestaClienteNoEncontrado(consultadoEn);
    }

    const creditosRespuesta: CreditoConsultaMora[] = creditosCliente.map((fila) => ({
      numeroCreditoSifco: fila.numeroCreditoSifco,
      estado: fila.estado,
      moraActiva:
        fila.moraMonto !== null
          ? { monto: fila.moraMonto, cuotasAtrasadas: fila.moraCuotas ?? 0 }
          : null,
    }));

    const numeroPorCreditoId = new Map(
      creditosCliente.map((fila) => [fila.credito_id, fila.numeroCreditoSifco])
    );

    return construirRespuesta({
      // El cliente que viaja en la respuesta es la primera ficha: es un dato de
      // presentación. El veredicto se arma sobre los créditos de todas. Va
      // `null` cuando el crédito se encontró por los números aportados y el
      // core no tiene ficha — el hallazgo es igual de real.
      cliente: fichas.length
        ? {
            codigoClienteSifco: codigosCliente[0],
            nombre: nombreClienteSifco(fichas[0]),
          }
        : null,
      creditos: creditosRespuesta,
      historialMora: await obtenerHistorialMora(numeroPorCreditoId),
      consultadoEn,
    });
  } catch (error) {
    console.error("❌ consultarMoraPorDpi falló:", error);
    return respuestaServicioNoDisponible(consultadoEn);
  }
}

/** El SELECT de créditos + mora viva, compartido por las dos pasadas. */
function selectCreditosConMora() {
  return db
    .select({
      credito_id: creditos.credito_id,
      usuario_id: creditos.usuario_id,
      numeroCreditoSifco: creditos.numero_credito_sifco,
      estado: creditos.statusCredit,
      moraMonto: moras_credito.monto_mora,
      moraCuotas: moras_credito.cuotas_atrasadas,
    })
    .from(creditos)
    .leftJoin(
      moras_credito,
      and(
        eq(moras_credito.credito_id, creditos.credito_id),
        eq(moras_credito.activa, true)
      )
    );
}

/**
 * Dos pasadas: por número y después por dueño. Ver `fusionarCreditosPorId` para
 * por qué la segunda existe y por qué no reemplaza a la primera.
 */
async function obtenerCreditosConMora(
  numerosPrestamo: string[]
): Promise<FilaCreditoMora[]> {
  const porNumero = await selectCreditosConMora().where(
    inArray(creditos.numero_credito_sifco, numerosPrestamo)
  );

  const usuarioIds = [
    ...new Set(
      porNumero
        .map((fila) => fila.usuario_id)
        .filter((id): id is number => id !== null)
    ),
  ];

  if (!usuarioIds.length) {
    return porNumero;
  }

  const porUsuario = await selectCreditosConMora().where(
    inArray(creditos.usuario_id, usuarioIds)
  );

  return fusionarCreditosPorId(porNumero, porUsuario);
}

/**
 * Números de préstamo del cliente, en dos pasos y no en un JOIN.
 *
 * 🔴 El schema `sifco.` NO vive en la base de cartera: `database/sifco/index.ts`
 * abre su propio Pool contra `SIFCO_DB_URL`. Cruzar `sifco.prestamos` con
 * `cartera.creditos` en un solo SELECT es imposible; el cruce se hace en JS,
 * con los `pre_numero` de acá y un `inArray` sobre la conexión de cartera.
 *
 * Además `sifcoDb` puede ser `null` (variable sin configurar: el módulo solo
 * avisa por consola). Por eso el API no es un lujo sino el camino principal en
 * cualquier entorno sin esa variable. Y un espejo vacío tampoco prueba que el
 * cliente no tenga créditos —sync atrasada, crédito recién colocado—, así que
 * también cae al API: dar "sin mora" por esa razón sería el falso negativo que
 * este endpoint existe para evitar. Si el API tampoco responde, el throw sube y
 * el llamador responde SERVICIO_NO_DISPONIBLE.
 */
async function obtenerNumerosPrestamo(
  codigoClienteSifco: string
): Promise<string[]> {
  if (sifcoDb) {
    const filas = await sifcoDb
      .select({ pre_numero: prestamos.pre_numero })
      .from(prestamos)
      .where(eq(prestamos.pre_cli_cod, codigoClienteSifco));

    if (filas.length) {
      return filas.map((fila) => fila.pre_numero);
    }
  }

  const respuesta = await consultarPrestamosPorCliente(Number(codigoClienteSifco));

  return (respuesta?.Prestamos ?? [])
    .map((prestamo) => prestamo.NumeroPrestamo)
    .filter((numero): numero is string => Boolean(numero));
}

async function obtenerHistorialMora(
  numeroPorCreditoId: Map<number, string>
): Promise<ReturnType<typeof construirHistorialMora>> {
  const creditoIds = [...numeroPorCreditoId.keys()];

  if (!creditoIds.length) {
    return construirHistorialMora({ eventos: [], morasCerradas: [], convenios: [] });
  }

  const numeroDe = (creditoId: number) => numeroPorCreditoId.get(creditoId) ?? "";

  const [eventos, morasCerradas, convenios] = await Promise.all([
    db
      .select({
        credito_id: moras_historial.credito_id,
        fecha: moras_historial.fecha,
        monto_nuevo: moras_historial.monto_nuevo,
        tipo_evento: moras_historial.tipo_evento,
      })
      .from(moras_historial)
      .where(inArray(moras_historial.credito_id, creditoIds)),
    db
      .select({
        credito_id: moras_credito.credito_id,
        // Una mora cerrada no guarda fecha de cierre propia: `updated_at` es el
        // momento en que se la desactivó.
        fecha: moras_credito.updated_at,
        created_at: moras_credito.created_at,
        monto_mora: moras_credito.monto_mora,
      })
      .from(moras_credito)
      .where(
        and(
          inArray(moras_credito.credito_id, creditoIds),
          eq(moras_credito.activa, false)
        )
      ),
    db
      .select({
        credito_id: convenios_pago.credito_id,
        fecha_convenio: convenios_pago.fecha_convenio,
        monto_total_convenio: convenios_pago.monto_total_convenio,
      })
      .from(convenios_pago)
      .where(inArray(convenios_pago.credito_id, creditoIds)),
  ]);

  return construirHistorialMora({
    eventos: eventos.map((fila) => ({
      fecha: fila.fecha,
      monto_nuevo: fila.monto_nuevo,
      tipo_evento: fila.tipo_evento,
      numeroCreditoSifco: numeroDe(fila.credito_id),
    })),
    morasCerradas: morasCerradas
      .map((fila) => ({
        fecha: fila.fecha ?? fila.created_at,
        monto_mora: fila.monto_mora,
        numeroCreditoSifco: numeroDe(fila.credito_id),
      }))
      .filter((fila): fila is { fecha: Date; monto_mora: string; numeroCreditoSifco: string } =>
        fila.fecha !== null
      ),
    convenios: convenios.map((fila) => ({
      fecha_convenio: fila.fecha_convenio,
      monto_total_convenio: fila.monto_total_convenio,
      numeroCreditoSifco: numeroDe(fila.credito_id),
    })),
  });
}
