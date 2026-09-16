import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildPortalInvestorUpdate } from "../lib/portalInvestorPayload";

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

  // El otro candado del mismo agujero, por el camino del alta. La garantía es
  // la misma —`provisionar_portal` no llega a cartera desde el portal— pero el
  // mecanismo cambió al integrar el PR #1545, así que la prueba también.
  //
  // Antes se le QUITABA la llave al cuerpo crudo que se reenviaba (blacklist), y
  // esto lo comprobaba buscando su nombre en el archivo. Ya no se reenvía nada
  // crudo: `buildPortalInvestorUpdate` ARMA un cuerpo nuevo con los únicos tres
  // campos editables (whitelist). Es estrictamente más fuerte, porque también
  // frena las llaves peligrosas que nadie previó —`dpi_rep_legal`, que concede
  // acceso a las entidades de otro, es el ejemplo que motivó el cambio—, pero
  // hace que el nombre de la llave ya NO aparezca en el archivo.
  //
  // Por eso se prueba la propiedad y no el texto: buscar "provisionar_portal"
  // aquí solo probaría que seguimos usando una blacklist que ya no existe.
  it("nunca reenvía `provisionar_portal` a cartera", () => {
    const payload = buildPortalInvestorUpdate(77, {
      numero_cuenta: "0011223344",
      provisionar_portal: true,
      dpi_rep_legal: "1234567890123",
      nombre: "Atacante",
    });

    expect(payload).not.toHaveProperty("provisionar_portal");
    expect(payload).not.toHaveProperty("dpi_rep_legal");
    expect(payload).not.toHaveProperty("nombre");
    expect(payload).toEqual({
      inversionista_id: 77,
      numero_cuenta: "0011223344",
    });
  });

  // La whitelist solo sirve si el handler la USA: si alguien volviera a mandar
  // `body` a cartera, la prueba de arriba seguiría pasando y el agujero estaría
  // abierto otra vez. Esto es lo que se lee del archivo.
  it("el handler manda a cartera la whitelist, nunca el cuerpo recibido", () => {
    expect(fuente).toContain(
      "buildPortalInvestorUpdate(entidad.inversionista_id, body)",
    );
    expect(fuente).toContain("createInvestor(payload)");
    expect(fuente).not.toContain("createInvestor(body");
  });
});
