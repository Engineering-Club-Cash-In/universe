import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useEntidades } from "../hooks/useEntidades";
import { useContextoEntidadStore } from "../store/useContextoEntidad";
import type { Entidad } from "../services/entitiesService";

/**
 * Selector de la entidad que se está viendo.
 *
 * Dos presentaciones del mismo estado:
 *  - `EntidadSwitcher`: vive en el rail de desktop, siempre visible, para que
 *    el inversionista sepa en qué perfil está sin tener que buscarlo.
 *  - `SelectorEntidad`: la versión en línea, arriba del contenido, para mobile
 *    donde no hay rail.
 */

// El color separa "yo" de "mis empresas" de un vistazo, sin leer la etiqueta.
const acentoDe = (entidad: Entidad) =>
  entidad.tipo === "persona"
    ? "bg-primary/15 text-primary"
    : "bg-secondary/25 text-[#A8AEFF]";

/**
 * Iniciales para el monograma. En las sociedades se usan las dos primeras
 * letras del nombre: partirlo por palabras daría "LS" para
 * "LATINEM S.A." y no ayuda a reconocerla.
 */
const inicialesDe = (entidad: Entidad) => {
  const limpio = entidad.nombre.trim();
  if (!limpio) return "?";

  if (entidad.tipo === "empresa") {
    return limpio.slice(0, 2).toUpperCase();
  }

  const palabras = limpio.split(/\s+/).filter(Boolean);
  const primera = palabras[0]?.[0] ?? "";
  const segunda = palabras.length > 1 ? palabras[1][0] : "";
  return (primera + segunda).toUpperCase() || "?";
};

const etiquetaTipo = (entidad: Entidad) =>
  entidad.tipo === "persona" ? "Personal" : "Empresa";

const Monograma = ({
  entidad,
  size = "md",
}: {
  entidad: Entidad;
  size?: "sm" | "md";
}) => (
  <span
    aria-hidden="true"
    className={`grid place-items-center rounded-lg font-bold shrink-0 ${acentoDe(entidad)} ${
      size === "sm" ? "w-7 h-7 text-[10px]" : "w-9 h-9 text-xs"
    }`}
  >
    {inicialesDe(entidad)}
  </span>
);

const ChevronSelector = ({ abierto }: { abierto: boolean }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={`shrink-0 text-white/45 transition-colors ${abierto ? "text-white/80" : ""}`}
  >
    <path d="m7 15 5 5 5-5" />
    <path d="m7 9 5-5 5 5" />
  </svg>
);

const IconCheck = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="shrink-0 text-primary"
  >
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

/** Cierra el popover al hacer clic afuera o presionar Escape. */
const useCerrarAlSalir = (
  abierto: boolean,
  cerrar: () => void,
  contenedor: React.RefObject<HTMLDivElement | null>
) => {
  useEffect(() => {
    if (!abierto) return;

    const alClicFuera = (event: MouseEvent) => {
      if (!contenedor.current?.contains(event.target as Node)) cerrar();
    };
    const alPresionar = (event: KeyboardEvent) => {
      if (event.key === "Escape") cerrar();
    };

    document.addEventListener("mousedown", alClicFuera);
    document.addEventListener("keydown", alPresionar);
    return () => {
      document.removeEventListener("mousedown", alClicFuera);
      document.removeEventListener("keydown", alPresionar);
    };
  }, [abierto, cerrar, contenedor]);
};

const OpcionEntidad = ({
  entidad,
  activa,
  onSelect,
}: {
  entidad: Entidad;
  activa: boolean;
  onSelect: () => void;
}) => (
  <li role="none">
    <button
      type="button"
      role="option"
      aria-selected={activa}
      onClick={onSelect}
      className={`w-full flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary ${
        activa ? "bg-white/[0.07]" : "hover:bg-white/5"
      }`}
    >
      <Monograma entidad={entidad} size="sm" />
      <span className="flex-1 min-w-0">
        <span className="block truncate text-sm text-white" title={entidad.nombre}>
          {entidad.nombre}
        </span>
        <span className="block text-[11px] text-white/45">
          {etiquetaTipo(entidad)}
          {entidad.status !== "activo" && (
            <span className="text-yellow-300/80">
              {" · "}
              {entidad.status.replace(/_/g, " ")}
            </span>
          )}
        </span>
      </span>
      {activa && <IconCheck />}
    </button>
  </li>
);

/** Lista del popover, con las empresas separadas de la ficha personal. */
const ListaEntidades = ({
  entidades,
  activaId,
  onSelect,
}: {
  entidades: Entidad[];
  activaId: number;
  onSelect: (id: number) => void;
}) => {
  const personas = entidades.filter((e) => e.tipo === "persona");
  const empresas = entidades.filter((e) => e.tipo === "empresa");
  // Los encabezados solo aportan cuando de verdad hay dos grupos.
  const agrupar = personas.length > 0 && empresas.length > 0;

  const grupo = (titulo: string, items: Entidad[]) => (
    <>
      {agrupar && (
        <li
          role="presentation"
          className="px-2.5 pt-2 pb-1 text-[10px] uppercase tracking-[0.14em] text-white/35"
        >
          {titulo}
        </li>
      )}
      {items.map((entidad) => (
        <OpcionEntidad
          key={entidad.inversionista_id}
          entidad={entidad}
          activa={entidad.inversionista_id === activaId}
          onSelect={() => onSelect(entidad.inversionista_id)}
        />
      ))}
    </>
  );

  return (
    <ul
      role="listbox"
      className="max-h-[70vh] overflow-y-auto p-1.5 flex flex-col gap-0.5"
    >
      {grupo("Personal", personas)}
      {grupo(empresas.length === 1 ? "Empresa" : "Empresas", empresas)}
    </ul>
  );
};

const panelClases =
  "rounded-2xl bg-[#17171d] border border-white/10 shadow-2xl shadow-black/50";

/**
 * Switcher del rail de desktop.
 *
 * Se muestra aunque haya una sola entidad: el punto es que el inversionista
 * siempre vea en qué perfil está parado. Con una sola deja de ser un botón.
 */
export const EntidadSwitcher = () => {
  const { entidades, entidadActiva, seleccionar } = useEntidades();
  const [abierto, setAbierto] = useState(false);
  const contenedor = useRef<HTMLDivElement>(null);

  useCerrarAlSalir(abierto, () => setAbierto(false), contenedor);

  if (!entidadActiva) return null;

  const puedeCambiar = entidades.length > 1;

  const contenido = (
    <>
      <Monograma entidad={entidadActiva} />
      <span className="flex-1 min-w-0 text-left">
        <span
          className="block truncate text-sm font-semibold text-white"
          title={entidadActiva.nombre}
        >
          {entidadActiva.nombre}
        </span>
        <span className="block truncate text-[11px] text-white/50">
          {etiquetaTipo(entidadActiva)}
        </span>
      </span>
      {puedeCambiar && <ChevronSelector abierto={abierto} />}
    </>
  );

  return (
    <div className="relative" ref={contenedor}>
      <p className="text-[10px] uppercase tracking-[0.14em] text-white/40 mb-2 px-1">
        Estás viendo
      </p>

      {puedeCambiar ? (
        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={abierto}
          className={`w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary ${
            abierto
              ? "bg-white/10 border-secondary/60"
              : "bg-white/5 border-white/10 hover:border-white/25"
          }`}
        >
          {contenido}
        </button>
      ) : (
        <div className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 bg-white/5 border border-white/10">
          {contenido}
        </div>
      )}

      <AnimatePresence>
        {abierto && (
          <motion.div
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.14 }}
            // Abre hacia la derecha: el rail es angosto y los nombres de las
            // sociedades no caben en su ancho.
            className={`absolute left-full top-6 ml-3 z-50 w-80 ${panelClases}`}
          >
            <ListaEntidades
              entidades={entidades}
              activaId={entidadActiva.inversionista_id}
              onSelect={(id) => {
                seleccionar(id);
                setAbierto(false);
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/**
 * Versión en línea para mobile, arriba del contenido.
 * Solo aparece cuando hay más de una entidad: en pantalla chica el espacio
 * vertical es caro y con una sola no hay nada que elegir.
 */
export const SelectorEntidad = ({ className = "" }: { className?: string }) => {
  const { entidades, entidadActiva, seleccionar } = useEntidades();
  const [abierto, setAbierto] = useState(false);
  const contenedor = useRef<HTMLDivElement>(null);
  const bloque = useRef<HTMLDivElement>(null);
  const registrar = useContextoEntidadStore((s) => s.registrar);
  const setVisible = useContextoEntidadStore((s) => s.setVisible);

  useCerrarAlSalir(abierto, () => setAbierto(false), contenedor);

  const hayVarias = entidades.length > 1 && !!entidadActiva;

  // Mientras este bloque esté a la vista, el navbar no necesita mostrar nada.
  // Cuando se va bajo el navbar, el chip toma la posta.
  useEffect(() => {
    registrar(hayVarias);
    if (!hayVarias) return;

    const nodo = bloque.current;
    if (!nodo) return;

    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      // El navbar es sticky y mide ~72px: sin este margen el chip aparecería
      // tarde, cuando el bloque ya lleva rato escondido detrás.
      { rootMargin: "-72px 0px 0px 0px", threshold: 0 }
    );
    observer.observe(nodo);

    return () => {
      observer.disconnect();
      registrar(false);
    };
  }, [hayVarias, registrar, setVisible]);

  if (!hayVarias || !entidadActiva) return null;

  return (
    <div className={`mb-8 ${className}`} ref={contenedor}>
      <div ref={bloque}>
      <p className="text-[10px] uppercase tracking-[0.14em] text-white/40 mb-2">
        Estás viendo
      </p>

      <div className="relative w-full max-w-md">
        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={abierto}
          className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary ${
            abierto
              ? "bg-white/10 border-secondary/60"
              : "bg-white/5 border-white/10"
          }`}
        >
          <Monograma entidad={entidadActiva} />
          <span className="flex-1 min-w-0 text-left">
            <span className="block truncate font-semibold text-white">
              {entidadActiva.nombre}
            </span>
            <span className="block text-[11px] text-white/50">
              {etiquetaTipo(entidadActiva)}
            </span>
          </span>
          <ChevronSelector abierto={abierto} />
        </button>

        <AnimatePresence>
          {abierto && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.14 }}
              className={`absolute z-40 mt-2 w-full ${panelClases}`}
            >
              <ListaEntidades
                entidades={entidades}
                activaId={entidadActiva.inversionista_id}
                onSelect={(id) => {
                  seleccionar(id);
                  setAbierto(false);
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

/**
 * Chip del navbar de mobile. Aparece solo cuando el bloque "Estás viendo" ya se
 * fue de la pantalla, para devolver el contexto sin duplicarlo arriba.
 */
export const ChipEntidadNavbar = () => {
  const { entidades, entidadActiva, seleccionar } = useEntidades();
  const [abierto, setAbierto] = useState(false);
  const contenedor = useRef<HTMLDivElement>(null);

  useCerrarAlSalir(abierto, () => setAbierto(false), contenedor);

  if (entidades.length <= 1 || !entidadActiva) return null;

  return (
    <div className="flex-1 min-w-0 lg:hidden" ref={contenedor}>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        aria-label={`Estás viendo ${entidadActiva.nombre}. Cambiar de perfil`}
        className={`w-full flex items-center gap-2 rounded-full pl-1 pr-2 py-1 border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary ${
          abierto ? "bg-white/10 border-secondary/60" : "border-white/10"
        }`}
      >
        <Monograma entidad={entidadActiva} size="sm" />
        <span
          className="flex-1 min-w-0 truncate text-left text-[13px] font-medium text-white"
          title={entidadActiva.nombre}
        >
          {entidadActiva.nombre}
        </span>
        <ChevronSelector abierto={abierto} />
      </button>

      <AnimatePresence>
        {abierto && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.14 }}
            // Anclado al viewport y no al chip: el chip vive dentro del pill del
            // navbar y el panel necesita todo el ancho de la pantalla.
            className={`fixed left-4 right-4 top-[78px] z-[60] ${panelClases}`}
          >
            <ListaEntidades
              entidades={entidades}
              activaId={entidadActiva.inversionista_id}
              onSelect={(id) => {
                seleccionar(id);
                setAbierto(false);
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
