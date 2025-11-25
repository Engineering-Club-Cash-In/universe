import { Select, Interval, CheckBox, Button } from "@/components";
import { useFilterStore } from "../store/filters";
import { useBarFilter } from "../hooks/useBarFilter";
import { motion } from "framer-motion";

export const BarFilters = () => {
  const {
    marca,
    modelo,
    tipo,
    combustible,
    transmision,
    puertas,
    cilindros,
    color,
    precioRange,
    anioRange,
    kmsRange,
    extras,
    condicion,
    setMarca,
    setModelo,
    setTipo,
    setCombustible,
    setTransmision,
    setPuertas,
    setCilindros,
    setColor,
    setPrecioRange,
    setAnioRange,
    setKmsRange,
    toggleExtra,
    setCondicion,
    resetFilters,
  } = useFilterStore();

  const {
    optionsMarca,
    optionsModelo,
    optionsTipo,
    optionsCombustible,
    optionsTransmision,
    optionsPuertas,
    optionsCilindros,
    optionsColor,
    allExtras,
    precioRange: precioLimits,
    anioRange: anioLimits,
    kmsRange: kmsLimits,
  } = useBarFilter();

  return (
    <div className="w-full">
      {/* Radio Group - Condición */}
      <div className="mb-6">
        <h3 className="text-white text-base font-semibold mb-3">
          Condición
        </h3>
        <div className="flex flex-col gap-2">
          <motion.button
            onClick={() => setCondicion("todos")}
            className={`px-4 py-2 rounded-lg font-semibold transition-colors text-sm ${
              condicion === "todos"
                ? "bg-primary text-white"
                : "bg-white/5 text-white/80 hover:bg-white/10"
            }`}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            Todos
          </motion.button>
          <motion.button
            onClick={() => setCondicion("nuevo")}
            className={`px-4 py-2 rounded-lg font-semibold transition-colors text-sm ${
              condicion === "nuevo"
                ? "bg-primary text-white"
                : "bg-white/5 text-white/80 hover:bg-white/10"
            }`}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            Nuevos
          </motion.button>
          <motion.button
            onClick={() => setCondicion("usado")}
            className={`px-4 py-2 rounded-lg font-semibold transition-colors text-sm ${
              condicion === "usado"
                ? "bg-primary text-white"
                : "bg-white/5 text-white/80 hover:bg-white/10"
            }`}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            Usados
          </motion.button>
        </div>
      </div>

      {/* Selects */}
      <div className="flex flex-col gap-3 mb-6">
        <Select
          value={marca}
          onChange={setMarca}
          options={optionsMarca}
          placeholder="Marca"
          color="primary"
        />
        <Select
          value={modelo}
          onChange={setModelo}
          options={optionsModelo}
          placeholder="Modelo"
          color="primary"
        />
        <Select
          value={tipo}
          onChange={(val) => setTipo(val as typeof tipo)}
          options={optionsTipo}
          placeholder="Tipo"
          color="primary"
        />
        <Select
          value={combustible}
          onChange={(val) => setCombustible(val as typeof combustible)}
          options={optionsCombustible}
          placeholder="Combustible"
          color="primary"
        />
        <Select
          value={transmision}
          onChange={(val) => setTransmision(val as typeof transmision)}
          options={optionsTransmision}
          placeholder="Transmisión"
          color="primary"
        />
        <Select
          value={puertas.toString()}
          onChange={(val) => setPuertas(val ? Number(val) : "")}
          options={optionsPuertas}
          placeholder="Puertas"
          color="primary"
        />
        <Select
          value={cilindros.toString()}
          onChange={(val) => setCilindros(val ? Number(val) : "")}
          options={optionsCilindros}
          placeholder="Cilindros"
          color="primary"
        />
        <Select
          value={color}
          onChange={setColor}
          options={optionsColor}
          placeholder="Color"
          color="primary"
        />
      </div>

      {/* Intervals */}
      <div className="flex flex-col gap-5 mb-6">
        <Interval
          min={precioLimits.min}
          max={precioLimits.max}
          value={precioRange}
          onChange={setPrecioRange}
          label="Rango de Precio"
        />
        <Interval
          min={anioLimits.min}
          max={anioLimits.max}
          value={anioRange}
          onChange={setAnioRange}
          label="Año"
        />
        <Interval
          min={kmsLimits.min}
          max={kmsLimits.max}
          value={kmsRange}
          onChange={setKmsRange}
          label="Kilómetros"
        />
      </div>

      {/* Extras Checkboxes */}
      <div className="mb-5">
        <h3 className="text-white text-base font-semibold mb-3">
          Extras
        </h3>
        <div className="max-h-[200px] overflow-y-auto flex flex-col gap-2 pr-2">
          {allExtras.map((extra) => (
            <CheckBox
              key={extra}
              checked={extras.includes(extra)}
              onChange={() => toggleExtra(extra)}
              label={extra}
            />
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2">
        <Button onClick={resetFilters} size="md">
          Limpiar Filtros
        </Button>
        <Button
          onClick={() => {
            /* Apply filters logic */
          }}
          size="md"
        >
          Aplicar Filtros
        </Button>
      </div>
    </div>
  );
};
