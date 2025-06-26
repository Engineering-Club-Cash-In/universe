import { Elysia } from 'elysia';
import { insertPayment, getPagosByCreditoAndFecha, getPayments } from '../controllers/payments';

export const paymentRouter = new Elysia()
  // Endpoint para registrar pago (ya lo tienes)
  .post('/newPayment', insertPayment)
  // Nuevo endpoint para buscar pagos por SIFCO y/o fecha
  .get('/paymentByCredit', async ({ query, set }) => {
    const { numero_credito_sifco, fecha_pago } = query;

    if (!numero_credito_sifco) {
      set.status = 400;
      return { message: "Falta el parámetro 'numero_credito_sifco'" };
    }

    try {
      const pagos = await getPagosByCreditoAndFecha(numero_credito_sifco, fecha_pago);

      if (!pagos || pagos.length === 0) {
        set.status = 404;
        return { message: "No se encontraron pagos para el crédito" };
      }

      return pagos;
    } catch (error) {
      set.status = 500;
      return { message: "Error consultando pagos", error: String(error) };
    }
  })  .get('/payments', async ({ query, set }) => {
    const { mes, anio, page, perPage } = query;

    if (!mes || !anio) {
      set.status = 400;
      return { message: "Faltan parámetros obligatorios 'mes' y 'anio'" };
    }

    try {
      const result = await getPayments(
        Number(mes),
        Number(anio),
        page ? Number(page) : 1,
        perPage ? Number(perPage) : 10
      );
      return result;
    } catch (error) {
      set.status = 500;
      return { message: "Error consultando pagos por mes/año", error: String(error) };
    }
  })
  ;
 