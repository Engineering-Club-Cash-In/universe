import { type Vehicle } from "@/features/Marketplace/services/serviceMarketplace";
import { IconCheckCar } from "@/components";
import { useIsMobile } from "@/hooks";

interface CarProps {
  vehicle: Vehicle;
}

export const ExtrasCar = ({ vehicle }: CarProps) => {
  const isMobile = useIsMobile();
  return (
    <div>
      <h2 className="text-sm lg:text-2xl lg:font-bold text-white mb-4">
        Extras
      </h2>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-2 gap-y-4 lg:gap-x-4 lg:gap-y-6">
        {vehicle.extras.map((extra) => (
          <div key={extra} className="flex items-center gap-2">
            <div className="w-3 h-3 lg:w-5 lg:h-5 text-primary shrink-0">
              <IconCheckCar
                width={isMobile ? 10 : 16}
                height={isMobile ? 10 : 16}
              />
            </div>
            <span className="text-white text-xxs lg:text-sm">{extra}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
