import { useParams } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { IconPDF } from "@/components/icons/IconPDF";
import { motion } from "framer-motion";
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
  SimilarCars,
} from "./components";
import { useIsMobile } from "@/hooks";

export const SearchCar = () => {
  const { id } = useParams({ strict: false });
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [loading, setLoading] = useState(true);
  const printRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

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

  if (isMobile) {
    return (
      <div className="w-full px-8 lg:px-10">
        {/* Layout de dos columnas */}
        <div ref={printRef} className="grid grid-cols-1 ">
          {/* COLUMNA 1 - Información principal del vehículo */}
          <div className="lg:col-span-2 space-y-6">
            {/* Carousel de imágenes */}
            <Carrousel vehicle={vehicle} />

            <div className="space-y-4">
              {/* Detalles del vehículo */}
              <DetailCar
                vehicle={vehicle}
                // eslint-disable-next-line
                // @ts-ignore
                printRef={printRef}
              />
            </div>

            <div className="grid grid-cols-2 gap-6 items-center">
              <CarSeller seller={vehicle.vendedor} />
              {/* Botones de acción */}
              <ButtonsActions
                vehicle={vehicle}
                // eslint-disable-next-line
                // @ts-ignore
                printRef={printRef}
              />
            </div>

            {/* Descripción */}
            <div className="">
              <h2 className="text-sm text-white mb-2">Descripción</h2>
              <p className="text-xs text-white/70 leading-relaxed">
                {vehicle.descripcion}
              </p>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="mt-4 flex items-center gap-2 p-2 text-[10px] bg-white text-black rounded-lg font-medium"
              >
                <IconPDF width={14} height={14} />
                Descargar Diagnóstico
              </motion.button>
            </div>

            {/* Información general */}
            <InfoGeneral vehicle={vehicle} />

            {/* Extras */}
            <ExtrasCar vehicle={vehicle} />
          </div>

          {/* COLUMNA 2 - Sidebar de información */}
          <div className="mt-8">
            {/* Información del vendedor */}

            <SimilarCars currentVehicleId={vehicle.id} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full px-8 lg:px-10">
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
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="mt-4 flex items-center gap-2 p-4 bg-white text-black rounded-lg font-medium"
            >
              <IconPDF />
              Descargar Diagnóstico
            </motion.button>
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
          <SimilarCars currentVehicleId={vehicle.id} />
        </div>
      </div>
    </div>
  );
};
