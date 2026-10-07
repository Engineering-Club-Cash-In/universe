import { describe, expect, test } from "bun:test";
import { crearTokenUserNexa, NexaServerError } from "./nexaServerClient";

const params = { creditoId: 55, description: "Crédito 1 · Ana", nationalId: "1234567890123" };
const opts = (fetchImpl: typeof fetch) => ({ baseUrl: "http://nexa.test", apiKey: "k", fetchImpl });

describe("crearTokenUserNexa", () => {
  test("manda el Bearer y devuelve el token", async () => {
    let auth = "";
    const r = await crearTokenUserNexa(
      params,
      opts((async (_url: string, init: RequestInit) => {
        auth = String((init.headers as Record<string, string>).Authorization);
        return Response.json({ creditoId: 55, identifier: "100000002", nexaUserId: 99, token: "32200100000002", nationalId: "x" }, { status: 201 });
      }) as unknown as typeof fetch),
    );
    expect(auth).toBe("Bearer k");
    expect(r).toEqual({ creditoId: 55, identifier: "100000002", nexaUserId: 99, token: "32200100000002" });
  });

  test("un rechazo de Nexa sale como error con el detalle", async () => {
    const p = crearTokenUserNexa(
      params,
      opts((async () => Response.json({ error: "Nexa rejected token user 100000002: CUI no es válido." }, { status: 422 })) as unknown as typeof fetch),
    );
    await expect(p).rejects.toThrow("nexa-server respondió 422: Nexa rejected token user 100000002: CUI no es válido.");
  });

  test("respuesta de otro crédito se rechaza", async () => {
    const p = crearTokenUserNexa(
      params,
      opts((async () => Response.json({ creditoId: 1, identifier: "1", nexaUserId: 1, token: "1" })) as unknown as typeof fetch),
    );
    await expect(p).rejects.toBeInstanceOf(NexaServerError);
  });

  test("sin configuración no llama a nadie", async () => {
    await expect(crearTokenUserNexa(params, { baseUrl: "", apiKey: "" })).rejects.toThrow("no está configurado");
  });
});
