import { Elysia, t } from "elysia";
import {
  listModalidadFacturacionSpread,
  listModalidadFacturacionByMonto,
  listModalidadFacturacionSpreadByModalidad,
} from "../controllers/modalidadFacturacion";
import { authMiddleware } from "./midleware";

export const modalidadFacturacionRouter = new Elysia()
  .use(authMiddleware)
  /**
   * GET /modalidad-facturacion/spread
   * Devuelve el catálogo completo (todas las combinaciones bracket × modalidad),
   * ordenado por monto_desde y modalidad.
   * Response: { data: [{ id, monto_desde, monto_hasta, modalidad, spread, tasa }] }
   */
  .get("/modalidad-facturacion/spread", async ({ set }) => {
    try {
      const result = await listModalidadFacturacionSpread();
      set.status = 200;
      return result;
    } catch (error) {
      set.status = 500;
      return {
        message: "Error obteniendo catálogo de modalidad de facturación",
        error: String(error),
      };
    }
  })

  /**
   * GET /modalidad-facturacion/spread/resolver?monto=150000
   * Dado un monto aportado, devuelve las 3 modalidades del bracket
   * correspondiente (cada una con su spread y su tasa), para que el front
   * muestre las opciones. 404 si el monto no cae en ningún bracket (ej. por
   * debajo del mínimo Q25,000).
   * Response: { data: [{ id, monto_desde, monto_hasta, modalidad, spread, tasa }] }
   */
  .get(
    "/modalidad-facturacion/spread/resolver",
    async ({ query, set }) => {
      const monto = Number(query.monto);
      if (!Number.isFinite(monto) || monto <= 0) {
        set.status = 400;
        return { message: "El parámetro 'monto' debe ser un número positivo" };
      }
      try {
        const result = await listModalidadFacturacionByMonto(monto);
        if (result.data.length === 0) {
          set.status = 404;
          return {
            message: `No hay un bracket de modalidad de facturación para el monto Q${monto}`,
          };
        }
        set.status = 200;
        return result;
      } catch (error) {
        set.status = 500;
        return {
          message: "Error resolviendo modalidad de facturación",
          error: String(error),
        };
      }
    },
    {
      query: t.Object({
        monto: t.String(),
      }),
    },
  )

  /**
   * GET /modalidad-facturacion/spread/por-modalidad?modalidad=p2p_directa
   * Devuelve las 8 filas (una por bracket) de una modalidad, sin filtrar por
   * monto. Lo usa el front para poblar el combobox de anulación manual del
   * spread (el operador puede elegir cualquiera de los 8, sin importar el
   * monto de la compra).
   * Response: { data: [{ id, monto_desde, monto_hasta, modalidad, spread, tasa }] }
   */
  .get(
    "/modalidad-facturacion/spread/por-modalidad",
    async ({ query, set }) => {
      try {
        const result = await listModalidadFacturacionSpreadByModalidad(
          query.modalidad,
        );
        set.status = 200;
        return result;
      } catch (error) {
        set.status = 500;
        return {
          message: "Error obteniendo catálogo por modalidad",
          error: String(error),
        };
      }
    },
    {
      query: t.Object({
        modalidad: t.Union([
          t.Literal("p2p_directa"),
          t.Literal("factura_cube"),
          t.Literal("factura_cube_pequeno"),
        ]),
      }),
    },
  );
