import { useState, useMemo, useEffect } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useUsersWithSifco } from "../hooks/getUsers";
import { User, BadgeDollarSign, XCircle } from "lucide-react";

type OpcionSifco = {
  usuario_id: number;
  nombre: string;
  sifco: string;
};

interface BuscadorUsuarioSifcoProps {
  onSelect: (sifco: string) => void;
  reset?: boolean;
  onReset?: () => void;
}

export function BuscadorUsuarioSifco({ onSelect, reset, onReset }: BuscadorUsuarioSifcoProps) {
  const { data = [], isLoading } = useUsersWithSifco();
  const [search, setSearch] = useState<string>("");
  const [selectedSifco, setSelectedSifco] = useState<string>(""); // ✅ "" en vez de undefined

  // Aplana los SIFCOs
  const opciones: OpcionSifco[] = useMemo(() => {
    const usuarios = data || [];
    
    return usuarios.flatMap(u =>
      u.numeros_credito_sifco.map(sifco => ({
        usuario_id: u.usuario_id,
        nombre: u.nombre,
        sifco,
      }))
    );
  }, [data]);

  // Filtra en tiempo real por nombre o sifco
  const opcionesFiltradas = useMemo(
    () =>
      opciones.filter(
        o =>
          o.nombre.toLowerCase().includes(search.toLowerCase()) ||
          o.sifco.toLowerCase().includes(search.toLowerCase())
      ),
    [opciones, search]
  );

  const selectedOption = opciones.find(o => o.sifco === selectedSifco);

  const handleChange = (valor: string) => {
    setSelectedSifco(valor);
    onSelect(valor);
  };

  const handleClear = () => {
    setSelectedSifco(""); // ✅ "" en vez de undefined
    setSearch("");
    onSelect("");
  };

  useEffect(() => {
    if (reset) {
      handleClear();
      onReset?.();
    }
  }, [reset, onReset]); // ✅ Agregué onReset a las dependencias

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
          onChange={e => setSearch(e.target.value)}
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
      ) : opcionesFiltradas.length === 0 ? (
        <div className="text-gray-400 px-2 py-2">No hay resultados</div>
      ) : (
        <Select
          value={selectedSifco || ""} // ✅ Siempre string, nunca undefined
          onValueChange={handleChange}
          disabled={opcionesFiltradas.length === 0}
        >
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
          <SelectContent className="bg-white border rounded-xl shadow-lg max-w-full w-full">
            {opcionesFiltradas.map((option) => (
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
          </SelectContent>
        </Select>
      )}
    </div>
  );
}