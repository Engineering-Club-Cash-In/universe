import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * El proxy de cartera enumera UNA POR UNA las rutas que expone al portal, y esa
 * enumeración es un límite de seguridad, no una comodidad: `requireAuth` de
 * `cartera.routes.ts` no mira el rol —no puede, el portal la usa con sesiones
 * INVESTOR normales— y el sign-up de Better Auth está abierto y sin verificar
 * el correo, así que cualquiera se fabrica una sesión válida. Lo único que
 * separa al anónimo de una ruta de cartera es que su nombre NO esté en este
 * archivo.
 *
 * Se prueba leyendo el archivo porque lo que hay que sostener es justo eso: que
 * nadie agregue el reenvío. Una prueba que levantara el server probaría el
 * comportamiento de hoy; esta protege la decisión.
 */

const fuente = readFileSync(join(__dirname, "cartera.routes.ts"), "utf8");

describe("superficie del proxy /api/cartera", () => {
  it("NO expone el endpoint que abre accesos al portal", () => {
    // `POST /investor/portal-access` crea la cuenta y manda la contraseña.
    // Es un acto de back office: se dispara desde carteraFront con un ADMIN,
    // mirando a quién se le está abriendo. Proxearlo lo devolvería a manos de
    // cualquiera con una sesión, que es el agujero que se cerró.
    expect(fuente).not.toContain("portal-access");
  });

  it("sigue quitando `provisionar_portal` del cuerpo que reenvía", () => {
    // El otro candado del mismo agujero, por el camino del alta.
    expect(fuente).toContain("provisionar_portal");
    expect(fuente).toContain("_descartado");
  });
});
