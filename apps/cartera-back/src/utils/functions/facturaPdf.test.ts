import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { getLogoParaPDF } from "./facturaPdf";

describe("getLogoParaPDF", () => {
  let fetchCallsByUrl: Record<string, number> = {};
  let originalFetch: typeof fetch;

  beforeEach(() => {
    fetchCallsByUrl = {};
    originalFetch = globalThis.fetch;

    globalThis.fetch = (async (url: string | Request | URL) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      fetchCallsByUrl[urlStr] = (fetchCallsByUrl[urlStr] || 0) + 1;

      // Hacer que cada URL devuelva un buffer distinto
      const buffer = new Uint8Array([
        ...Buffer.from(urlStr),
        1,
        2,
        3,
      ]);
      return new Response(buffer, {
        headers: { "content-type": "image/png" },
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("hace una sola descarga para dos llamadas a la misma URL", async () => {
    const url = "https://example.com/logo.png";
    const promise1 = getLogoParaPDF(url);
    const promise2 = getLogoParaPDF(url);

    const result1 = await promise1;
    const result2 = await promise2;

    expect(result1).toBe(result2);
    expect(fetchCallsByUrl[url]).toBe(1);
  });

  it("hace descargas separadas para URLs distintas", async () => {
    const url1 = "https://example.com/logo1.png";
    const url2 = "https://example.com/logo2.png";

    const result1 = await getLogoParaPDF(url1);
    const result2 = await getLogoParaPDF(url2);

    expect(result1).not.toBe(result2);
    expect(fetchCallsByUrl[url1]).toBe(1);
    expect(fetchCallsByUrl[url2]).toBe(1);
  });

  it("reintenta la descarga si falla", async () => {
    const url = "https://example.com/logo-falla.png";
    let intentos = 0;

    globalThis.fetch = (async (u: string | Request | URL) => {
      const urlStr = typeof u === "string" ? u : u.toString();
      if (urlStr === url) {
        intentos++;
        if (intentos === 1) {
          throw new Error("Network error");
        }
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/png" },
        });
      }
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/png" },
      });
    }) as typeof fetch;

    // Primer intento falla
    const result1 = await getLogoParaPDF(url);
    expect(result1).toBe(url); // devuelve la URL remota en caso de error

    // Segundo intento exitoso
    const result2 = await getLogoParaPDF(url);
    expect(result2).toContain("data:image/png;base64");
    expect(intentos).toBe(2);
  });

  it("devuelve un data URI válido con formato base64", async () => {
    const url = "https://example.com/logo.png";
    const result = await getLogoParaPDF(url);

    expect(result).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/);
  });
});
