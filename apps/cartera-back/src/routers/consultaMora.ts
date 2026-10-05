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
   * Body: { dpi, numerosCreditoConocidos?, numerosCreditoGarantizados? }
   * Responde si el DPI corresponde a un cliente y si puede avanzar una nueva
   * solicitud. El veredicto para el gate del CRM es `puedeContinuar`.
   *
   * Siempre responde 200 con el contrato completo, incluso ante un fallo
   * técnico: el veredicto fail-closed viaja en el cuerpo
   * (`puedeContinuar: false`, `motivo: "SERVICIO_NO_DISPONIBLE"`) y un 5xx
   * correría el riesgo de que el CRM descarte el cuerpo y pierda el veredicto.
   * `motivo` es lo que distingue el fallo técnico de un "no tiene mora".
   *
   * `numerosCreditoConocidos` son los números de crédito que el llamador
   * asocia a ese DPI, y son la ÚNICA fuente: cartera ya no resuelve el DPI
   * contra nadie —ni la pasarela de SIFCO, ni el espejo, ni su propia base,
   * que no guarda DPI—, así que lo que no venga en esa lista no existe para
   * este endpoint. El CRM la arma con su propio join `leads.dpi` ↔
   * `opportunities.numeroSifco`. Ver `consultarMoraPorDpi` en el controller.
   *
   * Consecuencia directa: **una lista vacía devuelve `puedeContinuar: true`
   * con `motivo: "CLIENTE_NO_ENCONTRADO"`**. Sin números no hay a quién mirar,
   * y decir "no encontrado" es lo único honesto que cartera puede responder
   * —es la misma conducta que ya tenía un DPI sin ficha—. El gate cubre lo que
   * el llamador conoce, no la cartera entera.
   *
   * El tope de 50 es holgado para el caso real —las oportunidades ganadas de
   * un lead— y evita que un cuerpo grande se convierta en un `IN (...)` sin
   * fin.
   *
   * 🔴 `numerosCreditoConocidos` es un CANAL CONFIADO y cartera no puede
   * verificarlo: la asociación DPI ↔ número de crédito del CRM vive en el CRM,
   * no acá, así que cartera toma la palabra de quien llama. Que ahora sea la
   * ÚNICA fuente hace que esto pese MÁS, no menos: no queda ningún segundo
   * origen que contradiga un número inventado. Las consecuencias
   * de un número ajeno son dos: (1) ese crédito entra al veredicto y puede
   * bloquear a un DPI que no le debe nada a nadie, y (2) la expansión por dueño
   * (`usuario_id`) le cuelga al DPI consultado la cartera COMPLETA del titular
   * de ese número, que además viaja visible en `creditos`/`historialMora`. Por
   * eso el gate de rol de abajo no es cosmético: es lo único que separa este
   * canal de cualquier token vivo. Para el CRM —canal interno, personal de la
   * casa— es aceptable; abrirlo a un rol de afuera no lo sería.
   *
   * `numerosCreditoGarantizados` son los créditos que este DPI AFIANZÓ (el CRM
   * los saca de las filas de co-deudor). Entran al veredicto igual que los
   * demás —si lo que firmó está en mora, bloquea— pero NO disparan la expansión
   * por dueño: **el fiador responde por lo que garantizó, no por la vida entera
   * del titular**. Con la expansión, afianzar un crédito sano bastaba para
   * heredar la cartera COMPLETA del titular: el fiador quedaba bloqueado por
   * una mora ajena a lo garantizado y la respuesta le mostraba al CRM la
   * historia crediticia entera de ese tercero. Ver `usuariosParaExpandir`.
   *
   * ⏱️ Las lecturas de cartera (créditos con mora, y el historial) corren bajo
   * UN presupuesto global de 15s; ver `PRESUPUESTO_NUMEROS_GATE_MS` en el
   * controller. Al vencerse sale SERVICIO_NO_DISPONIBLE, fail-closed.
   *
   * Las únicas respuestas que no son 200 son el 403 del gate de rol (ver
   * `ROLES_CONSULTA_MORA`) y el 400 de validación del DPI: un valor que no son
   * 13 dígitos ni siquiera llega al controller, y decirle
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
        body.numerosCreditoConocidos,
        body.numerosCreditoGarantizados
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
        numerosCreditoGarantizados: t.Optional(
          t.Array(t.String(), { maxItems: 50 })
        ),
      }),
    }
  );
