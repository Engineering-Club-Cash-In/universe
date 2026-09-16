import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Entidad que el inversionista está viendo en este momento.
 *
 * Se guarda por usuario y sobrevive al reload, pero NO es la fuente de verdad:
 * el id guardado puede haber dejado de pertenecerle (le quitaron la sociedad,
 * cambió el representante legal), así que siempre se valida contra la lista que
 * devuelve el servidor antes de usarlo — eso lo hace `useEntidades`.
 */
interface EntidadActivaState {
  porUsuario: Record<string, number>;
  setEntidadActiva: (userId: string, inversionistaId: number) => void;
}

export const useEntidadActivaStore = create<EntidadActivaState>()(
  persist(
    (set) => ({
      porUsuario: {},
      setEntidadActiva: (userId, inversionistaId) =>
        set((state) => ({
          porUsuario: { ...state.porUsuario, [userId]: inversionistaId },
        })),
    }),
    { name: "cci-entidad-activa" }
  )
);
