import { useParams } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import {
  getVehicleById,
  type Vehicle,
} from "../../services/serviceMarketplace";
import {
  CarSeller,
  Carrousel,
  InfoGeneral,
  DetailCar,
  ButtonsActions,
  ExtrasCar,
} from "./components";

export const SearchCar = () => {
  const { id } = useParams({ strict: false });
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [loading, setLoading] = useState(true);
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loadVehicle = async () => {
      if (!id) return;

      setLoading(true);
      const vehicleData = await getVehicleById(id);
      setVehicle(vehicleData || null);
      setLoading(false);
    };

    loadVehicle();
  }, [id]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-white text-xl">Cargando...</div>
      </div>
    );
  }

  if (!vehicle) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-white text-xl">Vehiculo no encontrado</div>
      </div>
    );
  }

  return (
    <div className="w-full pl-20 pr-10">
      {/* Layout de dos columnas */}
      <div ref={printRef} className="grid grid-cols-1 lg:grid-cols-3 gap-16">
        {/* COLUMNA 1 - Información principal del vehículo */}
        <div className="lg:col-span-2 space-y-10">
          {/* Carousel de imágenes */}
          <Carrousel vehicle={vehicle} />

          {/* Descripción */}
          <div className="">
            <h2 className="text-2xl font-bold text-white mb-2">Descripción</h2>
            <p className="text-white/70 leading-relaxed">
              {vehicle.descripcion}
            </p>
          </div>

          {/* Información general */}
          <InfoGeneral vehicle={vehicle} />

          {/* Extras */}
          <ExtrasCar vehicle={vehicle} />
        </div>

        {/* COLUMNA 2 - Sidebar de información */}
        <div className="space-y-6">
          {/* Información del vendedor */}
          <CarSeller seller={vehicle.vendedor} />

          {/* Detalles del vehículo */}
          <DetailCar vehicle={vehicle} />

          {/* Botones de acción */}
          <ButtonsActions
            vehicle={vehicle}
            // eslint-disable-next-line
            // @ts-ignore
            printRef={printRef}
          />
        </div>
      </div>
    </div>
  );
};
