import { describe, expect, it } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { QK_RUBROS, sincronizarRubroEditado } from "./rubrosCache";
import type { RubroCredito, RubroGuardado } from "../services/rubros.services";

// ─────────────────────────────────────────────────────────────────────────────
// Después de editar un rubro, el modal vuelve a la lista. Si sólo se dispara el
// `invalidateQueries` y se vuelve, la lista se pinta con la fila VIEJA mientras
// el GET viaja: el administrador que reabre esa fila en ese hueco carga el
// formulario con el monto y la descripción anteriores, y el PUT siguiente PISA
// la edición que acababa de guardar.
//
// Diferencia con los TIPOS (ver `rubrosTiposCache.test.ts`): allá la query está
// DESMONTADA al editar y el `invalidateQueries` pelado ni siquiera la vuelve a
// pedir. Acá la query de rubros vive en el componente PADRE, que no se desmonta
// al cambiar de vista, así que el refetch sí sale — el agujero es de TIEMPO. Por
// eso estas pruebas montan un observador (query ACTIVA, como en la pantalla) y
// miran qué hay en caché en el instante en que `volver()` pintaría la lista.
// ─────────────────────────────────────────────────────────────────────────────

const CRED = 77;

const rubro = (over: Partial<RubroCredito> = {}): RubroCredito => ({
  rubro_id: 5,
  credito_id: CRED,
  tipo_id: 1,
  tipo_nombre: "Calcomanía",
  descripcion: "Calcomanía 2026",
  monto_original: "500.00",
  saldo_pendiente: "300.00",
  abonado: "200.00",
  activo: true,
  completado: false,
  anulado: false,
  created_at: "2026-09-01T00:00:00.000Z",
  ...over,
});

/** Lo que devuelve el PUT: la fila cruda, sin `tipo_nombre` ni `abonado`. */
const guardado = (over: Partial<RubroGuardado> = {}): RubroGuardado => {
  const { tipo_nombre: _n, abonado: _a, ...fila } = rubro();
  return { ...fila, ...over };
};

/**
 * Deja la lista del crédito en caché y MONTADA, que es el estado real: el
 * `useQuery` de rubros vive en el componente padre y sigue vivo mientras se
 * edita. Devuelve además con qué responde el servidor y cuántas veces se le
 * preguntó.
 */
function pantallaConRubros(servidor: () => RubroCredito[] | Promise<RubroCredito[]>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  let llamadas = 0;
  const observer = new QueryObserver<RubroCredito[]>(queryClient, {
    queryKey: [QK_RUBROS, CRED],
    queryFn: () => {
      llamadas++;
      return servidor();
    },
  });
  const desuscribir = observer.subscribe(() => {});
  return {
    queryClient,
    desuscribir,
    refetches: () => llamadas - 1,
    fila: () =>
      queryClient.getQueryData<RubroCredito[]>([QK_RUBROS, CRED])?.[0] ?? null,
  };
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("sincronizarRubroEditado", () => {
  it("al volver a la lista la fila ya trae lo guardado, no lo viejo", async () => {
    // El servidor tarda: es exactamente el hueco en el que el administrador
    // reabre la fila y el formulario nace con el monto anterior.
    const p = pantallaConRubros(async () => {
      await esperar(50);
      return [rubro()];
    });
    await esperar(10);

    await sincronizarRubroEditado(
      p.queryClient,
      CRED,
      5,
      guardado({ monto_original: "800.00", saldo_pendiente: "600.00", descripcion: "Calcomanía 2027" })
    );

    const fila = p.fila()!;
    expect(fila.monto_original).toBe("800.00");
    expect(fila.saldo_pendiente).toBe("600.00");
    expect(fila.descripcion).toBe("Calcomanía 2027");
    p.desuscribir();
  });

  it("conserva el tipo y lo abonado, que el PUT no devuelve", async () => {
    // `tipo_nombre` sale del join y `abonado` lo deriva el GET de la lista: la
    // respuesta del PUT no los trae. Reemplazar la fila entera con lo que
    // devolvió el PUT dejaría la columna "Tipo" vacía y el abonado en blanco.
    const p = pantallaConRubros(async () => {
      await esperar(50);
      return [rubro()];
    });
    await esperar(10);

    await sincronizarRubroEditado(
      p.queryClient,
      CRED,
      5,
      guardado({ monto_original: "800.00", saldo_pendiente: "600.00" })
    );

    const fila = p.fila()!;
    expect(fila.tipo_nombre).toBe("Calcomanía");
    // Editar el monto NO cambia lo abonado: el backend recalcula
    // `saldo = monto − abonado`, así que el abonado es justo lo que queda fijo.
    expect(fila.abonado).toBe("200.00");
    p.desuscribir();
  });

  it("la promesa resuelve recién cuando el servidor respondió", async () => {
    // `volver()` corre después de este await: si resolviera antes del refetch,
    // la lista se pintaría con la fila vieja igual que antes del arreglo.
    let respondio = false;
    const p = pantallaConRubros(async () => {
      await esperar(20);
      respondio = true;
      return [rubro({ monto_original: "800.00" })];
    });
    await esperar(40);
    respondio = false;

    await sincronizarRubroEditado(p.queryClient, CRED, 5, guardado());

    expect(respondio).toBe(true);
    p.desuscribir();
  });

  it("si el refetch falla, la caché igual muestra lo que el backend YA guardó", async () => {
    // La red se cayó justo después del PUT: es el caso en el que perder la
    // edición dolería más, porque el cargo ya está cambiado en la base.
    let primera = true;
    const p = pantallaConRubros(() => {
      if (primera) return [rubro()];
      throw new Error("servidor caído");
    });
    await esperar(10);
    primera = false;

    await sincronizarRubroEditado(
      p.queryClient,
      CRED,
      5,
      guardado({ monto_original: "800.00", saldo_pendiente: "600.00" })
    );

    expect(p.fila()!.monto_original).toBe("800.00");
    p.desuscribir();
  });

  it("sin fila en la respuesta igual refresca la lista", async () => {
    // Defensa del `null` del servicio: si el backend dejara de devolver la
    // fila, se pierde la siembra pero NO el refresco.
    const p = pantallaConRubros(async () => [rubro({ monto_original: "800.00" })]);
    await esperar(10);

    await sincronizarRubroEditado(p.queryClient, CRED, 5, null);

    expect(p.refetches()).toBe(1);
    expect(p.fila()!.monto_original).toBe("800.00");
    p.desuscribir();
  });

  it("no toca la lista de otro crédito", async () => {
    // La clave lleva el crédito: sembrar por `rubro_id` sin mirar de quién es
    // la lista pondría el cargo de un cliente en la ficha de otro.
    const p = pantallaConRubros(async () => [rubro()]);
    await esperar(10);
    p.queryClient.setQueryData<RubroCredito[]>(
      [QK_RUBROS, 99],
      [rubro({ credito_id: 99, monto_original: "100.00" })]
    );

    await sincronizarRubroEditado(
      p.queryClient,
      CRED,
      5,
      guardado({ monto_original: "800.00" })
    );

    expect(
      p.queryClient.getQueryData<RubroCredito[]>([QK_RUBROS, 99])![0]!.monto_original
    ).toBe("100.00");
    p.desuscribir();
  });
});
