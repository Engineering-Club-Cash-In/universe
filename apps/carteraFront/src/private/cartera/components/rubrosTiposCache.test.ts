import { describe, expect, it } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { QK_TIPOS, sincronizarTipoEditado } from "./rubrosTiposCache";
import type { TipoRubro } from "../services/rubros.services";

// ─────────────────────────────────────────────────────────────────────────────
// Editar un tipo de rubro pasa por una vista que REEMPLAZA al listado
// (`VistaEditarTipo` ocupa el lugar de `VistaAdminTipos` en el mismo Dialog),
// así que en el instante del PUT las dos queries de tipos están DESMONTADAS.
//
// `invalidateQueries` a secas no las vuelve a pedir: su default es
// `refetchType: "active"`, o sea que a una query inactiva sólo la marca
// obsoleta. Al volver al listado, entonces, las filas se pintan con el nombre,
// la descripción y el "obligatorio" VIEJOS; si el administrador reabre esa fila
// antes de que el refetch de fondo llegue, el formulario nace con los datos
// viejos y el siguiente PUT PISA la edición que acababa de guardar.
//
// Estas pruebas corren contra un `QueryClient` de verdad —que es headless y no
// necesita DOM, del que `carteraFront` no tiene (ver
// `latefeePaginacion.contract.test.ts`)— y fijan la conducta observable: que
// después de guardar, la caché de las dos variantes tenga lo que dice el
// servidor.
// ─────────────────────────────────────────────────────────────────────────────

const tipo = (over: Partial<TipoRubro> = {}): TipoRubro => ({
  tipo_id: 1,
  nombre: "Calcomanía",
  descripcion: null,
  obligatorio: false,
  activo: true,
  ...over,
});

/**
 * Monta las dos variantes de la query de tipos y las deja INACTIVAS —que es el
 * estado real mientras se edita—. `fetchQuery` no crea observadores, así que
 * las queries quedan en caché sin nadie montado, igual que en la pantalla.
 */
async function clientConTipos(servidor: () => TipoRubro[]) {
  let llamadas = 0;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  for (const incluirInactivos of [false, true]) {
    await queryClient.fetchQuery({
      queryKey: [QK_TIPOS, incluirInactivos],
      queryFn: () => {
        llamadas++;
        return servidor();
      },
    });
  }
  return {
    queryClient,
    /** Cuántas veces se le pidió la lista al servidor después del montaje. */
    refetches: () => llamadas - 2,
    lista: (incluirInactivos: boolean) =>
      queryClient.getQueryData<TipoRubro[]>([QK_TIPOS, incluirInactivos]) ?? [],
  };
}

describe("sincronizarTipoEditado", () => {
  it("vuelve a pedir las dos listas aunque estén desmontadas", async () => {
    let guardado = false;
    const c = await clientConTipos(() => [
      tipo({ nombre: guardado ? "Tarjeta de circulación" : "Calcomanía" }),
    ]);

    expect(c.refetches()).toBe(0);

    guardado = true;
    await sincronizarTipoEditado(
      c.queryClient,
      1,
      tipo({ tipo_id: 1, nombre: "Tarjeta de circulación", descripcion: "", obligatorio: false })
    );

    // Las dos variantes, no sólo la que estaba montada al crear.
    expect(c.refetches()).toBe(2);
    expect(c.lista(false)[0]!.nombre).toBe("Tarjeta de circulación");
    expect(c.lista(true)[0]!.nombre).toBe("Tarjeta de circulación");
  });

  it("al volver al listado ya no queda nada del nombre viejo", async () => {
    // El corazón del defecto: si la caché conserva "Calcomanía", reabrir la
    // fila carga el formulario con ese nombre y el PUT siguiente lo revierte.
    const c = await clientConTipos(() => [
      tipo({ nombre: "Tarjeta de circulación", descripcion: "anual", obligatorio: true }),
    ]);

    await sincronizarTipoEditado(
      c.queryClient,
      1,
      tipo({ tipo_id: 1, nombre: "Tarjeta de circulación", descripcion: "anual", obligatorio: true })
    );

    for (const variante of [false, true]) {
      const fila = c.lista(variante)[0]!;
      expect(fila.nombre).toBe("Tarjeta de circulación");
      expect(fila.descripcion).toBe("anual");
      expect(fila.obligatorio).toBe(true);
    }
  });

  it("deja la promesa resuelta recién cuando llegó el dato nuevo", async () => {
    // `onGuardado()` corre después de este await; si la promesa resolviera
    // antes del refetch, el listado se pintaría con lo viejo.
    let servidorRespondio = false;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    await queryClient.fetchQuery({
      queryKey: [QK_TIPOS, true],
      queryFn: async () => {
        await new Promise((r) => setTimeout(r, 10));
        servidorRespondio = true;
        return [tipo({ nombre: "Placa" })];
      },
    });
    servidorRespondio = false;

    await sincronizarTipoEditado(
      queryClient,
      1,
      tipo({ tipo_id: 1, nombre: "Placa", descripcion: "", obligatorio: false })
    );

    expect(servidorRespondio).toBe(true);
  });

  it("mientras llega el refetch, la caché ya muestra lo editado", async () => {
    // Siembra optimista: si el refetch falla (la red se cayó justo después del
    // PUT), el listado tiene que mostrar igual lo que el backend YA guardó, no
    // lo viejo — es lo que evita que reabrir la fila revierta la edición.
    // El montaje inicial sí respondió; el refetch no.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    let primera = true;
    for (const incluirInactivos of [false, true]) {
      await queryClient.fetchQuery({
        queryKey: [QK_TIPOS, incluirInactivos],
        queryFn: () => {
          if (primera) return [tipo({ nombre: "Calcomanía" })];
          throw new Error("servidor caído");
        },
      });
    }
    primera = false;

    await sincronizarTipoEditado(
      queryClient,
      1,
      tipo({ tipo_id: 1, nombre: "Tarjeta de circulación", descripcion: "anual", obligatorio: true })
    );

    for (const variante of [false, true]) {
      const fila =
        queryClient.getQueryData<TipoRubro[]>([QK_TIPOS, variante])![0]!;
      expect(fila.nombre).toBe("Tarjeta de circulación");
      expect(fila.descripcion).toBe("anual");
      expect(fila.obligatorio).toBe(true);
    }
  });

  it("🔴 manda el `activo` que devolvió el PUT, no el que había en caché", async () => {
    // El formulario de edición no toca `activo` —lo mueve el botón del listado—,
    // y por eso antes se conservaba el de la caché. El argumento fallaba en el
    // caso que importa: si OTRO administrador desactiva el tipo mientras este
    // formulario está abierto, el PUT contesta `activo: false`, y conservar el
    // `true` de la caché deja al desplegable de creación ofreciendo un tipo que
    // el backend rechaza.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    queryClient.setQueryData<TipoRubro[]>(
      [QK_TIPOS, true],
      [tipo({ tipo_id: 7, nombre: "Placa", activo: true })]
    );

    await sincronizarTipoEditado(
      queryClient,
      7,
      tipo({ tipo_id: 7, nombre: "Placa nueva", descripcion: "", obligatorio: false, activo: false })
    );

    const fila = queryClient.getQueryData<TipoRubro[]>([QK_TIPOS, true])![0]!;
    expect(fila.nombre).toBe("Placa nueva");
    expect(fila.activo).toBe(false);
    expect(fila.tipo_id).toBe(7);
  });

  it("🔴 y de la lista de SÓLO ACTIVOS, un tipo que volvió inactivo se SACA", async () => {
    // Esa lista no filtra al pintar: filtra al pedir. Dejar la fila con
    // `activo: false` sería el mismo defecto con otra forma.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    queryClient.setQueryData<TipoRubro[]>(
      [QK_TIPOS, false],
      [tipo({ tipo_id: 7, nombre: "Placa" }), tipo({ tipo_id: 8, nombre: "Otro" })]
    );

    await sincronizarTipoEditado(
      queryClient,
      7,
      tipo({ tipo_id: 7, nombre: "Placa", activo: false })
    );

    const lista = queryClient.getQueryData<TipoRubro[]>([QK_TIPOS, false])!;
    expect(lista.map((t) => t.tipo_id)).toEqual([8]);
  });

  it("si sigue activa, la fila se queda en la lista de sólo activos", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    queryClient.setQueryData<TipoRubro[]>(
      [QK_TIPOS, false],
      [tipo({ tipo_id: 7, nombre: "Placa" })]
    );

    await sincronizarTipoEditado(
      queryClient,
      7,
      tipo({ tipo_id: 7, nombre: "Placa nueva", activo: true })
    );

    const lista = queryClient.getQueryData<TipoRubro[]>([QK_TIPOS, false])!;
    expect(lista).toHaveLength(1);
    expect(lista[0]!.nombre).toBe("Placa nueva");
  });

  it("renombrar reordena la lista como la ordena el backend", async () => {
    // El backend devuelve los tipos con `ORDER BY nombre`; si la siembra deja
    // el renombrado en su lugar viejo, la lista salta cuando llega el refetch.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    queryClient.setQueryData<TipoRubro[]>(
      [QK_TIPOS, true],
      [
        tipo({ tipo_id: 1, nombre: "Calcomanía" }),
        tipo({ tipo_id: 2, nombre: "Placa" }),
        tipo({ tipo_id: 3, nombre: "Seguro" }),
      ]
    );

    await sincronizarTipoEditado(
      queryClient,
      1,
      tipo({ tipo_id: 1, nombre: "Tarjeta de circulación", descripcion: "", obligatorio: false })
    );

    expect(
      queryClient
        .getQueryData<TipoRubro[]>([QK_TIPOS, true])!
        .map((t) => t.nombre)
    ).toEqual(["Placa", "Seguro", "Tarjeta de circulación"]);
  });

  it("la descripción vaciada se siembra como cadena vacía, igual que la guarda el backend", async () => {
    // A propósito NO es null: `actualizarTipo` copia `descripcion` del patch
    // sin normalizar y el router tampoco la toca, así que vaciarla guarda "" y
    // el refetch devuelve "". Sembrar null haría que la fila cambie sola cuando
    // llegue el refetch — la diferencia que esta función existe para no tener.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    queryClient.setQueryData<TipoRubro[]>(
      [QK_TIPOS, true],
      [tipo({ tipo_id: 4, descripcion: "vieja" })]
    );

    await sincronizarTipoEditado(
      queryClient,
      4,
      tipo({ tipo_id: 4, nombre: "Calcomanía", descripcion: "", obligatorio: false })
    );

    expect(
      queryClient.getQueryData<TipoRubro[]>([QK_TIPOS, true])![0]!.descripcion
    ).toBe("");
  });
});
