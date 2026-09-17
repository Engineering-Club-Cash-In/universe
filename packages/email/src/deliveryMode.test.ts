import { describe, expect, it } from "bun:test";
import { resolveEmailDeliveryMode } from "./deliveryMode";

// Por qué existe este test: con SERVER != PROD el paquete redirige TODOS los
// correos a una sola bandeja. Quien provisiona cuentas necesita SABER que eso
// está pasando, porque si no, crea cuentas cuyas contraseñas nunca llegan a su
// dueño y el fallo es invisible (la única evidencia del envío es la cuenta).

describe("resolveEmailDeliveryMode", () => {
  it("con SERVER=PROD entrega a los destinatarios reales", () => {
    expect(resolveEmailDeliveryMode({ SERVER: "PROD" })).toEqual({
      server: "PROD",
      redirige: false,
      destinatarioUnico: null,
    });
  });

  it("acepta PROD en minúsculas: la env se compara sin importar la caja", () => {
    expect(resolveEmailDeliveryMode({ SERVER: "prod" }).redirige).toBe(false);
  });

  it("sin SERVER seteada redirige, porque el default del paquete es DEV", () => {
    expect(resolveEmailDeliveryMode({})).toEqual({
      server: "DEV",
      redirige: true,
      destinatarioUnico: "jalvarado@clubcashin.com",
    });
  });

  it("informa el destinatario único real cuando EMAIL_DEV_RECIPIENT lo cambia", () => {
    expect(
      resolveEmailDeliveryMode({ SERVER: "QA", EMAIL_DEV_RECIPIENT: "qa@x.com" }),
    ).toEqual({ server: "QA", redirige: true, destinatarioUnico: "qa@x.com" });
  });
});
