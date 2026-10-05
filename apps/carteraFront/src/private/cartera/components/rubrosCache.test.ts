import { describe, expect, it } from "bun:test";
import { QueryClient, QueryObserver, onlineManager } from "@tanstack/react-query";
import {
  QK_RUBROS,
  sincronizarRubroAnulado,
  sincronizarRubroCreado,
  sincronizarRubroEditado,
} from "./rubrosCache";
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
  const opciones = {
    queryKey: [QK_RUBROS, CRED],
    queryFn: () => {
      llamadas++;
      return servidor();
    },
  };
  const observer = new QueryObserver<RubroCredito[]>(queryClient, opciones);
  const desuscribir = observer.subscribe(() => {});
  return {
    queryClient,
    desuscribir,
    /**
     * Cierra el modal SIN desmontar el componente, que es lo que de verdad pasa:
     * el `useQuery` es `enabled: open && !!creditoVisible`, así que al cerrar el
     * observer sigue montado y sólo queda deshabilitado.
     *
     * La diferencia con desuscribir NO es cosmética: una query sin observadores
     * queda "inactiva" y `refetchType: "all"` sí la alcanza, pero una con un
     * observador deshabilitado queda `isDisabled`, y a ésa `refetchQueries` la
     * FILTRA incluso con `"all"`. Un test que desuscribe no prueba este caso.
     */
    cerrarModal: () => observer.setOptions({ ...opciones, enabled: false }),
    refetches: () => llamadas - 1,
    fila: () =>
      queryClient.getQueryData<RubroCredito[]>([QK_RUBROS, CRED])?.[0] ?? null,
  };
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("sincronizarRubroEditado", () => {
  it("un GET que salió ANTES del PUT no puede pisar lo guardado", async () => {
    // La lista YA está cargada —es el único estado desde el que se puede editar
    // una fila— y hay un GET rezagado en vuelo que todavía trae el monto viejo.
    // `invalidateQueries` cancela ese fetch al disparar el suyo, así que la
    // respuesta rezagada se descarta y lo que queda es el refetch posterior al
    // PUT. No hace falta que el `queryFn` acepte un AbortSignal: la cancelación
    // actúa a nivel del caché, descartando el resultado tardío.
    let respuesta: RubroCredito[] = [rubro()];
    const p = pantallaConRubros(async () => {
      await esperar(50);
      return respuesta;
    });
    await esperar(80); // la carga inicial YA terminó

    // Sale un GET que todavía ve el monto viejo...
    p.queryClient.refetchQueries({ queryKey: [QK_RUBROS, CRED] });
    await esperar(5);
    // ...y recién entonces el PUT cambia el dato del servidor.
    respuesta = [rubro({ monto_original: "800.00", saldo_pendiente: "600.00", descripcion: "Calcomanía 2027" })];

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

  it("si el modal se CERRÓ durante el guardado, la lista igual queda al día", async () => {
    // El caso real, y el más difícil de ver: al cerrar, `enabled` pasa a false y
    // el observer sigue montado. Esa query queda `isDisabled`, y `refetchQueries`
    // la filtra INCLUSO con `refetchType: "all"` — así que no hay refetch, no hay
    // error, y el estado queda en `success`/`idle`, o sea "todo bien".
    //
    // Sin detectarlo, la lista se queda con el monto ANTERIOR al PUT aunque el
    // backend ya guardó el nuevo. Al reabrir, ese dato viejo se alcanza a pintar
    // y el que edite esa fila lo manda de vuelta.
    let primera = true;
    const p = pantallaConRubros(async () => {
      if (primera) {
        primera = false;
        return [rubro()];
      }
      return [rubro({ monto_original: "800.00", saldo_pendiente: "600.00" })];
    });
    await esperar(20);

    p.cerrarModal();

    await sincronizarRubroEditado(
      p.queryClient,
      CRED,
      5,
      guardado({ monto_original: "800.00", saldo_pendiente: "600.00" })
    );

    expect(p.fila()!.monto_original).toBe("800.00");
  });

  it("con el componente desmontado igual SE PIDE, para no caer al plan B a ciegas", async () => {
    // Sin `refetchType: "all"` una query inactiva no se vuelve a pedir, y la
    // siembra taparía el hueco con NUESTRO valor. Funcionaría de casualidad: se
    // vería lo guardado, pero se perdería la edición de otro administrador, que
    // es justo lo que este helper existe para no hacer.
    //
    // Forzando el refetch, la inactiva sí trae la verdad del servidor y el plan B
    // queda para cuando de verdad no llega nada. Acá el servidor devuelve 999,
    // que es lo que dejó el otro admin: tiene que ganar sobre nuestro 800.
    let primera = true;
    const p = pantallaConRubros(async () => {
      if (primera) {
        primera = false;
        return [rubro()];
      }
      return [rubro({ monto_original: "999.00", saldo_pendiente: "799.00" })];
    });
    await esperar(20);

    p.desuscribir();

    await sincronizarRubroEditado(
      p.queryClient,
      CRED,
      5,
      guardado({ monto_original: "800.00", saldo_pendiente: "600.00" })
    );

    expect(p.fila()!.monto_original).toBe("999.00");
  });

  it("si el componente se desmontó, tampoco queda con el dato viejo", async () => {
    // Variante del anterior por el otro lado: sin observadores la query queda
    // "inactiva", no "deshabilitada". Son estados distintos de TanStack y se
    // comportan distinto frente a `refetchType`, así que se prueban los dos.
    let primera = true;
    const p = pantallaConRubros(async () => {
      if (primera) {
        primera = false;
        return [rubro()];
      }
      return [rubro({ monto_original: "800.00", saldo_pendiente: "600.00" })];
    });
    await esperar(20);

    p.desuscribir();

    await sincronizarRubroEditado(
      p.queryClient,
      CRED,
      5,
      guardado({ monto_original: "800.00", saldo_pendiente: "600.00" })
    );

    expect(p.fila()!.monto_original).toBe("800.00");
  });

  it("con la red caída la siembra es lo único que salva la edición", async () => {
    // Offline, `invalidateQueries` resuelve igual (no se cuelga) pero el fetch
    // queda en `paused` y el `status` sigue diciendo `success`, porque conserva
    // el último dato bueno. O sea: mirar sólo el `status` da "todo bien" cuando
    // en realidad no se refrescó nada.
    //
    // Es cuando perder la edición más duele, porque el cargo YA está cambiado en
    // la base: el administrador vuelve a la lista, ve el monto viejo y lo
    // corrige otra vez sobre un dato que ya no existe.
    const p = pantallaConRubros(async () => [rubro()]);
    await esperar(20);

    onlineManager.setOnline(false);
    try {
      await sincronizarRubroEditado(
        p.queryClient,
        CRED,
        5,
        guardado({ monto_original: "800.00", saldo_pendiente: "600.00" })
      );

      expect(p.fila()!.monto_original).toBe("800.00");
    } finally {
      onlineManager.setOnline(true);
      p.desuscribir();
    }
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

  it("si OTRO admin editó después, gana el servidor y no la respuesta del PUT", async () => {
    // El otro lado de la moneda de sembrar al final. Entre que nuestro PUT
    // respondió y el refetch volvió, otro administrador puede haber editado la
    // misma fila: el GET trae su valor —más nuevo que el nuestro— y sembrar
    // encima lo pisaría con el nuestro, que ya es viejo. Y como la siembra pasa
    // después del refetch, React Query lo trata como fresco: reabrir esa fila y
    // guardar revierte la edición del otro.
    //
    // Por eso la siembra sólo entra cuando el refetch FALLÓ. Si el servidor
    // contestó, el servidor manda.
    const p = pantallaConRubros(async () => [
      rubro({ monto_original: "999.00", descripcion: "lo que puso el otro" }),
    ]);
    await esperar(10);

    await sincronizarRubroEditado(
      p.queryClient,
      CRED,
      5,
      guardado({ monto_original: "800.00", descripcion: "lo mío" })
    );

    const fila = p.fila()!;
    expect(fila.monto_original).toBe("999.00");
    expect(fila.descripcion).toBe("lo que puso el otro");
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

// ─────────────────────────────────────────────────────────────────────────────
// ANULAR y CREAR comparten el criterio de la edición, y no por simetría: los
// tres endpoints devuelven la fila guardada (`POST /rubros`,
// `POST /rubros/:id/anular` y el `PUT`), y los tres tienen el mismo agujero si
// el refetch no trae nada — que en TanStack pasa sin levantar excepción y con el
// estado en `success`.
//
// Anular duele más que editar: deja la fila terminal. Sin red, la lista sigue
// diciendo "Activo" con el saldo de antes y ofreciendo Editar y Anular, que el
// backend ya rechaza con 409. El usuario aprieta botones que no pueden funcionar.
// ─────────────────────────────────────────────────────────────────────────────

/** Lo que devuelve el POST de anular: saldo en 0, completado, inactivo. */
const anulado = (): RubroGuardado => ({
  ...guardado(),
  saldo_pendiente: "0.00",
  completado: true,
  activo: false,
  anulado: true,
});

describe("sincronizarRubroAnulado", () => {
  it("si el modal se cerró, la fila igual queda anulada y no ofrece acciones", async () => {
    // El caso que de verdad pasa: al cerrar, `enabled` pasa a false y el
    // observer sigue montado, así que la query queda `isDisabled` y ni
    // `refetchType: "all"` la alcanza.
    let primera = true;
    const p = pantallaConRubros(async () => {
      if (primera) {
        primera = false;
        return [rubro()];
      }
      return [rubro()]; // el servidor no llega a contestar la anulación
    });
    await esperar(20);
    p.cerrarModal();

    await sincronizarRubroAnulado(p.queryClient, CRED, 5, anulado());

    const fila = p.fila()!;
    expect(fila.anulado).toBe(true);
    expect(fila.saldo_pendiente).toBe("0.00");
    expect(fila.activo).toBe(false);
  });

  it("conserva el tipo, que el POST de anular no devuelve", async () => {
    const p = pantallaConRubros(async () => [rubro()]);
    await esperar(20);
    p.cerrarModal();

    await sincronizarRubroAnulado(p.queryClient, CRED, 5, anulado());

    // Reemplazar la fila en vez de parcharla dejaría la columna "Tipo" vacía:
    // cambiaría un dato viejo por un dato faltante.
    expect(p.fila()!.tipo_nombre).toBe("Calcomanía");
  });

  it("si el servidor contestó, gana el servidor", async () => {
    let primera = true;
    const p = pantallaConRubros(async () => {
      if (primera) {
        primera = false;
        return [rubro()];
      }
      // Otro admin ya lo había anulado con otro saldo remanente.
      return [rubro({ anulado: true, saldo_pendiente: "0.00", descripcion: "Anulado por otro" })];
    });
    await esperar(20);

    await sincronizarRubroAnulado(p.queryClient, CRED, 5, anulado());

    expect(p.fila()!.descripcion).toBe("Anulado por otro");
  });
});

describe("sincronizarRubroCreado", () => {
  it("si el modal se cerró, el rubro nuevo igual aparece en la lista", async () => {
    // Sin esto, el toast de "Rubro creado" salía sobre una lista sin el rubro
    // —y en un crédito sin rubros, sobre el cartel de "no hay rubros"—.
    const p = pantallaConRubros(async () => []);
    await esperar(20);
    p.cerrarModal();

    await sincronizarRubroCreado(
      p.queryClient,
      CRED,
      guardado({ rubro_id: 9, monto_original: "300.00", saldo_pendiente: "300.00" }),
      "Placas"
    );

    const filas = p.queryClient.getQueryData<RubroCredito[]>([QK_RUBROS, CRED])!;
    expect(filas).toHaveLength(1);
    expect(filas[0].rubro_id).toBe(9);
  });

  it("🔴 lo pone PRIMERO, que es donde el servidor lo devolvería", async () => {
    // El GET ordena `desc(rubros.created_at)`: el más nuevo va arriba. Agregarlo
    // al final lo dejaba como la fila más vieja de la lista, y en un crédito con
    // varios cobros el rubro recién creado se iba fuera de pantalla —justo
    // cuando la siembra es lo único que lo muestra—.
    const p = pantallaConRubros(async () => [
      rubro({ rubro_id: 1, descripcion: "Vieja" }),
      rubro({ rubro_id: 2, descripcion: "Media" }),
    ]);
    await esperar(20);
    p.cerrarModal();

    await sincronizarRubroCreado(
      p.queryClient,
      CRED,
      guardado({ rubro_id: 9, descripcion: "Nueva" }),
      "Placas"
    );

    const filas = p.queryClient.getQueryData<RubroCredito[]>([QK_RUBROS, CRED])!;
    expect(filas).toHaveLength(3);
    expect(filas[0].descripcion).toBe("Nueva");
  });

  it("le pone el tipo que eligió el usuario, que el POST no devuelve", async () => {
    // `tipo_nombre` sale del join del GET. Sin ponerlo, la fila sembrada
    // aparecería con la columna "Tipo" en blanco.
    const p = pantallaConRubros(async () => []);
    await esperar(20);
    p.cerrarModal();

    await sincronizarRubroCreado(p.queryClient, CRED, guardado({ rubro_id: 9 }), "Placas");

    expect(p.queryClient.getQueryData<RubroCredito[]>([QK_RUBROS, CRED])![0].tipo_nombre).toBe("Placas");
  });

  it("no lo duplica si el refetch ya lo trajo", async () => {
    let primera = true;
    const p = pantallaConRubros(async () => {
      if (primera) {
        primera = false;
        return [];
      }
      return [rubro({ rubro_id: 9 })];
    });
    await esperar(20);

    await sincronizarRubroCreado(p.queryClient, CRED, guardado({ rubro_id: 9 }), "Placas");

    expect(p.queryClient.getQueryData<RubroCredito[]>([QK_RUBROS, CRED])).toHaveLength(1);
    p.desuscribir();
  });
});

describe("crear y anular — no dejan al usuario atrapado", () => {
  it("resuelven aunque el servidor esté caído", async () => {
    // Quien llama vuelve a la lista DESPUÉS de este await. Si no resolviera con
    // la red caída, la vista del formulario quedaría colgada para siempre — y el
    // cargo ya está creado o anulado en la base, así que no hay nada que
    // reintentar desde ahí.
    let primera = true;
    const p = pantallaConRubros(() => {
      if (primera) return [rubro()];
      throw new Error("servidor caído");
    });
    await esperar(20);
    primera = false;

    await sincronizarRubroAnulado(p.queryClient, CRED, 5, anulado());
    await sincronizarRubroCreado(p.queryClient, CRED, guardado({ rubro_id: 9 }), "Placas");

    // Y lo que quedó en pantalla es lo que el backend ya guardó, no lo de antes.
    const filas = p.queryClient.getQueryData<RubroCredito[]>([QK_RUBROS, CRED])!;
    expect(filas.find((r) => r.rubro_id === 5)!.anulado).toBe(true);
    expect(filas.some((r) => r.rubro_id === 9)).toBe(true);
    p.desuscribir();
  });

  it("no tocan la lista de otro crédito", async () => {
    const p = pantallaConRubros(async () => [rubro()]);
    await esperar(20);
    p.queryClient.setQueryData<RubroCredito[]>(
      [QK_RUBROS, 99],
      [rubro({ credito_id: 99, monto_original: "100.00" })]
    );
    p.cerrarModal();

    await sincronizarRubroAnulado(p.queryClient, CRED, 5, anulado());
    await sincronizarRubroCreado(p.queryClient, CRED, guardado({ rubro_id: 9 }), "Placas");

    const otra = p.queryClient.getQueryData<RubroCredito[]>([QK_RUBROS, 99])!;
    expect(otra).toHaveLength(1);
    expect(otra[0].monto_original).toBe("100.00");
  });
});

describe("la siembra NO inventa una lista", () => {
  it("🔴 si el GET nunca cargó, no deja el rubro nuevo como si fuera toda la lista", async () => {
    // El caso: la lista nunca se pudo cargar, el POST sí entró, y el GET de la
    // invalidación también falla. El estado de la query EXISTE —con `data`
    // undefined y `dataUpdatedAt` en 0— así que mirar sólo `estado !== undefined`
    // daba "no llegó nada" y sembraba.
    //
    // Y sembrar sobre `undefined` convierte la lista en `[nueva]`: la pantalla
    // mostraría UN rubro, escondiendo todos los que el crédito ya tenía, con el
    // total pendiente equivocado. Mejor dejarla en error para que el refetch
    // siguiente traiga la lista completa.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const observer = new QueryObserver<RubroCredito[]>(queryClient, {
      queryKey: [QK_RUBROS, CRED],
      queryFn: async () => {
        throw new Error("el GET nunca funcionó");
      },
    });
    const off = observer.subscribe(() => {});
    await esperar(30);

    await sincronizarRubroCreado(
      queryClient,
      CRED,
      guardado({ rubro_id: 9 }),
      "Placas"
    );

    // Sin lista en caché no hay nada que corregir: se deja el error.
    expect(queryClient.getQueryData<RubroCredito[]>([QK_RUBROS, CRED])).toBeUndefined();
    expect(queryClient.getQueryState([QK_RUBROS, CRED])?.status).toBe("error");
    off();
  });

  it("y tampoco al editar o anular sobre una lista que nunca cargó", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const observer = new QueryObserver<RubroCredito[]>(queryClient, {
      queryKey: [QK_RUBROS, CRED],
      queryFn: async () => {
        throw new Error("el GET nunca funcionó");
      },
    });
    const off = observer.subscribe(() => {});
    await esperar(30);

    await sincronizarRubroEditado(queryClient, CRED, 5, guardado());
    await sincronizarRubroAnulado(queryClient, CRED, 5, anulado());

    expect(queryClient.getQueryData<RubroCredito[]>([QK_RUBROS, CRED])).toBeUndefined();
    off();
  });
});
