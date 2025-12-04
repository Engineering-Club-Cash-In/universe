import { type Vehicle } from "@/features/Marketplace/services/serviceMarketplace";
import {
  IconCodeStockCar,
  IconVinCar,
  IconYearCar,
  IconSeatingCar,
  IconKPGCity,
  IconKPGRoad,
  IconCylinder,
  IconFuelCar,
  IconDoorCar,
  IconColorCar,
  IconGear,
  IconMotorCar,
  IconTypeManejo,
  IconConditionCar,
} from "@/components";
import { type JSX } from "react";

interface CarProps {
  vehicle: Vehicle;
}

type InfoKey = keyof Vehicle["infoGeneral"];

interface InfoItem {
  key: InfoKey;
  label: string;
  icon: JSX.Element;
  format?: (value: string | number) => string;
}

const infoConfig: InfoItem[] = [
  { key: "vin", label: "VIN", icon: <IconVinCar /> },
  { key: "stockCode", label: "Código de Stock", icon: <IconCodeStockCar /> },
  { key: "year", label: "Año", icon: <IconYearCar /> },
  { key: "asientos", label: "Asientos", icon: <IconSeatingCar /> },
  { key: "puertas", label: "Puertas", icon: <IconDoorCar /> },
  { key: "cilindros", label: "Cilindros", icon: <IconCylinder /> },
  { key: "color", label: "Color", icon: <IconColorCar /> },
  {
    key: "transmision",
    label: "Transmisión",
    icon: <IconGear width={20} height={16} />,
  },
  { key: "motorization", label: "Combustible", icon: <IconFuelCar /> },
  { key: "engine", label: "Motor", icon: <IconMotorCar /> },
  {
    key: "kpgCity",
    label: "KPG Ciudad",
    icon: <IconKPGCity />,
    format: (v) => `${v} km/gal`,
  },
  {
    key: "kpgHighway",
    label: "KPG Carretera",
    icon: <IconKPGRoad />,
    format: (v) => `${v} km/gal`,
  },
  { key: "typeHandling", label: "Tipo de Manejo", icon: <IconTypeManejo /> },
];

export const InfoGeneral = ({ vehicle }: CarProps) => {
  const { infoGeneral } = vehicle;

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-4">
        Información General
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex items-center gap-3">
          <div className="text-white/70 w-5 h-5 shrink-0">
            <IconConditionCar />
          </div>
          <div className="flex flex-col">
            <span className="text-white/50 text-sm">Condición</span>
            <span className="text-white font-medium capitalize">
              {vehicle.nuevo ? "Nuevo" : "Usado"}
            </span>
          </div>
        </div>
        {infoConfig.map(({ key, label, icon, format }) => {
          const value = infoGeneral[key];
          if (value === undefined || value === null || value === "")
            return null;

          const displayValue = format ? format(value) : String(value);

          return (
            <div key={key} className="flex items-center gap-3">
              <div className="text-primary w-5 h-5 shrink-0">{icon}</div>
              <div className="flex flex-col">
                <span className="text-white/50 text-sm">{label}</span>
                <span className="text-white font-medium capitalize">
                  {displayValue}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
