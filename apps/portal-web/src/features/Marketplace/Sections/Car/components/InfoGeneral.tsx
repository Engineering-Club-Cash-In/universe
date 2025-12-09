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
import { useIsMobile } from "@/hooks";

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

export const InfoGeneral = ({ vehicle }: CarProps) => {
  const { infoGeneral } = vehicle;
  const isMobile = useIsMobile();

  const size = isMobile ? { width: 14, height: 14 } : { width: 16, height: 16 };

  const infoConfig: InfoItem[] = [
    { key: "vin", label: "VIN", icon: <IconVinCar {...size} /> },
    {
      key: "stockCode",
      label: "Código de Stock",
      icon: <IconCodeStockCar {...size} />,
    },
    { key: "year", label: "Año", icon: <IconYearCar {...size} /> },
    { key: "asientos", label: "Asientos", icon: <IconSeatingCar {...size} /> },
    { key: "puertas", label: "Puertas", icon: <IconDoorCar {...size} /> },
    { key: "cilindros", label: "Cilindros", icon: <IconCylinder {...size} /> },
    { key: "color", label: "Color", icon: <IconColorCar {...size} /> },
    {
      key: "transmision",
      label: "Transmisión",
      icon: <IconGear {...size} />,
    },
    {
      key: "motorization",
      label: "Combustible",
      icon: <IconFuelCar {...size} />,
    },
    { key: "engine", label: "Motor", icon: <IconMotorCar {...size} /> },
    {
      key: "kpgCity",
      label: "KPG Ciudad",
      icon: <IconKPGCity {...size} />,
      format: (v) => `${v} km/gal`,
    },
    {
      key: "kpgHighway",
      label: "KPG Carretera",
      icon: <IconKPGRoad {...size} />,
      format: (v) => `${v} km/gal`,
    },
    {
      key: "typeHandling",
      label: "Tipo de Manejo",
      icon: <IconTypeManejo {...size} />,
    },
  ];

  return (
    <div>
      <h2 className="text-sm lg:text-2xl lg:font-bold text-white mb-4">
        Información General
      </h2>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex items-center gap-3">
          <div className="text-white/70 w-5 h-5 shrink-0">
            <IconConditionCar {...size} />
          </div>
          <div className="flex flex-col">
            <span className="text-white/50 text-xs lg:text-sm">
              Condición
            </span>
            <span className="text-white text-sm lg:text-base font-medium capitalize">
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
              <div className="text-primary lg:w-5 lg:h-5 shrink-0">{icon}</div>
              <div className="flex flex-col">
                <span className="text-white/50  text-xs lg:text-sm">{label}</span>
                <span className="text-white text-sm lg:text-base font-medium capitalize line-clamp-1 overflow-hidden text-ellipsis ">
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
