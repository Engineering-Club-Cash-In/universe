import { Select, Interval, CheckBox, Button } from "@/components";
import { useFilterStore } from "../store/filters";
import { useBarFilter } from "../hooks/useBarFilter";
import { useFilterNavigation } from "../hooks/useFilterNavigation";
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

  const { navigateToSearch } = useFilterNavigation();

  // Función wrapper reutilizable para manejar cambios de filtro con navegación
  const handleFilterChange = <T,>(setter: (value: T) => void) => {
    return (value: T) => {
      navigateToSearch();
      setter(value);
    };
  };

  return (
    <div className="w-full">
      {/* Radio Group - Condición */}
      <fieldset className="mb-6 border-none p-0 m-0">
        <div className="flex w-full justify-between items-center mb-5">
          <legend className="text-white text-base font-semibold ">
            Filtros
          </legend>
          <button
            onClick={() => {
              navigateToSearch();
              resetFilters();
            }}
            className="flex items-center gap-2 text-sm cursor-pointer"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="11"
              height="11"
              viewBox="0 0 11 11"
              fill="none"
            >
              <path
                opacity="0.99"
                d="M2.03021 10.0303L1.49988 9.49994L2.03021 10.0303ZM0.969666 10.0303L0.439335 10.5606L0.439391 10.5607L0.969666 10.0303ZM0.969666 8.96973L0.439335 8.4394L0.969666 8.96973ZM10.0302 8.96973L10.5606 8.43945L10.5605 8.4394L10.0302 8.96973ZM8.96967 10.0303L8.43934 10.5606L8.43939 10.5607L8.96967 10.0303ZM8.96967 0.969727L8.43934 0.439396L8.96967 0.969727ZM10.0302 0.969727L10.5606 0.439452L10.5605 0.439396L10.0302 0.969727ZM10.0302 2.03027L9.49988 1.49994L10.0302 2.03027ZM5.49994 6.56055L4.96961 6.03022L1.49988 9.49994L2.03021 10.0303L2.56054 10.5606L6.03027 7.09088L5.49994 6.56055ZM2.03021 10.0303L1.49988 9.49994L1.49994 9.49989L0.969666 10.0303L0.439391 10.5607C1.02511 11.1463 1.97472 11.1464 2.56054 10.5606L2.03021 10.0303ZM0.969666 10.0303L1.5 9.49994V9.50006L0.969666 8.96973L0.439335 8.4394C-0.146451 9.02518 -0.146451 9.97482 0.439335 10.5606L0.969666 10.0303ZM0.969666 8.96973L1.5 9.50006L4.96972 6.03033L4.43939 5.5L3.90906 4.96967L0.439335 8.4394L0.969666 8.96973ZM4.43939 5.5L3.90906 6.03033L4.96961 7.09088L5.49994 6.56055L6.03027 6.03022L4.96972 4.96967L4.43939 5.5ZM10.0302 8.96973L9.49983 9.5L9.49988 9.49994L10.0302 10.0303L10.5605 10.5606C11.1464 9.97478 11.1462 9.02518 10.5606 8.43945L10.0302 8.96973ZM10.0302 10.0303L9.49988 9.49994L9.49994 9.49989L8.96967 10.0303L8.43939 10.5607C9.02511 11.1463 9.97472 11.1464 10.5605 10.5606L10.0302 10.0303ZM8.96967 10.0303L9.5 9.49994L6.03027 6.03022L5.49994 6.56055L4.96961 7.09088L8.43934 10.5606L8.96967 10.0303ZM5.49994 6.56055L6.03027 7.09088L7.09082 6.03033L6.56049 5.5L6.03016 4.96967L4.96961 6.03022L5.49994 6.56055ZM6.56049 5.5L6.03016 6.03033L9.49988 9.50006L10.0302 8.96973L10.5605 8.4394L7.09082 4.96967L6.56049 5.5ZM0.969666 0.969727L1.5 1.50006H1.49988L2.03021 0.969727L2.56054 0.439396C1.97476 -0.14639 1.02512 -0.14639 0.439335 0.439396L0.969666 0.969727ZM2.03021 0.969727L1.49988 1.50006L4.96961 4.96978L5.49994 4.43945L6.03027 3.90912L2.56054 0.439396L2.03021 0.969727ZM5.49994 4.43945L4.96961 3.90912L3.90906 4.96967L4.43939 5.5L4.96972 6.03033L6.03027 4.96978L5.49994 4.43945ZM4.43939 5.5L4.96972 4.96967L1.5 1.49994L0.969666 2.03027L0.439335 2.5606L3.90906 6.03033L4.43939 5.5ZM0.969666 2.03027L1.5 1.49994V1.50006L0.969666 0.969727L0.439335 0.439396C-0.146451 1.02518 -0.146451 1.97482 0.439335 2.5606L0.969666 2.03027ZM8.96967 0.969727L9.5 1.50006H9.49988L10.0302 0.969727L10.5605 0.439396C9.97476 -0.14639 9.02512 -0.14639 8.43934 0.439396L8.96967 0.969727ZM10.0302 0.969727L9.49983 1.5L9.49988 1.49994L10.0302 2.03027L10.5605 2.5606C11.1464 1.97478 11.1462 1.02518 10.5606 0.439452L10.0302 0.969727ZM10.0302 2.03027L9.49988 1.49994L6.03016 4.96967L6.56049 5.5L7.09082 6.03033L10.5605 2.5606L10.0302 2.03027ZM6.56049 5.5L7.09082 4.96967L6.03027 3.90912L5.49994 4.43945L4.96961 4.96978L6.03016 6.03033L6.56049 5.5ZM5.49994 4.43945L6.03027 4.96978L9.5 1.50006L8.96967 0.969727L8.43934 0.439396L4.96961 3.90912L5.49994 4.43945Z"
                fill="white"
              />
            </svg>
            <span>Borrar</span>
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <motion.label
            className={`px-4 py-2 rounded-lg font-semibold transition-colors text-sm cursor-pointer ${
              condicion === "todos"
                ? "bg-primary text-white"
                : "bg-white/5 text-white/80 hover:bg-white/10"
            }`}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <input
              type="radio"
              name="condicion"
              value="todos"
              checked={condicion === "todos"}
              onChange={() => handleFilterChange(setCondicion)("todos")}
              className="sr-only"
            />{" "}
            Todos
          </motion.label>
          <motion.label
            className={`px-4 py-2 rounded-lg font-semibold transition-colors text-sm cursor-pointer ${
              condicion === "nuevo"
                ? "bg-primary text-white"
                : "bg-white/5 text-white/80 hover:bg-white/10"
            }`}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <input
              type="radio"
              name="condicion"
              value="nuevo"
              checked={condicion === "nuevo"}
              onChange={() => handleFilterChange(setCondicion)("nuevo")}
              className="sr-only"
            />{" "}
            Nuevos
          </motion.label>
          <motion.label
            className={`px-4 py-2 rounded-lg font-semibold transition-colors text-sm cursor-pointer ${
              condicion === "usado"
                ? "bg-primary text-white"
                : "bg-white/5 text-white/80 hover:bg-white/10"
            }`}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <input
              type="radio"
              name="condicion"
              value="usado"
              checked={condicion === "usado"}
              onChange={() => handleFilterChange(setCondicion)("usado")}
              className="sr-only"
            />{" "}
            Usados
          </motion.label>
        </div>
      </fieldset>

      {/* Selects */}
      <fieldset className="flex flex-col gap-3 mb-6 border-none p-0 m-0">
        <legend className="sr-only">Filtros de vehículo</legend>
        <Select
          value={marca}
          onChange={handleFilterChange(setMarca)}
          options={optionsMarca}
          placeholder="Marca"
          color="primary"
        />
        <Select
          value={modelo}
          onChange={handleFilterChange(setModelo)}
          options={optionsModelo}
          placeholder="Modelo"
          color="primary"
        />
        <Select
          value={tipo}
          onChange={(val) => handleFilterChange(setTipo)(val as typeof tipo)}
          options={optionsTipo}
          placeholder="Tipo"
          color="primary"
        />
        <Select
          value={combustible}
          onChange={(val) =>
            handleFilterChange(setCombustible)(val as typeof combustible)
          }
          options={optionsCombustible}
          placeholder="Combustible"
          color="primary"
        />
        <Select
          value={transmision}
          onChange={(val) =>
            handleFilterChange(setTransmision)(val as typeof transmision)
          }
          options={optionsTransmision}
          placeholder="Transmisión"
          color="primary"
        />
        <Select
          value={puertas.toString()}
          onChange={(val) =>
            handleFilterChange(setPuertas)(val ? Number(val) : "")
          }
          options={optionsPuertas}
          placeholder="Puertas"
          color="primary"
        />
        <Select
          value={cilindros.toString()}
          onChange={(val) =>
            handleFilterChange(setCilindros)(val ? Number(val) : "")
          }
          options={optionsCilindros}
          placeholder="Cilindros"
          color="primary"
        />
        <Select
          value={color}
          onChange={handleFilterChange(setColor)}
          options={optionsColor}
          placeholder="Color"
          color="primary"
        />
      </fieldset>

      {/* Intervals */}
      <div className="flex flex-col gap-5 mb-6">
        <Interval
          min={precioLimits.min}
          max={precioLimits.max}
          value={precioRange}
          onChange={handleFilterChange(setPrecioRange)}
          label="Rango de Precio"
        />
        <Interval
          min={anioLimits.min}
          max={anioLimits.max}
          value={anioRange}
          onChange={handleFilterChange(setAnioRange)}
          label="Año"
        />
        <Interval
          min={kmsLimits.min}
          max={kmsLimits.max}
          value={kmsRange}
          onChange={handleFilterChange(setKmsRange)}
          label="Kilómetros"
        />
      </div>

      {/* Extras Checkboxes */}
      <div className="mb-5">
        <h3 className="text-white text-base font-semibold mb-3">Extras</h3>
        <div className="max-h-64 overflow-y-auto flex flex-col gap-2 pr-2">
          {allExtras.map((extra) => (
            <CheckBox
              key={extra}
              checked={extras.includes(extra)}
              onChange={() => {
                navigateToSearch();
                toggleExtra(extra);
              }}
              label={extra}
            />
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2">
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
