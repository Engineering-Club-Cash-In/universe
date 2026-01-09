import {
  IconCalendarSmall,
  IconCar2,
  IconSignDollar,
  NavBar,
  Loading,
  ModalChatBot,
} from "@/components";
import { useQuery } from "@tanstack/react-query";
import { getCredits, getNumbersSifco } from "../services";
import { getAsesorById } from "../services/investmentsService";
import { useIsMobile, useModalOptionsCall } from "@/hooks";
import { ContainerMenu } from "../components/ContainerMenu";
import { useStoreProfile } from "../store/useStoreProfile";
import { useAuth } from "@/lib";
import { useEffect } from "react";

export const MyLoans = () => {
  const { optionPayment, isModalOpen, setIsModalOpen } = useModalOptionsCall();
  const isMobile = useIsMobile();
  const { opportunities, setOpportunities } = useStoreProfile();
  const { user, token: sessionToken } = useAuth();

  // Query para obtener números SIFCO (con cache automático)
  const { data: sifcoNumbers, isLoading: isLoadingSifcoNumbers } = useQuery({
    queryKey: ["sifco-numbers", user?.email],
    queryFn: () => getNumbersSifco(user?.email ?? "", user?.dpi ?? "", sessionToken),
    enabled: !!user?.email && !!sessionToken && opportunities.length === 0,
  });

  // Guardar números SIFCO en el store cuando se cargan
  useEffect(() => {
    if (sifcoNumbers && sifcoNumbers.length > 0 && opportunities.length === 0) {
      setOpportunities(sifcoNumbers);
      console.log("Números SIFCO cargados:", sifcoNumbers);
    }
  }, [sifcoNumbers, setOpportunities, opportunities.length]);

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
  const getVehicleImage = (opportunity: (typeof opportunities)[0]) => {
    // Verificar si existe información del vehículo y fotos
    if (!opportunity?.vehicle?.photos || opportunity.vehicle.photos.length === 0) {
      return null;
    }
    
    // Buscar foto frontal primero
    const frontPhoto = opportunity.vehicle.photos.find(
      (photo) => photo.photoType === "front-view"
    );
    // Si no hay foto frontal, usar la primera foto disponible
    return frontPhoto?.url || opportunity.vehicle.photos[0]?.url || null;
  };

  // Verificar si la oportunidad tiene información completa del vehículo
  const hasVehicleInfo = (opportunity: (typeof opportunities)[0]) => {
    return !!(
      opportunity?.vehicle?.make &&
      opportunity?.vehicle?.model &&
      opportunity?.vehicle?.year
    );
  };

  // Función para contactar al asesor por WhatsApp
  const handleContactAsesor = async (asesorId: number, numeroSifco: string) => {
    try {
      const asesor = await getAsesorById(asesorId);
      
      // Usar el teléfono del asesor (phone o telefono)
      const phoneNumber = asesor.phone || asesor.telefono ;
      
      if (!phoneNumber) {
        console.error("El asesor no tiene un número de teléfono registrado");
        alert("No se pudo obtener el número del asesor");
        return;
      }

      // Crear el mensaje
      const mensaje = `Hola ${asesor.nombre.split(' ')[0]}, quiero realizar mi pago de mi crédito con número ${numeroSifco}`;
      
      // Limpiar el número de teléfono (quitar espacios, guiones, etc.)
      const cleanPhone = phoneNumber.replace(/\D/g, '');
      
      // Crear URL de WhatsApp con el mensaje
      const whatsappUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(mensaje)}`;
      
      // Abrir WhatsApp
      window.open(whatsappUrl, '_blank');
    } catch (error) {
      console.error("Error al contactar al asesor:", error);
      alert("No se pudo contactar al asesor. Intenta nuevamente.");
    }
  };

  if (isLoading || isLoadingSifcoNumbers) {
    return (
      <div>
        <NavBar />
        <ContainerMenu>
          <div className="max-w-7xl mx-auto mt-26 mb-20">
            <Loading />
          </div>
        </ContainerMenu>
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
              {credits.map((creditData) => {
                // Buscar la oportunidad correspondiente al número SIFCO del crédito
                const opportunity = opportunities.find(
                  (opp) =>
                    opp.numeroSifco === creditData.credito.numero_credito_sifco
                );

                // Si no se encuentra la oportunidad, no mostrar el crédito
                if (!opportunity) return null;

                const vehicleImage = getVehicleImage(opportunity);
                const showVehicleInfo = hasVehicleInfo(opportunity);

                return (
                  <div
                    key={creditData.credito.credito_id}
                    className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl overflow-hidden hover:border-primary/30 transition-colors"
                  >
                    <div className={`grid grid-cols-1 ${showVehicleInfo && vehicleImage ? 'lg:grid-cols-12' : ''} gap-4 lg:gap-6`}>
                      {/* Imagen del vehículo - Solo si existe */}
                      {showVehicleInfo && vehicleImage && (
                        <div className="lg:col-span-4">
                          <div className="relative h-[475px] lg:min-h-full">
                            <img
                              src={vehicleImage}
                              alt={`${opportunity.vehicle.make} ${opportunity.vehicle.model}`}
                              className="w-full h-full object-cover"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
                            <div className="absolute bottom-4 left-4 right-4">
                              <div className="flex items-center gap-2 mb-2">
                                <IconCar2 className="w-6 h-6 text-white" />
                                <span className="text-white/80 text-sm lg:text-base">
                                  {opportunity.vehicle.type || "Vehículo"}
                                </span>
                              </div>
                              <h3 className="text-white text-xl lg:text-2xl font-bold">
                                {opportunity.vehicle.make}
                              </h3>
                              <p className="text-white/90 lg:text-xl">
                                {opportunity.vehicle.model}{" "}
                                {opportunity.vehicle.year}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Información del crédito */}
                      <div className={`${showVehicleInfo && vehicleImage ? 'lg:col-span-8' : ''} p-4 lg:p-6`}>
                        {/* Header con número SIFCO y estado */}
                        <div className="flex justify-between items-start mb-6">
                          <div>
                            <h3 className="lg:text-body font-semibold mb-1">
                              {showVehicleInfo 
                                ? `Crédito ${opportunity.vehicle.make} ${opportunity.vehicle.model} ${opportunity.vehicle.year}`
                                : `Crédito ${creditData.credito.numero_credito_sifco}`
                              }
                            </h3>
                            <p className="text-sm text-white/65 mb-1">
                              Número {creditData.credito.numero_credito_sifco}
                            </p>
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
                              Monto del préstamo
                            </p>
                            <p className="lg:text-xl font-bold">
                              {formatCurrency(creditData.credito.capital)}
                            </p>
                          </div>

                          {/* Deuda Total */}
                          

                          {/* Cuota Mensual */}
                          <div>
                            <p className="text-sm lg:text-base text-white/65 mb-1">
                              Pago Mensual
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
                        </div>

                        {/* Fecha de Creación y Próximo Vencimiento - Fuera del grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
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
                              <p className="">
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
                                <p className="">
                                  {formatDate(
                                    creditData.cuotasPendientes[0]
                                      .fecha_vencimiento
                                  )}
                                </p>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Observaciones */}
                        {/*creditData.credito.observaciones && (
                          <div className="mb-6 p-3 bg-white/5 rounded-lg">
                            <p className="text-sm text-white/65 mb-1">
                              Observaciones
                            </p>
                            <p className="text-sm text-white/80">
                              {creditData.credito.observaciones}
                            </p>
                          </div>
                        )*/}

                        {/* Botón de realizar pago */}
                        {creditData.credito.statusCredit !== "CANCELADO" && (
                          <div className="flex justify-end pt-4 border-t border-white/10">
                            <button
                              className="px-6 py-2 lg:py-3 bg-primary hover:bg-primary/90 text-white font-semibold rounded-lg transition-colors flex items-center gap-2"
                              onClick={() => {
                                handleContactAsesor(
                                  creditData.credito.asesor_id,
                                  creditData.credito.numero_credito_sifco
                                );
                              }}
                            >
                              Realizar Pago
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
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
