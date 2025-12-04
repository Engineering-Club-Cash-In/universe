import { type Vehicle } from "@/features/Marketplace/services/serviceMarketplace";
import { IconCheckCar } from "@/components";

interface CarProps {
  vehicle: Vehicle;
}

export const ExtrasCar = ({ vehicle }: CarProps) => {
  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-4">Extras</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4 gap-y-6">
        {vehicle.extras.map((extra) => (
          <div key={extra} className="flex items-center gap-2">
            <div className="w-5 h-5 text-primary shrink-0">
              <IconCheckCar />
            </div>
            <span className="text-white text-sm">{extra}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
