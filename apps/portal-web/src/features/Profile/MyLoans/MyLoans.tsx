import { NavBar } from "@/components";
import { IconCalendarSmall, IconCar2, IconSignDollar } from "@/components";
import { useQuery } from "@tanstack/react-query";
import { getCredits } from "../services";
import { useIsMobile, useModalOptionsCall } from "@/hooks";
import { ModalChatBot } from "@/components";
import { ContainerMenu } from "../components/ContainerMenu";
import { useStoreProfile } from "../store/useStoreProfile";

export const MyLoans = () => {
  const { optionPayment, isModalOpen, setIsModalOpen } = useModalOptionsCall();
  const isMobile = useIsMobile();
  const { opportunities } = useStoreProfile();

  // Extraer números SIFCO de las oportunidades
  const numerosSifco = opportunities.map((opp) => opp.numeroSifco);

  // Obtener créditos usando números SIFCO
  const { data: credits, isLoading } = useQuery({
    queryKey: ["credits", numerosSifco],
    queryFn: () => getCredits(numerosSifco),
    enabled: numerosSifco.length > 0,
  });

  const formatCurrency = (amount: string | number) => {
    const numAmount = typeof amount === "string" ? parseFloat(amount) : amount;
    return new Intl.NumberFormat("es-GT", {
      style: "currency",
      currency: "GTQ",
    }).format(numAmount);
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
      case "ACTIVO":
        return "text-green-400 bg-green-500/10 border-green-500/30";
      case "FINALIZADO":
        return "text-gray-400 bg-gray-500/10 border-gray-500/30";
      case "PENDIENTE":
        return "text-yellow-400 bg-yellow-500/10 border-yellow-500/30";
      case "ATRASADO":
        return "text-red-400 bg-red-500/10 border-red-500/30";
      default:
        return "text-white/70 bg-white/5 border-white/10";
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "ACTIVO":
        return "Activo";
      case "FINALIZADO":
        return "Finalizado";
      case "PENDIENTE":
        return "Pendiente";
      case "ATRASADO":
        return "Atrasado";
      default:
        return status;
    }
  };

  // Datos temporales del vehículo (quemados hasta integrar el endpoint del CRM)
  const vehiculoTemp = {
    marca: "Toyota",
    modelo: "Corolla 2023",
    foto: "https://images.unsplash.com/photo-1621007947382-bb3c3994e3fb?w=400",
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
              {credits.map((creditData) => (
                <div
                  key={creditData.credito.credito_id}
                  className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl overflow-hidden hover:border-primary/30 transition-colors"
                >
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6">
                    {/* Imagen del vehículo (temporal) */}
                    <div className="lg:col-span-4">
                      <div className="relative h-full min-h-[250px] lg:min-h-full">
                        <img
                          src={vehiculoTemp.foto}
                          alt={`${vehiculoTemp.marca} ${vehiculoTemp.modelo}`}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
                        <div className="absolute bottom-4 left-4 right-4">
                          <div className="flex items-center gap-2 mb-2">
                            <IconCar2 className="w-6 h-6 text-white" />
                            <span className="text-white/80 text-sm lg:text-base">
                              Vehículo Financiado
                            </span>
                          </div>
                          <h3 className="text-white text-xl lg:text-2xl font-bold">
                            {vehiculoTemp.marca}
                          </h3>
                          <p className="text-white/90 lg:text-xl">
                            {vehiculoTemp.modelo}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Información del crédito */}
                    <div className="lg:col-span-8 p-4 lg:p-6">
                      {/* Header con número SIFCO y estado */}
                      <div className="flex justify-between items-start mb-6">
                        <div>
                          <h3 className="lg:text-body font-semibold mb-1">
                            Crédito {creditData.credito.numero_credito_sifco}
                          </h3>
                          <p className="text-sm text-white/65">
                            Cliente: {creditData.usuario.nombre}
                          </p>
                        </div>
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-semibold border ${getStatusColor(
                            creditData.credito.statusCredit
                          )}`}
                        >
                          {getStatusLabel(creditData.credito.statusCredit)}
                        </span>
                      </div>

                      {/* Grid de información */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                        {/* Capital */}
                        <div>
                          <p className="text-sm lg:text-base text-white/65 mb-1">
                            Capital
                          </p>
                          <p className="lg:text-xl font-bold">
                            {formatCurrency(creditData.credito.capital)}
                          </p>
                        </div>

                        {/* Deuda Total */}
                        <div>
                          <p className="text-sm lg:text-base text-white/65 mb-1">
                            Deuda Total
                          </p>
                          <p className="lg:text-xl font-bold">
                            {formatCurrency(creditData.credito.deudatotal)}
                          </p>
                        </div>

                        {/* Cuota Mensual */}
                        <div>
                          <p className="text-sm lg:text-base text-white/65 mb-1">
                            Cuota Mensual
                          </p>
                          <p className="lg:text-xl font-bold">
                            {formatCurrency(creditData.credito.cuota)}
                          </p>
                        </div>

                        {/* Tasa de Interés */}
                        <div>
                          <p className="text-sm lg:text-base text-white/65 mb-1">
                            Tasa de Interés
                          </p>
                          <p className="lg:text-xl font-bold">
                            {creditData.credito.porcentaje_interes}%
                          </p>
                        </div>

                        {/* Plazo */}
                        <div>
                          <p className="text-sm lg:text-base text-white/65 mb-1">
                            Plazo
                          </p>
                          <p className="lg:text-xl font-bold">
                            {creditData.credito.plazo} meses
                          </p>
                        </div>

                        {/* Pagos Pendientes */}
                        <div>
                          <p className="text-sm lg:text-base text-white/65 mb-1">
                            Cuotas Pendientes
                          </p>
                          <p className="lg:text-xl font-bold">
                            {creditData.cuotasPendientes.length}
                          </p>
                        </div>

                        {/* Cuotas Atrasadas */}
                        {creditData.cuotasAtrasadas.length > 0 && (
                          <div>
                            <p className="text-sm lg:text-base text-white/65 mb-1">
                              Cuotas Atrasadas
                            </p>
                            <p className="lg:text-xl font-bold text-red-400">
                              {creditData.cuotasAtrasadas.length}
                            </p>
                          </div>
                        )}

                        {/* Mora Actual */}
                        {creditData.moraActual > 0 && (
                          <div>
                            <p className="text-sm lg:text-base text-white/65 mb-1">
                              Mora Actual
                            </p>
                            <p className="lg:text-xl font-bold text-red-400">
                              {formatCurrency(creditData.moraActual)}
                            </p>
                          </div>
                        )}

                        {/* Fecha de Creación */}
                        <div className="flex items-center gap-4">
                          <div className="flex items-center justify-center shrink-0">
                            <IconCalendarSmall
                              width={isMobile ? 18 : 24}
                              height={isMobile ? 18 : 24}
                            />
                          </div>
                          <div>
                            <p className="text-sm lg:text-base text-white/65 mb-1">
                              Fecha de Creación
                            </p>
                            <p className="lg:text-xl font-semibold">
                              {formatDate(creditData.credito.fecha_creacion)}
                            </p>
                          </div>
                        </div>

                        {/* Próxima Cuota */}
                        {creditData.cuotasPendientes.length > 0 && (
                          <div className="flex items-center gap-4">
                            <div className="flex items-center justify-center shrink-0">
                              <div className="text-primary">
                                <IconSignDollar
                                  width={isMobile ? 18 : 24}
                                  height={isMobile ? 18 : 24}
                                />
                              </div>
                            </div>
                            <div>
                              <p className="text-sm lg:text-base text-white/65 mb-1">
                                Próximo Vencimiento
                              </p>
                              <p className="lg:text-xl font-semibold">
                                {formatDate(creditData.cuotasPendientes[0].fecha_vencimiento)}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Observaciones */}
                      {creditData.credito.observaciones && (
                        <div className="mb-6 p-3 bg-white/5 rounded-lg">
                          <p className="text-sm text-white/65 mb-1">Observaciones</p>
                          <p className="text-sm text-white/80">
                            {creditData.credito.observaciones}
                          </p>
                        </div>
                      )}

                      {/* Botón de realizar pago */}
                      {creditData.credito.statusCredit === "ACTIVO" && (
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
