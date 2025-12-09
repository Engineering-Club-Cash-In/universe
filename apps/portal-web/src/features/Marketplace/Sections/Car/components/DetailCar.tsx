import { type Vehicle } from "@/features/Marketplace/services/serviceMarketplace";
import { IconKms, IconGas, IconGear } from "@/components";
import { formatPrice } from "@/utils";
import { useIsMobile } from "@/hooks";
import type { RefObject } from "react";

interface CarProps {
  vehicle: Vehicle;
  printRef?: RefObject<HTMLDivElement>;
}

interface VehicleInfoProps {
  vehicle: Vehicle;
}

interface VehiclePriceProps {
  vehicle: Vehicle;
  printRef?: RefObject<HTMLDivElement>;
}

interface VehicleHeaderProps {
  vehicle: Vehicle;
}

interface VehicleSpecsProps {
  vehicle: Vehicle;
}

// Sub-componente: Encabezado con marca, modelo y año
export const VehicleHeader = ({ vehicle }: VehicleHeaderProps) => {
  return (
    <div>
      <p className="text-lg lg:text-5xl">
        {vehicle.marca} {vehicle.linea} {vehicle.modelo}
        <span
          className={`ml-2 px-1 lg:px-2 py-1 rounded-full text-xxs lg:font-semibold ${
            vehicle.nuevo
              ? "bg-green-500/90 text-white"
              : "bg-blue-500/90 text-white"
          }`}
        >
          {vehicle.nuevo ? "Nuevo" : "Usado"}
        </span>
      </p>
    </div>
  );
};

// Sub-componente: Especificaciones (km, transmisión, motorización)
export const VehicleSpecs = ({ vehicle }: VehicleSpecsProps) => {
  const isMobile = useIsMobile();
  const isMobi = isMobile
    ? { width: 16, height: 10 }
    : { width: 22, height: 16 };

  return (
    <div className="flex flex-wrap gap-4 lg:mt-4 ">
      {/* Kilómetros */}
      <div className="">
        <div className="flex items-center gap-1 lg:gap-3">
          <IconKms {...isMobi} />
          <div>
            <p className="text-white  text-sm lg:text-xl">
              {vehicle.kms.toLocaleString()} km
            </p>
          </div>
        </div>
      </div>

      {/* Transmisión */}
      <div className="">
        <div className="flex items-center gap-1 lg:gap-3 text-primary">
          <IconGear {...isMobi} />
          <div>
            <p className="text-white  text-sm lg:text-xl capitalize">
              {vehicle.transmision}
            </p>
          </div>
        </div>
      </div>

      {/* Motorización */}
      <div className="">
        <div className="flex items-center gap-1 lg:gap-3 text-primary">
          <IconGas {...isMobi} />
          <div>
            <p className="text-white  text-sm lg:text-xl capitalize">
              {vehicle.motorizacion}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

// Componente 1: Información básica del vehículo
export const VehicleInfo = ({ vehicle }: VehicleInfoProps) => {
  return (
    <div className="grid grid-cols-1 gap-2">
      <VehicleHeader vehicle={vehicle} />
      <VehicleSpecs vehicle={vehicle} />
    </div>
  );
};

// Componente 2: Precio y acciones
export const VehiclePrice = ({ vehicle }: VehiclePriceProps) => {

  return (
    <div className="grid grid-cols-1 lg:grid-cols-1  items-end justify-center">
      {/* Precio */}
      <div className="lg:mt-6 ">
        <div>
          <p className="text-primary text-xl lg:text-5xl mb-1 lg:mb-3">
            {formatPrice(vehicle.precio)}
          </p>
          {vehicle.cuotaMinima && (
            <p className="text-xs lg:text-xl mb-1">
              Cuota mensual desde:{" "}
              <span className="text-primary">
                {formatPrice(vehicle.cuotaMinima)}
              </span>
            </p>
          )}
          {vehicle.precioNuevo && (
            <p className="text-xs lg:text-xl">
              Precio nuevo:{" "}
              <span className="">{formatPrice(vehicle.precioNuevo)}</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

// Componente padre que contiene ambos
export const DetailCar = ({ vehicle, printRef }: CarProps) => {
  return (
    <div className="lg:bg-dark/75 rounded-3xl mt-2">
      <VehicleInfo vehicle={vehicle} />
      <VehiclePrice vehicle={vehicle} printRef={printRef} />
    </div>
  );
};
