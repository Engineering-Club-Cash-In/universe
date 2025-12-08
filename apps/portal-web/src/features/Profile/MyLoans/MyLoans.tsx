import { NavBar } from "@/components";
import { IconCalendarSmall, IconCar2, IconSignDollar } from "@/components";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib";
import { getCredits } from "../services";
import { useIsMobile, useModalOptionsCall } from "@/hooks";
import { ModalChatBot } from "@/components";
import { ContainerMenu } from "../components/ContainerMenu";

export const MyLoans = () => {
  const { user } = useAuth();
  const { optionPayment, isModalOpen, setIsModalOpen } = useModalOptionsCall();
  const isMobile = useIsMobile();

  // Obtener créditos
  const { data: credits, isLoading } = useQuery({
    queryKey: ["credits", user?.id],
    queryFn: () => getCredits(user?.id || ""),
    enabled: !!user?.id,
  });

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("es-GT", {
      style: "currency",
      currency: "GTQ",
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("es-GT", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "activo":
        return "text-green-400 bg-green-500/10 border-green-500/30";
      case "finalizado":
        return "text-gray-400 bg-gray-500/10 border-gray-500/30";
      case "pendiente":
        return "text-yellow-400 bg-yellow-500/10 border-yellow-500/30";
      case "atrasado":
        return "text-red-400 bg-red-500/10 border-red-500/30";
      default:
        return "text-white/70 bg-white/5 border-white/10";
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "activo":
        return "Activo";
      case "finalizado":
        return "Finalizado";
      case "pendiente":
        return "Pendiente";
      case "atrasado":
        return "Atrasado";
      default:
        return status;
    }
  };

  const getVehicleTypeLabel = (type: string) => {
    switch (type) {
      case "auto":
        return "Auto";
      case "moto":
        return "Moto";
      case "camioneta":
        return "Camioneta";
      case "pickup":
        return "Pickup";
      default:
        return type;
    }
  };

  if (isLoading) {
    return (
      <div>
        <NavBar />
        <div className="max-w-7xl mx-auto mt-26 mb-20">
          <div className="flex justify-center items-center py-20">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <NavBar />
      <ContainerMenu>
        <div className="">
          <h1 className="text-2xl lg:text-header-body font-bold mb-4 lg:mb-8">
            Mis Créditos
          </h1>

          {credits && credits.length > 0 ? (
            <div className="space-y-10">
              {credits.map((credit) => (
                <div
                  key={credit.id}
                  className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl overflow-hidden hover:border-primary/30 transition-colors"
                >
                  <div className="grid grid-cols-1 lg:grid-cols-12 gpa-4 lg:gap-6">
                    {/* Imagen del vehículo */}
                    <div className="lg:col-span-4">
                      <div className="relative h-full min-h-[250px] lg:min-h-full">
                        <img
                          src={credit.vehiculo.foto}
                          alt={`${credit.vehiculo.marca} ${credit.vehiculo.modelo}`}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-linear-to-t from-black/60 to-transparent"></div>
                        <div className="absolute bottom-4 left-4 right-4">
                          <div className="flex items-center gap-2 mb-2">
                            <IconCar2 className="w-6 h-6 text-white" />
                            <span className="text-white/80 text-sm lg:text-base">
                              {getVehicleTypeLabel(credit.vehiculo.tipo)}
                            </span>
                          </div>
                          <h3 className="text-white text-xl lg:text-2xl font-bold">
                            {credit.vehiculo.marca}
                          </h3>
                          <p className="text-white/90 lg:text-xl">
                            {credit.vehiculo.modelo}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Información del crédito */}
                    <div className="lg:col-span-8 p-4 lg:p-6">
                      {/* Header con ID y estado */}
                      <div className="flex justify-between items-start mb-6">
                        <div>
                          <h3 className="lg:text-body font-semibold mb-1">
                            Crédito #{credit.id}
                          </h3>
                        </div>
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-semibold border ${getStatusColor(
                            credit.estado
                          )}`}
                        >
                          {getStatusLabel(credit.estado)}
                        </span>
                      </div>

                      {/* Grid de información */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                        {/* Monto del préstamo */}
                        <div>
                          <p className="text-sm lg:text-base text-white/65 mb-1">
                            Monto del Préstamo
                          </p>
                          <p className="lg:text-xl font-bold">
                            {formatCurrency(credit.montoPrestamo)}
                          </p>
                        </div>

                        {/* Pago mensual */}
                        <div>
                          <p className="text-sm lg:text-base text-white/65 mb-1">
                            Pago Mensual
                          </p>
                          <p className="lg:text-xl font-bold">
                            {formatCurrency(credit.pagoMensual)}
                          </p>
                        </div>

                        {/* Tasa de interés */}
                        <div>
                          <p className="text-sm lg:text-base text-white/65 mb-1">
                            Tasa de Interés
                          </p>
                          <p className="lg:text-xl font-bold">
                            {credit.tasaInteres}%
                          </p>
                        </div>

                        {/* Pagos restantes */}
                        <div>
                          <p className="text-sm lg:text-base text-white/65 mb-1">
                            Pagos Restantes
                          </p>
                          <p className="lg:text-xl font-bold">
                            {credit.pagosRestantes}
                          </p>
                        </div>

                        {/* Fecha de inicio */}
                        <div className="flex items-center gap-4">
                          <div className=" flex items-center justify-center shrink-0">
                            <div className=" ">
                              <IconCalendarSmall
                                width={isMobile ? 18 : 24}
                                height={isMobile ? 18 : 24}
                              />
                            </div>
                          </div>
                          <div>
                            <p className="text-sm lg:text-base text-white/65 mb-1">
                              Fecha de Inicio
                            </p>
                            <p className="lg:text-xl font-semibold">
                              {formatDate(credit.fechaInicio)}
                            </p>
                          </div>
                        </div>

                        {/* Fecha de fin */}
                        <div className="flex items-center gap-4">
                          <div className=" flex items-center justify-center shrink-0">
                            <div className=" ">
                              <IconCalendarSmall
                                width={isMobile ? 18 : 24}
                                height={isMobile ? 18 : 24}
                              />
                            </div>
                          </div>
                          <div>
                            <p className="text-sm lg:text-base text-white/65 mb-1">
                              Fecha de Fin
                            </p>
                            <p className="lg:text-xl font-semibold">
                              {formatDate(credit.fechaFin)}
                            </p>
                          </div>
                        </div>

                        {/* Próximo pago - solo si no está finalizado */}
                        {credit.estado !== "finalizado" && (
                          <div className="flex items-center gap-4">
                            <div className=" flex items-center justify-center shrink-0">
                              <div className=" text-primary">
                                <IconSignDollar
                                  width={isMobile ? 18 : 24}
                                  height={isMobile ? 18 : 24}
                                />
                              </div>
                            </div>
                            <div>
                              <p className="text-sm lg:text-base text-white/65 mb-1">
                                Próximo Pago
                              </p>
                              <p className="lg:text-xl font-semibold">
                                {formatDate(credit.proximoPago)}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Botón de realizar pago */}
                      {(credit.estado === "activo" ||
                        credit.estado === "atrasado") && (
                        <div className="flex justify-end pt-4 border-t border-white/10">
                          <button
                            className="px-6 py-2 lg:py-3 bg-primary hover:bg-primary/90 text-white font-semibold rounded-lg transition-colors flex items-center gap-2"
                            onClick={() => {
                              setIsModalOpen(true);
                            }}
                          >
                            Realizar Pago
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-12 text-center">
              <IconCar2 className="w-16 h-16 text-white/30 mx-auto mb-4" />
              <p className="text-white/65 text-lg">No tienes créditos aún</p>
              <p className="text-white/50 text-sm mt-2">
                Solicita un crédito vehicular para verlo aquí
              </p>
            </div>
          )}
        </div>
      </ContainerMenu>

      <ModalChatBot
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        options={[optionPayment]}
      />
    </div>
  );
};
