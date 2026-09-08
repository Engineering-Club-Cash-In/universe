import { describe, expect, it } from "bun:test";
import { APIError } from "better-auth/api";
import {
  antesDeCambiarPassword,
  cuerpoForzadoDelCambio,
  despuesDeCambiarPassword,
  RUTA_RESET_DE_PASSWORD,
  type EfectosAntesDelCambio,
  type EfectosDespuesDelCambio,
  type PeticionDeCambio,
} from "./hooksDePassword";
import { RUTA_CAMBIO_DE_PASSWORD } from "./cambioDePassword";
import type { PruebaDeIdentidad } from "./passwordDistinta";

const USER = "usr_1";
const TOKEN = "tok-vigente";

type Registro = {
  distintas: { userId: string; nueva: string; prueba: PruebaDeIdentidad }[];
  borrados: { userId: string; tokenEnUso: string | null }[];
};

const efectosAntes = (
  ajustes: Partial<EfectosAntesDelCambio> = {},
): EfectosAntesDelCambio & Registro => {
  const distintas: Registro["distintas"] = [];
  const borrados: Registro["borrados"] = [];

  return {
    distintas,
    borrados,
    usuarioDeLaSesion: async () => USER,
    usuarioDelEnlaceVigente: async (token) => (token === TOKEN ? USER : null),
    exigirDistinta: async (userId, nueva, prueba) => {
      distintas.push({ userId, nueva, prueba });
    },
    invalidarEnlaces: async (userId, tokenEnUso) => {
      borrados.push({ userId, tokenEnUso });
    },
    // Por defecto la contraseña actual cuadra: el caso normal del formulario.
    credencialProbada: async () => true,
    invalidarTodosLosEnlaces: async (userId) => {
      borrados.push({ userId, tokenEnUso: null });
    },
    ...ajustes,
  };
};

/** Los mismos que Better Auth. */
const LARGOS = { min: 8, max: 128 };

const peticionDeSesion = (
  ajustes: Partial<PeticionDeCambio> = {},
): PeticionDeCambio => ({
  path: RUTA_CAMBIO_DE_PASSWORD,
  nueva: "una-nueva-larga",
  actual: "la-que-tiene-puesta",
  token: undefined,
  limites: LARGOS,
  ...ajustes,
});

describe("antesDeCambiarPassword — camino de la sesión", () => {
  // El borrado corría acá sin probar nada, ANTES de que Better Auth mirara la
  // contraseña actual. O sea: cualquiera con la cookie de sesión —o el dueño
  // mismo con un dedazo— destruía los enlaces pendientes en un intento que no
  // cambiaba nada. Quien acababa de pedir un correo de recuperación se quedaba
  // sin él por equivocarse al teclear.
  it("no le borra a nadie los enlaces si la contraseña actual no cuadra", async () => {
    const efectos = efectosAntes({ credencialProbada: async () => false });

    await antesDeCambiarPassword(peticionDeSesion(), efectos);

    expect(efectos.borrados).toEqual([]);
  });

  // Y con la credencial probada sí borra, en el `before`. Mudarlo al `after`
  // evitaba el destrozo de arriba pero volvía la invalidación un "si se puede":
  // con la contraseña ya cambiada, un DELETE que falla deja 24 horas de enlaces
  // vivos para pisarla.
  it("borra los enlaces cuando la contraseña actual ya se probó", async () => {
    const efectos = efectosAntes();

    await antesDeCambiarPassword(peticionDeSesion(), efectos);

    expect(efectos.borrados).toEqual([{ userId: USER, tokenEnUso: null }]);
  });

  it("rechaza el cambio si la base no deja invalidarlos", async () => {
    const efectos = efectosAntes({
      invalidarTodosLosEnlaces: async () => {
        throw new Error("la base no responde");
      },
    });

    await expect(
      antesDeCambiarPassword(peticionDeSesion(), efectos),
    ).rejects.toThrow();
  });

  it("sigue comprobando que la nueva sea distinta, con la contraseña actual como prueba", async () => {
    const efectos = efectosAntes();

    await antesDeCambiarPassword(peticionDeSesion(), efectos);

    expect(efectos.distintas).toEqual([
      {
        userId: USER,
        nueva: "una-nueva-larga",
        prueba: { via: "sesion", actual: "la-que-tiene-puesta" },
      },
    ]);
  });

  it("no hace nada sin sesión: contesta el 401 de Better Auth", async () => {
    const efectos = efectosAntes({ usuarioDeLaSesion: async () => null });

    await antesDeCambiarPassword(peticionDeSesion(), efectos);

    expect(efectos.distintas).toEqual([]);
    expect(efectos.borrados).toEqual([]);
  });

  // El portal solo valida el mínimo, así que una contraseña más larga que el
  // máximo de Better Auth llegaba hasta acá: pasaba la prueba de credencial, se
  // llevaba por delante todos los enlaces pendientes y recién después la
  // rechazaba él. Enlaces perdidos y contraseña sin cambiar.
  it("no toca nada si la contraseña nueva no va a pasar el largo", async () => {
    const efectos = efectosAntes();

    await antesDeCambiarPassword(
      peticionDeSesion({ nueva: "x".repeat(LARGOS.max + 1) }),
      efectos,
    );

    expect(efectos.borrados).toEqual([]);
    expect(efectos.distintas).toEqual([]);
  });

  it("tampoco por debajo del mínimo", async () => {
    const efectos = efectosAntes();

    await antesDeCambiarPassword(peticionDeSesion({ nueva: "corta" }), efectos);

    expect(efectos.borrados).toEqual([]);
  });
});

describe("antesDeCambiarPassword — camino del enlace", () => {
  const peticionDeEnlace = (
    ajustes: Partial<PeticionDeCambio> = {},
  ): PeticionDeCambio => ({
    path: RUTA_RESET_DE_PASSWORD,
    nueva: "una-nueva-larga",
    actual: undefined,
    token: TOKEN,
    limites: LARGOS,
    ...ajustes,
  });

  it("mata los enlaces hermanos ANTES del cambio y respeta el que se canjea", async () => {
    // Acá el `before` sí es el lugar: el token vigente ya probó identidad, y
    // hacerlo después dejaba el caso sin salida —si el DELETE falla, la
    // contraseña ya cambió y los enlaces viejos siguen sirviendo 24 horas.
    const efectos = efectosAntes();

    await antesDeCambiarPassword(peticionDeEnlace(), efectos);

    expect(efectos.borrados).toEqual([{ userId: USER, tokenEnUso: TOKEN }]);
    expect(efectos.distintas[0]?.prueba).toEqual({ via: "enlace" });
  });

  it("no toca nada con un enlace vencido o inexistente", async () => {
    const efectos = efectosAntes();

    await antesDeCambiarPassword(peticionDeEnlace({ token: "viejo" }), efectos);

    expect(efectos.borrados).toEqual([]);
    expect(efectos.distintas).toEqual([]);
  });

  it("rechaza el cambio si la base no deja invalidarlos", async () => {
    const efectos = efectosAntes({
      invalidarEnlaces: async () => {
        throw new Error("la base no responde");
      },
    });

    await expect(
      antesDeCambiarPassword(peticionDeEnlace(), efectos),
    ).rejects.toMatchObject({ status: "INTERNAL_SERVER_ERROR" });
  });

  it("deja viajar el rechazo por contraseña repetida", async () => {
    const efectos = efectosAntes({
      exigirDistinta: async () => {
        throw new APIError("BAD_REQUEST", { message: "tiene que ser distinta" });
      },
    });

    await expect(
      antesDeCambiarPassword(peticionDeEnlace(), efectos),
    ).rejects.toMatchObject({ status: "BAD_REQUEST" });
  });
});

const efectosDespues = (
  ajustes: Partial<EfectosDespuesDelCambio> = {},
): EfectosDespuesDelCambio & { borrados: string[]; marcados: string[] } => {
  const borrados: string[] = [];
  const marcados: string[] = [];

  return {
    borrados,
    marcados,
    invalidarEnlaces: async (userId) => {
      borrados.push(userId);
    },
    registrarPasswordPropia: async (userId) => {
      marcados.push(userId);
    },
    ...ajustes,
  };
};

describe("despuesDeCambiarPassword", () => {
  const exito = { token: "tok", user: { id: USER } };

  it("mata los enlaces pendientes una vez que el cambio ya ocurrió", async () => {
    // Después y no antes: un token emitido mientras el cambio estaba en vuelo
    // no estaba entre las filas que borraba el `before`, y sobrevivía al cambio
    // con sus 24 horas completas. Borrando desde acá, ese token ya existe
    // cuando corre el DELETE y cae con los demás.
    const efectos = efectosDespues();

    await despuesDeCambiarPassword(RUTA_CAMBIO_DE_PASSWORD, exito, efectos);

    expect(efectos.borrados).toEqual([USER]);
    expect(efectos.marcados).toEqual([USER]);
  });

  it("no borra nada cuando el intento falló", async () => {
    const fallo = Object.assign(new Error("INVALID_PASSWORD"), {
      status: "BAD_REQUEST",
    });
    const efectos = efectosDespues();

    await despuesDeCambiarPassword(RUTA_CAMBIO_DE_PASSWORD, fallo, efectos);
    await despuesDeCambiarPassword("/sign-in/email", exito, efectos);

    expect(efectos.borrados).toEqual([]);
    expect(efectos.marcados).toEqual([]);
  });

  it("no convierte un cambio exitoso en un 500 si el borrado revienta", async () => {
    // La contraseña YA cambió cuando esto corre. Tirar acá le diría a la
    // persona que falló y la haría reintentar con una contraseña que ya no es
    // la suya. Queda en el log y la marca de primer ingreso igual se limpia.
    const efectos = efectosDespues({
      invalidarEnlaces: async () => {
        throw new Error("la base no responde");
      },
    });

    await despuesDeCambiarPassword(RUTA_CAMBIO_DE_PASSWORD, exito, efectos);

    expect(efectos.marcados).toEqual([USER]);
  });
});

// `revokeOtherSessions` es un campo del CUERPO, o sea del navegador. Que la
// pantalla de primer ingreso mande `true` es una costumbre suya, no una
// garantía: un `curl` que lo omita cambia la contraseña sin cerrar nada, y el
// `after` limpia la marca igual porque el cambio salió bien. La otra sesión
// —la que se abrió con la contraseña que mandamos por correo— sigue viva y
// ahora además pasa las dos puertas.
describe("cuerpoForzadoDelCambio", () => {
  const CUERPO = { currentPassword: "la-que-le-dimos", newPassword: "la-suya" };

  it("obliga a cerrar las otras sesiones al cambiar la contraseña", () => {
    expect(cuerpoForzadoDelCambio(RUTA_CAMBIO_DE_PASSWORD, CUERPO)).toEqual({
      ...CUERPO,
      revokeOtherSessions: true,
    });
  });

  // El cuerpo sale ENTERO, no solo la llave forzada. Devolver únicamente la
  // llave funciona hoy porque Better Auth funde los contextos con `defu`, que
  // entra en los objetos; pero eso es un detalle suyo, no una promesa, y el día
  // que ahí hubiera un `Object.assign` el cuerpo se quedaría sin las
  // contraseñas y nadie podría elegir la suya: la pantalla de primer ingreso se
  // quedaría sin salida.
  it("no se lleva por delante las contraseñas que venían en la petición", () => {
    const forzado = cuerpoForzadoDelCambio(RUTA_CAMBIO_DE_PASSWORD, CUERPO);

    expect(forzado?.currentPassword).toBe("la-que-le-dimos");
    expect(forzado?.newPassword).toBe("la-suya");
  });

  it("pisa el `false` que mande el cliente", () => {
    const forzado = cuerpoForzadoDelCambio(RUTA_CAMBIO_DE_PASSWORD, {
      ...CUERPO,
      revokeOtherSessions: false,
    });

    expect(forzado?.revokeOtherSessions).toBe(true);
  });

  it("aguanta una petición sin cuerpo", () => {
    expect(cuerpoForzadoDelCambio(RUTA_CAMBIO_DE_PASSWORD, undefined)).toEqual({
      revokeOtherSessions: true,
    });
  });

  // Se fuerza en vez de exigirse: un 400 ante un cliente que lo omita dejaría a
  // esa persona sin forma de salir del primer ingreso.
  it("no se mete con ningún otro endpoint", () => {
    expect(cuerpoForzadoDelCambio(RUTA_RESET_DE_PASSWORD, CUERPO)).toBeNull();
    expect(cuerpoForzadoDelCambio("/sign-in/email", CUERPO)).toBeNull();
    expect(cuerpoForzadoDelCambio(undefined, CUERPO)).toBeNull();
  });
});
