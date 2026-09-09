import { describe, expect, it } from "bun:test";

import { RegistroExternoError } from "../../Profile/services/registroExterno.errors";
import {
  decidirAlta,
  mensajeDeAltaFallida,
  mensajeDeCorreoCambiado,
  mensajeDeRegistroFallido,
} from "./registroPendiente";

describe("decidirAlta", () => {
  it("reintenta solo el registro externo si el alta de este ciclo es del mismo correo", () => {
    expect(
      decidirAlta({
        correoDelAlta: "ana@example.com",
        correoDeLaSesion: "ana@example.com",
        correoDelFormulario: "ana@example.com",
      }),
    ).toBe("reintentar");
  });

  // El correo del alta lo guarda el propio formulario, así que un `getSession`
  // que no responde no puede hacer que el reintento se lea como cambio de
  // correo (ni como cuenta por crear: eso duplicaría la cuenta).
  it("reintenta aunque la sesión no se pueda leer", () => {
    expect(
      decidirAlta({
        correoDelAlta: "ana@example.com",
        correoDeLaSesion: null,
        correoDelFormulario: "ana@example.com",
      }),
    ).toBe("reintentar");
  });

  // El caso que el ref en memoria no cubría: tras recargar, el formulario ya no
  // recuerda el alta, pero la sesión que dejó `signUp.email` sigue viva y
  // prueba del lado del servidor que la cuenta ya existe.
  it("reconoce el alta de un intento anterior por la sesión abierta", () => {
    expect(
      decidirAlta({
        correoDelAlta: null,
        correoDeLaSesion: "ana@example.com",
        correoDelFormulario: "ana@example.com",
      }),
    ).toBe("reintentar");
  });

  it("compara los correos sin distinguir mayúsculas ni espacios", () => {
    expect(
      decidirAlta({
        correoDelAlta: null,
        correoDeLaSesion: "  Ana@Example.com ",
        correoDelFormulario: "ana@example.com",
      }),
    ).toBe("reintentar");
  });

  // EL BUG: el registro externo falló, la persona corrigió el correo en el paso
  // 2 y volvió a enviar. La cuenta ya existe con el correo viejo y el servidor
  // ignora el del cuerpo (usa el de la sesión), así que seguir de largo la
  // dejaba registrada —en Better Auth, en CRM y en cartera— con un correo que
  // ella acababa de decidir que estaba mal, y sin ningún aviso.
  it("corta si el alta de este ciclo se hizo con otro correo", () => {
    expect(
      decidirAlta({
        correoDelAlta: "ana@example.com",
        correoDeLaSesion: "ana@example.com",
        correoDelFormulario: "ana@ejemplo.com",
      }),
    ).toBe("correo_cambiado");
  });

  // Mismo estado, otro camino: si en vez de reintentar recarga, el formulario
  // olvida el alta pero la sesión sigue abierta. Antes esto caía en el alta y
  // creaba una SEGUNDA cuenta, dejando huérfana la primera (la que lleva la
  // sesión). El desenlace tiene que ser el mismo que sin recargar.
  it("corta si la sesión abierta es de otro correo", () => {
    expect(
      decidirAlta({
        correoDelAlta: null,
        correoDeLaSesion: "ana@example.com",
        correoDelFormulario: "ana@ejemplo.com",
      }),
    ).toBe("correo_cambiado");
  });

  // Las dos evidencias en DESACUERDO, que es el caso que ninguna de las de
  // arriba pone a prueba. Pasa con dos pestañas en /register: la primera falla
  // y queda con su ref en el correo viejo, en la segunda un `signUp.email`
  // crea otra cuenta y ABRE SU SESIÓN (la cookie es del dominio), y al volver a
  // enviar en la primera el ref dice "es la mía" mientras la sesión —contra la
  // que de verdad va a correr `register-external-auth`— es de la otra cuenta.
  // La sesión manda: es la identidad que el servidor va a usar para escribir.
  it("corta si la sesión abierta es de otra cuenta, aunque el alta de este ciclo sí sea del correo del formulario", () => {
    expect(
      decidirAlta({
        correoDelAlta: "ana@example.com",
        correoDeLaSesion: "beto@example.com",
        correoDelFormulario: "ana@example.com",
      }),
    ).toBe("correo_cambiado");
  });

  // El reverso: el ref quedó en el correo viejo y la sesión es la del correo
  // que el formulario lleva AHORA. Reintentar es correcto porque el registro
  // externo va a escribir sobre esa misma cuenta.
  it("reintenta si la sesión abierta es la del correo del formulario, aunque el ref recuerde otro", () => {
    expect(
      decidirAlta({
        correoDelAlta: "ana@example.com",
        correoDeLaSesion: "beto@example.com",
        correoDelFormulario: "beto@example.com",
      }),
    ).toBe("reintentar");
  });

  it("crea la cuenta cuando no hay alta previa ni sesión", () => {
    expect(
      decidirAlta({
        correoDelAlta: null,
        correoDeLaSesion: null,
        correoDelFormulario: "ana@example.com",
      }),
    ).toBe("crear");

    expect(
      decidirAlta({
        correoDelAlta: null,
        correoDeLaSesion: "   ",
        correoDelFormulario: "ana@example.com",
      }),
    ).toBe("crear");
  });
});

describe("mensajeDeCorreoCambiado", () => {
  // La salida no es "sigue" ni "reintenta": la cuenta ya existe con el correo
  // viejo y el formulario no puede cambiarla. Hay que nombrar ese correo —si
  // fue un dedazo, es el único sitio donde la persona lo va a ver— y decir cómo
  // salir.
  it("nombra el correo con el que quedó la cuenta y cómo empezar de nuevo", () => {
    const mensaje = mensajeDeCorreoCambiado("ana@example.com");

    expect(mensaje).toContain("ana@example.com");
    expect(mensaje.toLowerCase()).toContain("cerrar sesión");
  });

  it("sigue diciendo algo útil si no se sabe el correo de la cuenta", () => {
    expect(mensajeDeCorreoCambiado("").toLowerCase()).toContain("cerrar sesión");
  });
});

describe("mensajeDeAltaFallida", () => {
  // El correo ya ocupado es el desenlace de un registro anterior a medias. La
  // recuperación vive tras iniciar sesión (el formulario de completar perfil),
  // así que hay que decirlo: antes esto devolvía sin mensaje y dejaba el
  // formulario mudo.
  it("manda a iniciar sesión cuando el correo ya está ocupado", () => {
    for (const resultado of [
      { error: { status: 422, code: "USER_ALREADY_EXISTS", message: "" } },
      { error: { status: 400, code: "USER_ALREADY_EXISTS", message: "" } },
      { error: { status: 422, code: null, message: "User already exists" } },
    ]) {
      expect(mensajeDeAltaFallida(resultado)).toContain("Inicia sesión");
    }
  });

  it("conserva el motivo cuando el servidor manda uno útil", () => {
    expect(
      mensajeDeAltaFallida({
        error: { status: 400, code: "PASSWORD_TOO_SHORT", message: "Contraseña muy corta" },
      }),
    ).toBe("Contraseña muy corta");
  });

  it("cae a un mensaje genérico cuando no hay nada aprovechable", () => {
    expect(mensajeDeAltaFallida({ error: {} })).toBeTruthy();
    expect(mensajeDeAltaFallida(undefined)).toBeTruthy();
    expect(mensajeDeAltaFallida(null)).toBeTruthy();
  });
});

describe("mensajeDeRegistroFallido", () => {
  // El camino de Google no puede marcar un campo del formulario de registro
  // (ya navegó fuera de él), pero el motivo que muestra tiene que ser EL MISMO
  // que ve quien se registra por correo: la asimetría entre los dos caminos es
  // justo lo que dejaba el 409 de Google sin decirle nada a la persona.
  it("usa el conflicto de DPI cuando el servidor lo señala", () => {
    expect(
      mensajeDeRegistroFallido(
        new RegistroExternoError(
          409,
          "dpi_ya_registrado",
          "El DPI ya está registrado en otra cuenta",
        ),
      ),
    ).toBe("El DPI ya está registrado en otra cuenta");

    expect(
      mensajeDeRegistroFallido(
        new RegistroExternoError(400, "dpi_invalido", "El DPI no es válido"),
      ),
    ).toBe("El DPI no es válido");
  });

  it("conserva el motivo de un fallo cualquiera", () => {
    expect(mensajeDeRegistroFallido(new Error("La red falló"))).toBe(
      "La red falló",
    );
  });

  it("cae a un mensaje genérico cuando no hay motivo aprovechable", () => {
    expect(mensajeDeRegistroFallido(new Error(""))).toBeTruthy();
    expect(mensajeDeRegistroFallido(undefined)).toBeTruthy();
    expect(mensajeDeRegistroFallido({})).toBeTruthy();
  });
});
