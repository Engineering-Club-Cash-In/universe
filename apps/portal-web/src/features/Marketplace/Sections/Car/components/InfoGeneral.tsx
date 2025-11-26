import { type Vehicle } from "@/features/Marketplace/services/serviceMarketplace";

interface CarProps {
  vehicle: Vehicle;
}

export const InfoGeneral = ({ vehicle }: CarProps) => {
  return (
    <div className="">
      <h2 className="text-2xl font-bold text-white mb-4">
        Información General
      </h2>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-white/50 text-sm">VIN</p>
          <p className="text-white font-medium">{vehicle.infoGeneral.vin}</p>
        </div>
        <div>
          <p className="text-white/50 text-sm">Color</p>
          <p className="text-white font-medium capitalize">
            {vehicle.infoGeneral.color}
          </p>
        </div>
        <div>
          <p className="text-white/50 text-sm">Asientos</p>
          <p className="text-white font-medium">
            {vehicle.infoGeneral.asientos}
          </p>
        </div>
        <div>
          <p className="text-white/50 text-sm">Puertas</p>
          <p className="text-white font-medium">
            {vehicle.infoGeneral.puertas}
          </p>
        </div>
        <div>
          <p className="text-white/50 text-sm">Cilindros</p>
          <p className="text-white font-medium">
            {vehicle.infoGeneral.cilindros}
          </p>
        </div>
        <div>
          <p className="text-white/50 text-sm">Transmisión</p>
          <p className="text-white font-medium capitalize">
            {vehicle.infoGeneral.transmision}
          </p>
        </div>
      </div>
    </div>
  );
};
