import { describe, expect, it } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { QK_HISTORIAL, olvidarHistorialRubro } from "./rubrosHistorialCache";
import type { EventoRubro } from "../services/rubros.services";

// ─────────────────────────────────────────────────────────────────────────────
// El historial de un rubro se abre desde la lista, en una vista que REEMPLAZA a
// las demás en el mismo Dialog. Si el administrador lo miró y después editó o
// anuló ese rubro, la query del historial quedó en caché con los eventos de
// ANTES — y editar y anular escriben cada uno su fila en `rubros_historial`, así
// que esos eventos de antes ya no son todo lo que pasó.
//
// El agujero es de ALCANCE, como en los tipos, pero no se arregla igual, y por
// eso este helper no reusa ninguno de los dos que ya existen:
//
//  - `invalidateQueries` a secas no alcanza. No porque no vuelva a pedir —el
//    `staleTime` de 0 ya hace que la query se refetchee al remontarse—, sino
//    porque el DATO VIEJO SIGUE EN CACHÉ: al reabrir, React Query entrega
//    `status: "success"` con los eventos anteriores e `isLoading === false`, y
//    `VistaHistorial` pinta la lista vieja mientras el GET viaja de fondo. El
//    cambio recién hecho, con su motivo, no aparece — y el motivo es justamente
//    lo único que después explica por qué ese cobro se tocó.
//  - `refetchType: "all"`, la salida del caso de los tipos, tampoco: allá se
//    vuelve al listado en el acto y hay que tener el dato ya puesto, acá el
//    historial puede no abrirse nunca. Disparar ese GET al editar sería pedir
//    algo que nadie está mirando.
//
// Olvidar la entrada deja las dos cosas bien: no se pide nada de más, y quien
// reabra el historial arranca de cero, con su spinner, y ve lo que el servidor
// tenga — incluido el evento recién escrito.
// ─────────────────────────────────────────────────────────────────────────────

const RUBRO = 5;

const evento = (over: Partial<EventoRubro> = {}): EventoRubro => ({
  historial_id: 1,
  tipo_evento: "creacion",
  monto_anterior: null,
  monto_nuevo: "500.00",
  saldo_anterior: null,
  saldo_nuevo: "500.00",
  origen: "ADMIN",
  motivo: null,
  usuario_nombre: null,
  usuario_email: "admin@clubcashin.com",
  created_at: "2026-09-01T00:00:00.000Z",
  ...over,
});

/**
 * Deja el historial en caché y DESMONTADO, que es el estado real: el
 * administrador lo miró, volvió a la lista y se fue a editar el rubro.
 * `fetchQuery` no crea observadores, así que la query queda sin nadie montado.
 */
async function historialMirado(servidor: () => EventoRubro[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  let llamadas = 0;
  const queryFn = () => {
    llamadas++;
    return servidor();
  };
  await queryClient.fetchQuery({ queryKey: [QK_HISTORIAL, RUBRO], queryFn });

  return {
    queryClient,
    gets: () => llamadas,
    /** Lo que vería el administrador al reabrir el historial, en la 1ª render. */
    alReabrir: () => {
      const observer = new QueryObserver<EventoRubro[]>(queryClient, {
        queryKey: [QK_HISTORIAL, RUBRO],
        queryFn,
      });
      const desuscribir = observer.subscribe(() => {});
      const r = observer.getCurrentResult();
      desuscribir();
      return { eventos: r.data, cargando: r.isLoading };
    },
  };
}

describe("olvidarHistorialRubro", () => {
  it("al reabrir no se pintan los eventos de antes de la edición", async () => {
    let editado = false;
    const p = await historialMirado(() =>
      editado
        ? [evento({ historial_id: 2, tipo_evento: "cambio_monto", motivo: "Ajuste acordado" }), evento()]
        : [evento()]
    );
    editado = true;

    olvidarHistorialRubro(p.queryClient, RUBRO);

    const { eventos, cargando } = p.alReabrir();
    // Sin dato en caché la vista muestra su spinner en vez de una lista que
    // miente: `VistaHistorial` decide por `isLoading`.
    expect(eventos).toBeUndefined();
    expect(cargando).toBe(true);
  });

  it("invalidar no alcanzaba: dejaba el dato viejo listo para pintarse", async () => {
    // Control del caso anterior. Fija POR QUÉ este helper no es un
    // `invalidateQueries` más: invalidar marca obsoleto, no vacía.
    const p = await historialMirado(() => [evento()]);

    await p.queryClient.invalidateQueries({ queryKey: [QK_HISTORIAL, RUBRO] });

    const { eventos, cargando } = p.alReabrir();
    expect(eventos).toHaveLength(1);
    expect(cargando).toBe(false);
  });

  it("no pide el historial al editar: sólo lo olvida", async () => {
    // El historial puede no abrirse nunca. Un `refetchType: "all"` acá saldría a
    // buscar eventos que nadie está mirando, en el mismo momento en que el
    // usuario está esperando que vuelva la lista de rubros.
    const p = await historialMirado(() => [evento()]);
    expect(p.gets()).toBe(1);

    olvidarHistorialRubro(p.queryClient, RUBRO);

    expect(p.gets()).toBe(1);
  });

  it("no olvida el historial de otro rubro", async () => {
    // La clave lleva el `rubro_id`: tirar la caché entera de historiales haría
    // que mirar un cargo cueste un GET nuevo por culpa de la edición de otro.
    const p = await historialMirado(() => [evento()]);
    p.queryClient.setQueryData<EventoRubro[]>(
      [QK_HISTORIAL, 99],
      [evento({ historial_id: 9 })]
    );

    olvidarHistorialRubro(p.queryClient, RUBRO);

    expect(
      p.queryClient.getQueryData<EventoRubro[]>([QK_HISTORIAL, 99])
    ).toHaveLength(1);
  });
});
