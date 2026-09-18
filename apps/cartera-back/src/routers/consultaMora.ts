import { Elysia, t } from "elysia";
import { consultarMoraPorDpi } from "../controllers/consultaMora";
import { authMiddleware } from "./midleware";

export const consultaMoraRouter = new Elysia()
  .use(authMiddleware)
  /**
   * POST /clientes/consulta-mora
   * Body: { dpi, numerosCreditoConocidos? }
   * Responde si el DPI corresponde a un cliente y si puede avanzar una nueva
   * solicitud. El veredicto para el gate del CRM es `puedeContinuar`.
   *
   * Siempre responde 200 con el contrato completo, incluso ante un fallo
   * técnico: el veredicto fail-closed viaja en el cuerpo
   * (`puedeContinuar: false`, `motivo: "SERVICIO_NO_DISPONIBLE"`) y un 5xx
   * correría el riesgo de que el CRM descarte el cuerpo y pierda el veredicto.
   * `motivo` es lo que distingue el fallo técnico de un "no tiene mora".
   *
   * `numerosCreditoConocidos` son números de crédito que el llamador asocia a
   * ese DPI y que SIFCO no sabe devolver (`CRM-<uuid>`, `insoluto-N`). Se suman
   * a los del core; ver `unirNumerosCredito` en el controller. El tope de 50 es
   * holgado para el caso real —las oportunidades ganadas de un lead— y evita
   * que un cuerpo grande se convierta en un `IN (...)` sin fin.
   */
  .post(
    "/clientes/consulta-mora",
    async ({ body, set }) => {
      const resultado = await consultarMoraPorDpi(
        body.dpi,
        body.numerosCreditoConocidos
      );
      set.status = 200;
      return resultado;
    },
    {
      body: t.Object({
        dpi: t.String({ minLength: 1, error: "El DPI es obligatorio" }),
        numerosCreditoConocidos: t.Optional(
          t.Array(t.String(), { maxItems: 50 })
        ),
      }),
    }
  );
