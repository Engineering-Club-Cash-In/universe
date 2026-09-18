import { Elysia, t } from "elysia";
import { consultarMoraPorDpi } from "../controllers/consultaMora";
import {
  rolPuedeConsultarMora,
  validarDpiConsulta,
} from "../controllers/consultaMoraPolicy";
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
   *
   * 🔴 `numerosCreditoConocidos` es un CANAL CONFIADO y cartera no puede
   * verificarlo: la asociación DPI ↔ número de crédito del CRM vive en el CRM,
   * no acá, así que cartera toma la palabra de quien llama. Las consecuencias
   * de un número ajeno son dos: (1) ese crédito entra al veredicto y puede
   * bloquear a un DPI que no le debe nada a nadie, y (2) la expansión por dueño
   * (`usuario_id`) le cuelga al DPI consultado la cartera COMPLETA del titular
   * de ese número, que además viaja visible en `creditos`/`historialMora`. Por
   * eso el gate de rol de abajo no es cosmético: es lo único que separa este
   * canal de cualquier token vivo. Para el CRM —canal interno, personal de la
   * casa— es aceptable; abrirlo a un rol de afuera no lo sería.
   *
   * ⏱️ Toda la resolución de números (identificación + espejo + API de cada
   * ficha) corre bajo UN presupuesto global de 15s; ver
   * `PRESUPUESTO_NUMEROS_GATE_MS` en el controller. Al vencerse sale
   * SERVICIO_NO_DISPONIBLE, fail-closed.
   *
   * Las únicas respuestas que no son 200 son el 403 del gate de rol (ver
   * `ROLES_CONSULTA_MORA`) y el 400 de validación del DPI: un valor que no son
   * 13 dígitos ni siquiera se le pregunta al core, y decirle
   * "SERVICIO_NO_DISPONIBLE" a un dato mal escrito manda al asesor a reintentar
   * en vez de a corregirlo. Ver `validarDpiConsulta`.
   */
  .post(
    "/clientes/consulta-mora",
    async ({ body, set, user }: any) => {
      if (!rolPuedeConsultarMora(user?.role)) {
        set.status = 403;
        return {
          success: false,
          message: "[ERROR] No autorizado (requiere ADMIN, CONTA o ASESOR)",
        };
      }

      const validacion = validarDpiConsulta(body.dpi);
      if (!validacion.valido) {
        set.status = 400;
        return { success: false, message: `❌ ${validacion.mensaje}` };
      }

      const resultado = await consultarMoraPorDpi(
        validacion.dpi,
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
