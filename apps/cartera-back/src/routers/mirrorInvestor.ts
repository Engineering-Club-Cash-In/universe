import { Elysia, t } from "elysia";
import { llenarTablaEspejo, getCreditsWithMirrors, getCreditsByInvestor, asignarReinversionEspejo } from "../controllers/mirrorInvestor";

export const mirrorInvestorRouter = new Elysia()
  .post("/llenar-tabla-espejo", llenarTablaEspejo, {
    query: t.Object({
      calcular_cuota: t.Optional(t.String()),
    }),
    body: t.Object({
      inversionista: t.String({ minLength: 1 }),
      creditos: t.Array(
        t.Object({
          meses_en_credito: t.Optional(t.Number()),
          cliente: t.String({ minLength: 1 }),
          numero_credito_sifco: t.Optional(t.String()),
          capital: t.Number(),
          inversor: t.Number(),
          interes_inversor: t.Number(),
          iva: t.Number(),
        }),
        { minItems: 1 }
      ),
    }),
    detail: {
      summary: "Llenar tabla espejo de inversionistas",
      description:
        "Busca inversionista por nombre y para cada crédito (buscado por nombre de cliente) inserta/actualiza en la tabla espejo. Si no encuentra padre, omite ese crédito y lo reporta. Query param calcular_cuota=true para calcular cuota_inversionista con lógica de createCredit.",
      tags: ["Inversionistas", "Espejo"],
    },
  })
  .get("/creditos-espejo", getCreditsWithMirrors, {
    detail: {
      summary: "Obtener todos los créditos con y sin espejo",
      description: "Devuelve dos listas: creditos con espejo (excluyendo inversionista 86) y creditos sin espejo.",
      tags: ["Inversionistas", "Espejo"],
    }
  })
  .get("/creditos-por-inversionista", getCreditsByInvestor, {
      query: t.Object({
          id: t.String()
      }),
      detail: {
          summary: "Obtener créditos asociados a un inversionista (Real o Espejo)",
          description: "Devuelve todos los créditos donde el ID proporcionado participa, junto con sus inversionistas originales y espejo.",
          tags: ["Inversionistas", "Espejo"]
      }
  })
  .post("/asignar-reinversion", asignarReinversionEspejo, {
      body: t.Object({
          inversionista_id: t.Number(),
          asignaciones: t.Array(
              t.Object({
                  id_inversionista: t.Number(),
                  id_credito_inversionista_espejo: t.Number(),
                  tipo_reinversion: t.Enum({
                      sin_reinversion: "sin_reinversion",
                      reinversion_capital: "reinversion_capital",
                      reinversion_interes: "reinversion_interes",
                      reinversion_total: "reinversion_total",
                      reinversion_variable: "reinversion_variable",
                      reinversion_combinada: "reinversion_combinada",
                  })
              }),
              { minItems: 0 }
          )
      }),
      detail: {
          summary: "Asignar tipo de reinversión a créditos espejo",
          description: "Recibe un arreglo con id_credito_inversionista_espejo y el tipo_reinversion para actualizar en lote.",
          tags: ["Inversionistas", "Espejo", "Reinversión"]
      }
  });

