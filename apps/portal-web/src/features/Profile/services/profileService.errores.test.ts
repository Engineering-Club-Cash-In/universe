import { beforeEach, describe, expect, it, mock } from "bun:test";
import { AxiosError, AxiosHeaders } from "axios";

// El servicio habla con auth-google a través de esta instancia; se reemplaza
// para poder provocar los dos rechazos que le llegan al usuario: el de red
// (sin `response`) y el del servidor (con `{ error: { message } }`).
const get = mock(async (_url: string) => ({ data: { data: null } }));
const post = mock(async (_url: string, _body?: unknown) => ({
  data: { success: true },
}));

mock.module("@/lib/api/apiAuth", () => ({
  default: { get, post },
  apiAuth: { get, post },
}));

const { getNumbersSifco, getProfile, updateLead } = await import(
  "./profileService"
);

/** Fallo de red o timeout: axios lo lanza SIN `response`. */
const errorDeRed = (mensaje: string) =>
  new AxiosError(mensaje, AxiosError.ERR_NETWORK, {
    headers: new AxiosHeaders(),
  });

/** Rechazo del servidor: auth-google serializa `{ error: { message } }`. */
const rechazoDelServidor = (mensaje: string) => {
  const error = new AxiosError("Request failed with status code 409", "409", {
    headers: new AxiosHeaders(),
  });
  error.response = {
    status: 409,
    statusText: "Conflict",
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: { success: false, error: { message: mensaje } },
  };
  return error;
};

const motivo = async (llamada: Promise<unknown>) => {
  try {
    await llamada;
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("se esperaba un rechazo");
};

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

describe("updateLead", () => {
  // El guard viejo (`error instanceof Error && !error.response`) dejaba pasar
  // también al AxiosError de red, que cumple las dos condiciones: el usuario
  // terminaba leyendo "Network Error" o "timeout of 5000ms exceeded".
  it("no le muestra al usuario el error crudo de axios cuando se cae la red", async () => {
    post.mockImplementation(async () => {
      throw errorDeRed("Network Error");
    });

    expect(await motivo(updateLead({ email: "a@b.com" }))).toBe(
      "Error al actualizar la información",
    );

    post.mockImplementation(async () => {
      throw errorDeRed("timeout of 5000ms exceeded");
    });

    expect(await motivo(updateLead({ email: "a@b.com" }))).toBe(
      "Error al actualizar la información",
    );
  });

  it("muestra el motivo que manda el servidor", async () => {
    post.mockImplementation(async () => {
      throw rechazoDelServidor("El DPI ya está registrado en otra cuenta");
    });

    expect(await motivo(updateLead({ email: "a@b.com" }))).toBe(
      "El DPI ya está registrado en otra cuenta",
    );
  });

  // El `throw` de dentro del `try` (cuando el CRM contesta 200 con
  // `success: false`) cae en el mismo `catch` y tiene que sobrevivir.
  it("relanza tal cual el rechazo que arma el propio servicio", async () => {
    post.mockImplementation(async () => ({
      data: { success: false, error: { message: "Tenés mora activa" } },
    }));

    expect(await motivo(updateLead({ email: "a@b.com" }))).toBe(
      "Tenés mora activa",
    );
  });
});

describe("getProfile / getNumbersSifco", () => {
  it("no le muestran [object Object] cuando auth-google anida el motivo", async () => {
    get.mockImplementation(async () => {
      throw rechazoDelServidor("No encontramos tu perfil");
    });

    expect(await motivo(getProfile("a@b.com"))).toBe("No encontramos tu perfil");
    expect(await motivo(getNumbersSifco("a@b.com"))).toBe(
      "No encontramos tu perfil",
    );
  });

  it("conservan status y data para quien los lea", async () => {
    get.mockImplementation(async () => {
      throw rechazoDelServidor("No encontramos tu perfil");
    });

    try {
      await getProfile("a@b.com");
      throw new Error("se esperaba un rechazo");
    } catch (error) {
      expect((error as { status?: number }).status).toBe(409);
      expect((error as { data?: unknown }).data).toEqual({
        success: false,
        error: { message: "No encontramos tu perfil" },
      });
    }
  });

  it("caen al texto en español cuando se cae la red", async () => {
    get.mockImplementation(async () => {
      throw errorDeRed("Network Error");
    });

    expect(await motivo(getProfile("a@b.com"))).toBe("Error al cargar el perfil");
    expect(await motivo(getNumbersSifco("a@b.com"))).toBe(
      "Error al cargar los números Sifco",
    );
  });
});
