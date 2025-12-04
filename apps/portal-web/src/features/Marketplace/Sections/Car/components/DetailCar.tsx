import { type Vehicle } from "@/features/Marketplace/services/serviceMarketplace";
import { IconKms, IconGas, IconGear } from "@/components";
import { formatPrice } from "@/utils";

interface CarProps {
  vehicle: Vehicle;
}

export const DetailCar = ({ vehicle }: CarProps) => {
  return (
    <div className="bg-dark/75 rounded-3xl pt-2">
      <div className="space-y-4">
        {/* Marca - Línea - Modelo */}
        <div>
          <p className=" text-5xl">
            {vehicle.marca} {vehicle.linea} {vehicle.modelo}
            <span
              className={`ml-2 px-2 py-1 rounded-full text-xs font-semibold ${
                vehicle.nuevo
                  ? "bg-green-500/90 text-white"
                  : "bg-blue-500/90 text-white"
              }`}
            >
              {vehicle.nuevo ? "Nuevo" : "Usado"}
            </span>
          </p>
        </div>

        {/* Kilómetros */}
        <div className="pt-3 border-t border-white/10">
          <div className="flex items-center gap-3">
            <IconKms />
            <div>
              <p className="text-xl">
                {vehicle.kms.toLocaleString()} km
              </p>
            </div>
          </div>
        </div>

        {/* Transmisión */}
        <div className="pt-3 border-t border-white/10">
          <div className="flex items-center gap-3 text-primary">
            <IconGear width={20} height={20} />
            <div>
              <p className="text-white text-xl capitalize">
                {vehicle.transmision}
              </p>
            </div>
          </div>
        </div>

        {/* Motorización */}
        <div className="pt-3 border-t border-white/10">
          <div className="flex items-center gap-3 text-primary">
            <IconGas />
            <div>
              <p className="text-white  text-xl capitalize">
                {vehicle.motorizacion}
              </p>
            </div>
          </div>
        </div>

        {/* Precio */}
        <div className="pt-4 border-t border-white/10">
          <div>
            <p className="text-primary  text-5xl mb-3">
              {formatPrice(vehicle.precio)}
            </p>
            {vehicle.cuotaMinima && (
              <p className="text-xl">
                Cuota mensual desde: {" "}
                <span className="text-primary">
                  {formatPrice(vehicle.cuotaMinima)}
                </span>
              </p>
            )}
            {vehicle.precioNuevo && (
              <p className="text-xl">
                Precio nuevo:{" "}
                <span className="">
                  {formatPrice(vehicle.precioNuevo)}
                </span>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
