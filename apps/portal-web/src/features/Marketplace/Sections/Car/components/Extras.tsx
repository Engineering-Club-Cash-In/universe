import { type Vehicle } from "@/features/Marketplace/services/serviceMarketplace";

interface CarProps {
  vehicle: Vehicle;
}

export const ExtrasCar = ({ vehicle }: CarProps) => {
  return (
    <div className="bg-dark/75 rounded-3xl p-6">
      <h2 className="text-2xl font-bold text-white mb-4">Extras</h2>
      <div className="flex flex-wrap gap-2">
        {vehicle.extras.map((extra) => (
          <span
            key={extra}
            className="px-4 py-2 bg-primary/20 text-primary rounded-full text-sm font-medium"
          >
            {extra}
          </span>
        ))}
      </div>
    </div>
  );
};
