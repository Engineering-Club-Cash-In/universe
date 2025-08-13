// routes/inversionistas.ts
import { Elysia } from 'elysia';
import { actualizarEstadoCredito, cancelCredit, getCreditoByNumero,  getCreditosIncobrables,  getCreditosWithUserByMesAnio, insertCredit, resetCredit, updateCredit } from '../controllers/credits';

export const creditRouter = new Elysia()
  // Crear nuevo crédito
  .post('/newCredit', insertCredit)
   .put('/updateCredit', updateCredit)
  // Obtener crédito por query param ?numero_credito_sifco=XXXX
  .get('/credito', async ({ query, set }) => {
    const { numero_credito_sifco } = query;
    if (!numero_credito_sifco) {
      set.status = 400;
      return { message: "Falta el parámetro 'numero_credito_sifco'" };
    }
    const result = await getCreditoByNumero(numero_credito_sifco);
    if (typeof result === 'object' && result !== null && 'message' in result && result.message === "Crédito no encontrado") set.status = 404;
    if (typeof result === 'object' && result !== null && 'error' in result && result.error) set.status = 500;
    return result;
  })  .get('/getAllCredits', async ({ query, set }) => {
  // Extraer query params
  const {
    mes,
    anio,
    page = 1,
    perPage = 10,
    numero_credito_sifco,
    estado // 👈 obligatorio
  } = query as Record<string, string>;

  // Validar parámetros requeridos
  if (!mes || !anio || !estado) {
    set.status = 400;
    return { message: "Faltan parámetros 'mes', 'anio' y/o 'estado'." };
  }

  // Convertir a número (ya que query params vienen como string)
  const mesNum = Number(mes);
  const anioNum = Number(anio);
  const pageNum = Number(page);
  const perPageNum = Number(perPage);
  const numeroCreditoSifco = numero_credito_sifco ? String(numero_credito_sifco) : undefined;
  const estadoParam = String(estado) as "ACTIVO" | "CANCELADO" | "INCOBRABLE" | "PENDIENTE_CANCELACION";

  if (
    isNaN(mesNum) || mesNum < 0 || mesNum > 12 ||
    isNaN(anioNum) || anioNum < 0
  ) {
    set.status = 400;
    return { message: "Parámetros 'mes' y/o 'anio' inválidos." };
  }

  // Llamar servicio
  try {
    const result = await getCreditosWithUserByMesAnio(
      mesNum,
      anioNum,
      pageNum,
      perPageNum,
      numeroCreditoSifco,
      estadoParam // 👈 pásalo aquí (obligatorio)
    );
    set.status = 200;
    return result;
  } catch (error) {
    set.status = 500;
    return { message: "Error obteniendo créditos", error: String(error) };
  }
})

  .post('/cancelCredit', async ({ body, set }) => {
  // Validar que venga el creditId en el body
  const { creditId } = body as { creditId?: number };
  if (!creditId || isNaN(Number(creditId))) {
    set.status = 400;
    return { message: "Falta o es inválido el parámetro 'creditId'" };
  }
  try {
    const result = await cancelCredit(Number(creditId));
    // Si el resultado tiene error, devolver status adecuado
    if ('error' in result && result.error) {
      set.status = 500;
      return result;
    }
    if ('message' in result && result.message === "Crédito no encontrado.") {
      set.status = 404;
    }
    return result;
  } catch (error) {
    set.status = 500;
    return { message: "Error cancelando crédito", error: String(error) };
  }
}).post('/creditAction', async ({ body, set }) => {
    const {
      creditId,
      motivo,
      observaciones,
      monto_cancelacion,
      accion,
    } = body as {
      creditId?: number;
      motivo?: string;
      observaciones?: string;
      monto_cancelacion?: number;
      accion?: "CANCELAR" | "ACTIVAR" | "INCOBRABLE" | "PENDIENTE_CANCELACION";
    };

    // Validaciones mínimas
    if (!creditId || isNaN(Number(creditId))) {
      set.status = 400;
      return { message: "Falta o es inválido el parámetro 'creditId'" };
    }
    if (!accion || (accion !== "CANCELAR" && accion !== "ACTIVAR" && accion !== "INCOBRABLE" && accion !== "PENDIENTE_CANCELACION" )) {
      set.status = 400;
      return { message: "Falta o es inválido el parámetro 'accion'" };
    }
    if (accion === "CANCELAR" && (!motivo || !monto_cancelacion)) {
      set.status = 400;
      return {
        message:
          "Para cancelar, se requiere 'motivo' y 'monto_cancelacion'.",
      };
    }

    // Ejecuta la acción
    try {
      const result = await actualizarEstadoCredito({
        creditId: Number(creditId),
        motivo,
        observaciones,
        monto_cancelacion,
        accion,
      });

      // Manejo de errores específicos
      if (!result.ok) {
        set.status = 400;
      }
      return result;
    } catch (error) {
      set.status = 500;
      return { message: "Error actualizando estado del crédito", error: String(error) };
    }
  })
  /**
   * Ruta para obtener créditos incobrables con paginación y filtro opcional por número de crédito SIFCO.
   * Query params: page, perPage, numero_credito_sifco
   */
  .get('/incobrables', async ({ query, set }) => {
    const {
      page = "1",
      perPage = "20",
      numero_credito_sifco
    } = query as Record<string, string>;

    const pageNum = Number(page);
    const perPageNum = Number(perPage);

    if (isNaN(pageNum) || pageNum < 1 || isNaN(perPageNum) || perPageNum < 1) {
      set.status = 400;
      return { message: "Parámetros 'page' y/o 'perPage' inválidos." };
    }

    try {
      // Importa el controlador donde corresponda
      const result = await getCreditosIncobrables(pageNum, perPageNum, numero_credito_sifco);
      set.status = result.ok ? 200 : 500;
      return result;
    } catch (error) {
      set.status = 500;
      return { message: "Error obteniendo créditos incobrables", error: String(error) };
    }
  })
.post('/resetCredit', async ({ body, set }) => {
  // Valida los parámetros
  const { creditId, montoIncobrable, montoBoleta, url_boletas, cuota } = body as {
    creditId?: number;
    montoIncobrable?: number;
    montoBoleta?: number | string;
    url_boletas?: string[];
    cuota?: number;
  };

  // Validaciones mínimas
  if (
    !creditId || isNaN(Number(creditId)) ||
    montoBoleta === undefined || isNaN(Number(montoBoleta)) ||
    !Array.isArray(url_boletas) ||
    cuota === undefined || isNaN(Number(cuota))
  ) {
    set.status = 400;
    return { message: "Faltan o son inválidos los parámetros requeridos." };
  }

  try {
    const result = await resetCredit({
      creditId: Number(creditId),
      montoIncobrable: montoIncobrable !== undefined ? Number(montoIncobrable) : undefined,
      montoBoleta: montoBoleta,
      url_boletas: url_boletas,
      cuota: Number(cuota),
    });
    set.status = 200;
    return result;
  } catch (error) {
    set.status = 500;
    return { message: "Error reiniciando el crédito", error: String(error) };
  }
})
