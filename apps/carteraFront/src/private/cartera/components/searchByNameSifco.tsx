import { useState, useMemo, useEffect, useRef } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useQuery } from "@tanstack/react-query";
import { getCreditosPaginados } from "../services/services";
import { User, BadgeDollarSign, XCircle, ChevronLeft, ChevronRight } from "lucide-react";

type OpcionSifco = {
  nombre: string;
  sifco: string;
  credito_id: number;
};

const ESTADOS_SELECCIONABLES = new Set([
  "ACTIVO",
  "CANCELADO",
  "PENDIENTE_CANCELACION",
  "MOROSO",
  "EN_CONVENIO",
  "INCOBRABLE",
]);

interface BuscadorUsuarioSifcoProps {
  onSelect: (sifco: string) => void;
  // Callback opcional con la opción completa (incluye credito_id). Útil cuando
  // el consumidor necesita el id y no solo el número SIFCO.
  onSelectOption?: (option: OpcionSifco) => void;
  reset?: boolean;
  onReset?: () => void;
  initialSifco?: string;
}

function esSifco(search: string): boolean {
  return /\d/.test(search);
}

export function BuscadorUsuarioSifco({ onSelect, onSelectOption, reset, onReset, initialSifco }: BuscadorUsuarioSifcoProps) {
  const [search, setSearch] = useState<string>(initialSifco ?? "");
  const [debouncedSearch, setDebouncedSearch] = useState<string>(initialSifco ?? "");
  const [page, setPage] = useState<number>(1);
  const [selectedSifco, setSelectedSifco] = useState<string>("");
  const [selectedOption, setSelectedOption] = useState<OpcionSifco | null>(null);
  const initialAppliedRef = useRef<boolean>(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading } = useQuery({
    queryKey: ["buscador-creditos", debouncedSearch, page],
    queryFn: () => {
      const searchTrimmed = debouncedSearch.trim();
      const hasFilter = searchTrimmed.length >= 2;
      return getCreditosPaginados({
        mes: 0,
        anio: new Date().getFullYear(),
        page,
        perPage: 10,
        excel: false,
        estados_credito: Array.from(ESTADOS_SELECCIONABLES).join(","),
        ...(hasFilter && esSifco(searchTrimmed)
          ? { numero_credito_sifco: searchTrimmed }
          : hasFilter
          ? { nombre_usuario: searchTrimmed }
          : {}),
      });
    },
    staleTime: 1000 * 30,
    refetchOnWindowFocus: false,
  });

  const opciones: OpcionSifco[] = useMemo(() => {
    if (!data?.data) return [];
    return data.data
      .filter((item) => ESTADOS_SELECCIONABLES.has(item.creditos.statusCredit))
      .map((item) => ({
        nombre: item.usuarios.nombre,
        sifco: item.creditos.numero_credito_sifco,
        credito_id: item.creditos.credito_id,
      }));
  }, [data]);

  const totalPages = data?.totalPages ?? 1;

  const handleChange = (valor: string) => {
    const opt = opciones.find((o) => o.sifco === valor) || null;
    setSelectedOption(opt);
    setSelectedSifco(valor);
    onSelect(valor);
    if (opt) onSelectOption?.(opt);
  };

  const handleClear = () => {
    setSelectedSifco("");
    setSelectedOption(null);
    setSearch("");
    setDebouncedSearch("");
    setPage(1);
    onSelect("");
  };

  useEffect(() => {
    if (reset) {
      handleClear();
      initialAppliedRef.current = false;
      onReset?.();
    }
  }, [reset, onReset]);

  // Autoselección cuando se llega con un crédito preseleccionado por URL
  useEffect(() => {
    if (!initialSifco || initialAppliedRef.current) return;
    const opt = opciones.find((o) => o.sifco === initialSifco);
    if (opt) {
      initialAppliedRef.current = true;
      setSelectedOption(opt);
      setSelectedSifco(opt.sifco);
      onSelect(opt.sifco);
    }
  }, [opciones, initialSifco, onSelect]);

  return (
    <div className="mb-4 w-full max-w-md flex flex-col gap-2">
      <Label htmlFor="buscador-usuario-sifco" className="text-blue-900 font-bold">
        Buscar usuario o crédito SIFCO
      </Label>
      <div className="flex gap-2 items-center">
        <Input
          type="text"
          id="buscador-usuario-sifco"
          placeholder="Nombre o número de crédito SIFCO"
          className="border px-4 py-2 rounded-lg text-gray-900 text-lg bg-white/90 flex-1"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoComplete="off"
        />
        {(selectedSifco || search) && (
          <button
            type="button"
            className="ml-1 p-2 rounded-full hover:bg-blue-100 transition"
            onClick={handleClear}
            title="Limpiar selección y búsqueda"
          >
            <XCircle className="w-5 h-5 text-blue-600" />
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="text-gray-400 px-2 py-2">Cargando...</div>
      ) : opciones.length === 0 ? (
        <div className="text-gray-400 px-2 py-2">No hay resultados</div>
      ) : (
        <>
          <Select value={selectedSifco || ""} onValueChange={handleChange}>
            <SelectTrigger className="w-full border px-4 py-2 rounded-lg text-gray-900 bg-white shadow hover:border-blue-400 focus:ring-2 focus:ring-blue-300 transition min-w-0 overflow-hidden">
              {selectedOption ? (
                <div className="flex items-center gap-3 min-w-0 w-full">
                  <User className="w-4 h-4 text-blue-700 flex-shrink-0" />
                  <span
                    className="font-bold text-blue-900 bg-blue-100 px-2 py-0.5 rounded-md truncate block max-w-[140px]"
                    title={selectedOption.nombre}
                  >
                    {selectedOption.nombre}
                  </span>
                  <BadgeDollarSign className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  <span
                    className="font-mono font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-md tracking-wider truncate block max-w-[110px]"
                    title={selectedOption.sifco}
                  >
                    {selectedOption.sifco}
                  </span>
                </div>
              ) : (
                <span className="text-gray-400">Selecciona un crédito SIFCO</span>
              )}
            </SelectTrigger>
            <SelectContent className="z-[80] bg-white border rounded-xl shadow-lg max-w-full w-full p-0">
              <div className="max-h-60 overflow-y-auto [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: "none" }}>
                {opciones.map((option) => (
                  <SelectItem
                    key={option.sifco}
                    value={option.sifco}
                    className="flex flex-col sm:flex-row sm:items-center gap-1 py-2 px-3 rounded-lg hover:bg-blue-50 transition-all w-full max-w-full"
                  >
                    <span className="flex items-center gap-2 min-w-0 max-w-full">
                      <User className="w-4 h-4 text-blue-700 flex-shrink-0" />
                      <span className="font-bold text-blue-900 bg-blue-100 px-2 py-0.5 rounded-md truncate max-w-[180px] whitespace-nowrap block">
                        {option.nombre}
                      </span>
                    </span>
                    <span className="flex items-center gap-1 min-w-0 max-w-full sm:ml-3">
                      <BadgeDollarSign className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                      <span className="font-mono font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-md tracking-wider truncate max-w-[150px] whitespace-nowrap block">
                        {option.sifco}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </div>
              {totalPages > 1 && (
                <div
                  className="flex items-center justify-between px-3 py-2 border-t border-blue-100 bg-blue-50/60"
                  onPointerDown={(e) => e.preventDefault()}
                >
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(p - 1, 1))}
                    disabled={page <= 1 || isLoading}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-blue-700 font-semibold text-sm hover:bg-blue-100 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Anterior
                  </button>
                  <span className="text-xs text-gray-600 font-medium">
                    {page} / {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                    disabled={page >= totalPages || isLoading}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-blue-700 font-semibold text-sm hover:bg-blue-100 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Siguiente
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </SelectContent>
          </Select>
        </>
      )}
    </div>
  );
}
