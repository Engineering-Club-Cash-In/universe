import { describe, expect, it } from "bun:test";
import { verificarSecretoProvisionamiento } from "../lib/provisioningSecret";

describe("verificarSecretoProvisionamiento", () => {
  it("acepta el secreto correcto", () => {
    expect(verificarSecretoProvisionamiento("s3cr3to", "s3cr3to")).toBe("ok");
  });

  it("rechaza el equivocado", () => {
    expect(verificarSecretoProvisionamiento("otro", "s3cr3to")).toBe("invalido");
    expect(verificarSecretoProvisionamiento(null, "s3cr3to")).toBe("invalido");
    expect(verificarSecretoProvisionamiento("", "s3cr3to")).toBe("invalido");
  });

  it("sin secreto configurado NADIE pasa, ni siquiera mandando vacío", () => {
    // Fail-closed. Comparar contra "" convertiría un deploy sin la env en un
    // endpoint interno abierto: cualquiera podría crear cuentas y disparar
    // correos con contraseñas.
    expect(verificarSecretoProvisionamiento("", "")).toBe("no_configurado");
    expect(verificarSecretoProvisionamiento("lo-que-sea", undefined)).toBe("no_configurado");
    expect(verificarSecretoProvisionamiento("lo-que-sea", "   ")).toBe("no_configurado");
  });

  it("compara sin filtrar la longitud del secreto", () => {
    // Dos largos distintos no deben resolverse antes: se compara en tiempo
    // constante sobre un digest de largo fijo.
    expect(verificarSecretoProvisionamiento("x", "secreto-largo")).toBe("invalido");
    expect(verificarSecretoProvisionamiento("secreto-larguisimo-mas", "corto")).toBe("invalido");
  });
});
