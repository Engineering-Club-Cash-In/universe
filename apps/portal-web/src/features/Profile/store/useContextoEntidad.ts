import { create } from "zustand";

/**
 * Puente entre el bloque "Estás viendo" de mobile y el navbar.
 *
 * El bloque avisa si existe en la pantalla y si sigue a la vista; el navbar
 * solo lee eso para decidir si muestra el chip con la entidad. Va por store y
 * no por props porque el navbar se renderiza en cada pantalla, por fuera del
 * árbol del contenido.
 *
 * `registrado` también evita que el navbar consulte entidades en las pantallas
 * públicas: el chip ni se monta si no hay un bloque que lo respalde.
 */
interface ContextoEntidadState {
  registrado: boolean;
  visible: boolean;
  registrar: (registrado: boolean) => void;
  setVisible: (visible: boolean) => void;
}

export const useContextoEntidadStore = create<ContextoEntidadState>((set) => ({
  registrado: false,
  // Arranca visible: mientras no se sepa lo contrario, el chip no aparece.
  visible: true,
  registrar: (registrado) =>
    set(registrado ? { registrado } : { registrado, visible: true }),
  setVisible: (visible) => set({ visible }),
}));
