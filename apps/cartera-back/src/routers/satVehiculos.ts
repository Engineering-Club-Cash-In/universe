import { Elysia } from "elysia";
import { obtenerVehiculosPropios } from "../controllers/satVehiculos";
import { authMiddleware } from "./midleware";

export const satVehiculosRouter = new Elysia({ prefix: "/sat-vehiculos" })
  .use(authMiddleware)
  .get(
  "/propios",
  async ({ set }) => {
    const resultado = await obtenerVehiculosPropios();

    // 502 cuando el fallo viene de SAT: deja que el CRM distinga un problema
    // externo de un error propio, aunque el cuerpo llegue igual en ambos casos.
    if (resultado.estado !== "OK") {
      set.status = 502;
    }

    return resultado;
  },
  {
    detail: {
      summary: "Consultar Vehículos Propios en Agencia Virtual de SAT",
      description:
        "Inicia sesión en Agencia Virtual con las credenciales del entorno y devuelve el listado de vehículos propios con su estado. No persiste nada: el CRM guarda y cruza.",
      tags: ["SAT Vehículos"],
    },
  },
);
