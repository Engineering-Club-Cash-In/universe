import { Menu, ChevronLeft } from "lucide-react";
// ...demás imports

export function SidebarToggle({ open, setOpen }: { open: boolean, setOpen: (b: boolean) => void }) {
  return (
    <button
      aria-label={open ? "Cerrar menú" : "Abrir menú"}
      onClick={() => setOpen(!open)}
      className={`p-2 rounded-lg shadow transition-all border bg-white
        hover:bg-blue-50 active:scale-95
        absolute top-4 left-4 z-50
        ${open ? "ring-2 ring-blue-600" : ""}
      `}
    >
      {/* Animación: rota el ícono al abrir/cerrar */}
      <span className="block transition-transform duration-300">
        {open ? (
          <ChevronLeft className="text-blue-600" size={24} />
        ) : (
          <Menu className="text-blue-600" size={24} />
        )}
      </span>
    </button>
  );
}