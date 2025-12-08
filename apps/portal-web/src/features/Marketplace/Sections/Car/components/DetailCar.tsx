import { type Vehicle } from "@/features/Marketplace/services/serviceMarketplace";
import { IconKms, IconGas, IconGear } from "@/components";
import { formatPrice } from "@/utils";
import { useIsMobile } from "@/hooks";
import { IconsActionsSocial } from "./ButtonsActions";
import type { RefObject } from "react";

interface CarProps {
  vehicle: Vehicle;
  printRef?: RefObject<HTMLDivElement>;
}

export const DetailCar = ({ vehicle, printRef }: CarProps) => {
  const isMobile = useIsMobile();
  const isMobi = isMobile
    ? { width: 16, height: 10 }
    : { width: 22, height: 16 };
  return (
    <div className="lg:bg-dark/75 rounded-3xl mt-2">
      <div className="grid grid-cols-2 lg:grid-cols-1">
        {/* Marca - Línea - Modelo */}
        <div>
          <p className="lg:text-5xl">
            {vehicle.marca} {vehicle.linea} {vehicle.modelo}
            <span
              className={`ml-2 px-1 lg:px-2 py-1 rounded-full text-mini lg:font-semibold ${
                vehicle.nuevo
                  ? "bg-green-500/90 text-white"
                  : "bg-blue-500/90 text-white"
              }`}
            >
              {vehicle.nuevo ? "Nuevo" : "Usado"}
            </span>
          </p>
        </div>

        <div className="grid grid-cols-2 gap-x-0 gap-y-4 lg:mt-4 ">
          {/* Kilómetros */}
          <div className="">
            <div className="flex items-center gap-1 lg:gap-3">
              <IconKms {...isMobi} />
              <div>
                <p className="text-white  text-xxs lg:text-xl">
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
                <p className="text-white  text-xxs lg:text-xl capitalize">
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
                <p className="text-white  text-xxs lg:text-xl capitalize">
                  {vehicle.motorizacion}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-1">
        {/* Precio */}
        <div className=" mt-4 lg:mt-6 ">
          <div>
            <p className="text-primary text-lg  lg:text-5xl mb-3">
              {formatPrice(vehicle.precio)}
            </p>
            {vehicle.cuotaMinima && (
              <p className="text-xxs lg:text-xl mb-1">
                Cuota mensual desde:{" "}
                <span className="text-primary">
                  {formatPrice(vehicle.cuotaMinima)}
                </span>
              </p>
            )}
            {vehicle.precioNuevo && (
              <p className="text-xxs lg:text-xl">
                Precio nuevo:{" "}
                <span className="">{formatPrice(vehicle.precioNuevo)}</span>
              </p>
            )}
          </div>
        </div>
        {isMobile && (
          <IconsActionsSocial vehicle={vehicle} printRef={printRef} />
        )}
      </div>
    </div>
  );
};
