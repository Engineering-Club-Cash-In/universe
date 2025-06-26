// routes/inversionistas.ts
import { Elysia } from 'elysia';
import { getCreditoByNumero,  getCreditosWithUserByMesAnio, insertCredit } from '../controllers/credits';

export const creditRouter = new Elysia()
  // Crear nuevo crédito
  .post('/newCredit', insertCredit)
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
    } = query as Record<string, string>;

    // Validar parámetros requeridos
    if (!mes || !anio) {
      set.status = 400;
      return { message: "Faltan parámetros 'mes' y/o 'anio'." };
    }

    // Convertir a número (ya que query params vienen como string)
    const mesNum = Number(mes);
    const anioNum = Number(anio);
    const pageNum = Number(page);
    const perPageNum = Number(perPage);

    if (
      isNaN(mesNum) || mesNum < 1 || mesNum > 12 ||
      isNaN(anioNum) || anioNum < 1900
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
        perPageNum
      );
      set.status = 200;
      return result;
    } catch (error) {
      set.status = 500;
      return { message: "Error obteniendo créditos", error: String(error) };
    }
  }); 