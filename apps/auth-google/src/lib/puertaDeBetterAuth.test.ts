import { describe, expect, it } from "bun:test";
import {
  exigirPasswordPropia,
  rutaLibreConPasswordProvisionada,
  type EfectosDeLaPuerta,
} from "./puertaDeBetterAuth";

const CON_MARCA = { passwordProvisionadaAt: new Date().toISOString() };
const SIN_MARCA = { passwordProvisionadaAt: null };

const efectos = (
  cuenta: { passwordProvisionadaAt: string | Date | null } | null,
): EfectosDeLaPuerta => ({
  cuentaDeLaSesion: async () => cuenta,
});

describe("exigirPasswordPropia — lo que no se puede hacer todavía", () => {
  // El que importa. `/link-social` engancha una identidad de Google a la
  // cuenta, y esa identidad NO se va con el cambio de contraseña ni con la
  // revocación de sesiones: quien entró con la contraseña que mandamos por
  // correo se quedaba dentro para siempre, y el dueño legítimo no tenía cómo
  // echarlo.
  it("no deja enganchar una cuenta de Google", async () => {
    await expect(
      exigirPasswordPropia("/link-social", efectos(CON_MARCA)),
    ).rejects.toMatchObject({ status: "FORBIDDEN" });
  });

  it("tampoco cambiar el correo, el perfil ni borrar la cuenta", async () => {
    for (const ruta of ["/change-email", "/update-user", "/delete-user"]) {
      await expect(
        exigirPasswordPropia(ruta, efectos(CON_MARCA)),
      ).rejects.toMatchObject({ status: "FORBIDDEN" });
    }
  });

  // Lista de PERMITIDAS y no de prohibidas: los endpoints de Better Auth
  // crecen con cada versión suya, y una lista de prohibidas que se queda corta
  // no avisa — deja pasar el siguiente `/link-social` que inventen.
  it("cierra por defecto lo que no conoce", async () => {
    await expect(
      exigirPasswordPropia("/algo-que-no-existe-todavia", efectos(CON_MARCA)),
    ).rejects.toMatchObject({ status: "FORBIDDEN" });
  });
});

describe("exigirPasswordPropia — lo que tiene que seguir funcionando", () => {
  it("deja enterarse, salir del estado e irse", async () => {
    for (const ruta of [
      "/get-session",
      "/change-password",
      "/request-password-reset",
      "/reset-password",
      "/sign-out",
    ]) {
      await expect(
        exigirPasswordPropia(ruta, efectos(CON_MARCA)),
      ).resolves.toBeUndefined();
    }
  });

  // El canje llega como `/reset-password/:token`: mismo endpoint, con el token
  // en la ruta.
  it("deja canjear el enlace con el token en la ruta", async () => {
    expect(rutaLibreConPasswordProvisionada("/reset-password/abc123")).toBe(true);
  });

  // Volver a entrar con la contraseña del correo tiene que funcionar aunque el
  // navegador todavía lleve la cookie del intento anterior. Cerrarlo encerraría
  // a la persona fuera de su cuenta con la única credencial que tiene.
  it("deja volver a iniciar sesión con la contraseña que le mandamos", async () => {
    await expect(
      exigirPasswordPropia("/sign-in/email", efectos(CON_MARCA)),
    ).resolves.toBeUndefined();
  });
});

describe("exigirPasswordPropia — a quién NO le pide nada", () => {
  // `null` no significa "ya la cambió": significa "no sabemos que la suya sea
  // nuestra". Las cuentas anteriores a la columna quedan así, y a ninguna se le
  // pide nada — es el comportamiento que se quiere.
  it("no toca a las cuentas sin marca", async () => {
    await expect(
      exigirPasswordPropia("/link-social", efectos(SIN_MARCA)),
    ).resolves.toBeUndefined();
  });

  it("no toca a quien ni siquiera trae sesión", async () => {
    await expect(
      exigirPasswordPropia("/sign-up/email", efectos(null)),
    ).resolves.toBeUndefined();
  });

  it("y no le pregunta a la base por las rutas libres", async () => {
    let preguntas = 0;

    await exigirPasswordPropia("/get-session", {
      cuentaDeLaSesion: async () => {
        preguntas += 1;
        return CON_MARCA;
      },
    });

    expect(preguntas).toBe(0);
  });
});
