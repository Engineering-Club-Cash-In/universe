import {
  NavBar,
  IconSignDollar,
  IconArrow,
  IconGraph,
  Button,
} from "@/components";
import { Menu } from "../components";
import { getInvestmentsStats, getInvestments } from "../services";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib";
import { useModalOptionsCall } from "@/hooks";
import { ModalChatBot } from "@/components";

export const MyInvestments = () => {
  const { user } = useAuth();

  const { isModalOpen, modalOptionsInvestors, setIsModalOpen } =
    useModalOptionsCall();

  // Obtener estadísticas
  const { data: stats, isLoading: loadingStats } = useQuery({
    queryKey: ["investments-stats", user?.id],
    queryFn: () => getInvestmentsStats(user?.id || ""),
    enabled: !!user?.id,
  });

  // Obtener inversiones
  const { data: investments, isLoading: loadingInvestments } = useQuery({
    queryKey: ["investments", user?.id],
    queryFn: () => getInvestments(user?.id || ""),
    enabled: !!user?.id,
  });

  const isLoading = loadingStats || loadingInvestments;

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
      case "activa":
        return "text-green-400 bg-green-500/10 border-green-500/30";
      case "finalizada":
        return "text-gray-400 bg-gray-500/10 border-gray-500/30";
      case "pendiente":
        return "text-yellow-400 bg-yellow-500/10 border-yellow-500/30";
      default:
        return "text-white/70 bg-white/5 border-white/10";
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "activa":
        return "Activa";
      case "finalizada":
        return "Finalizada";
      case "pendiente":
        return "Pendiente";
      default:
        return status;
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case "interes_compuesto":
        return "Interés Compuesto";
      case "tradicional":
        return "Tradicional";
      case "al_vencimiento":
        return "Al Vencimiento";
      default:
        return type;
    }
  };

  if (isLoading) {
    return (
      <div>
        <NavBar />
        <Menu />
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
      <Menu />
      <div className="max-w-7xl mx-auto mt-26 mb-20 px-8">
        <h1 className="text-header-body font-bold mb-8">Mis Inversiones</h1>

        {/* Estadísticas */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 mb-12">
            {/* Total Invertido */}
            <div
              className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6"
              style={
                {
                  /* borderRadius: "9.13px",
                background:
                  "linear-gradient(180deg, rgba(148, 153, 236, 0.25) 0%, rgba(84, 87, 134, 0.25) 100%)",
                boxShadow:
                  "0 2.282px 4.565px -2.282px rgba(0, 0, 0, 0.10), 0 4.565px 6.847px -1.141px rgba(0, 0, 0, 0.10), 0 0 0 0 rgba(0, 0, 0, 0.00), 0 0 0 0 rgba(0, 0, 0, 0.00)",
              */
                }
              }
            >
              <div className="flex items-center gap-4">
                <div className="bg-blue-200 text-blue-700 p-6 rounded-xl">
                  <IconSignDollar />
                </div>
                <div>
                  <p className="text-base  mb-1">Total Invertido</p>
                  <p className="text-2xl font-bold">
                    {formatCurrency(stats.totalInvertido)}
                  </p>
                </div>
              </div>
            </div>

            {/* Total Rendimiento */}
            <div
              className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6"
              style={
                {
                  /*
                borderRadius: "9.13px",
                background:
                  "linear-gradient(180deg, rgba(148, 153, 236, 0.25) 0%, rgba(84, 87, 134, 0.25) 100%)",
                boxShadow:
                  "0 2.282px 4.565px -2.282px rgba(0, 0, 0, 0.10), 0 4.565px 6.847px -1.141px rgba(0, 0, 0, 0.10), 0 0 0 0 rgba(0, 0, 0, 0.00), 0 0 0 0 rgba(0, 0, 0, 0.00)",
             */
                }
              }
            >
              <div className="flex items-center gap-4">
                <div className=" bg-green-200 text-green-700 p-6 rounded-xl">
                  <IconArrow width={24} height={24} />
                </div>
                <div>
                  <p className="text-base  mb-1">Rendimiento Total</p>
                  <p className="text-2xl font-bold">
                    {formatCurrency(stats.totalRendimiento)}
                  </p>
                </div>
              </div>
            </div>

            {/* Inversiones Activas */}
            <div
              className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6"
              style={
                {
                  /* borderRadius: "9.13px",
                background:
                  "linear-gradient(180deg, rgba(148, 153, 236, 0.25) 0%, rgba(84, 87, 134, 0.25) 100%)",
                boxShadow:
                  "0 2.282px 4.565px -2.282px rgba(0, 0, 0, 0.10), 0 4.565px 6.847px -1.141px rgba(0, 0, 0, 0.10), 0 0 0 0 rgba(0, 0, 0, 0.00), 0 0 0 0 rgba(0, 0, 0, 0.00)",
             */
                }
              }
            >
              <div className="flex items-center gap-4">
                <div className=" bg-fuchsia-200 p-6 rounded-xl">
                  <IconGraph />
                </div>
                <div>
                  <p className="text-base  mb-1">Inversiones Activas</p>
                  <p className="text-2xl font-bold">
                    {stats.inversionesActivas}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Lista de Inversiones */}
        <div>
          <h2 className="text-header-body font-bold mb-6">
            Todas tus Inversiones
          </h2>

          {investments && investments.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {investments.map((investment) => (
                <div
                  key={investment.id}
                  className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6 hover:border-primary/30 transition-colors"
                >
                  {/* Header de la card */}
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-body font-semibold mb-1">
                        Inversión #{investment.id}
                      </h3>
                    </div>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-semibold border ${getStatusColor(
                        investment.estado
                      )}`}
                    >
                      {getStatusLabel(investment.estado)}
                    </span>
                  </div>

                  {/* Información principal */}
                  <div className="space-y-3 mb-4">
                    <div className="flex justify-between">
                      <span className=" text-gray">Monto Invertido</span>
                      <span className="text-primary font-semibold">
                        {formatCurrency(investment.montoInvertido)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className=" text-white/65">Rendimiento Anual</span>
                      <span className=" font-semibold text-green-600">
                        {investment.rendimientoAnual}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray">Plazo</span>
                      <span className="text-primary font-semibold">
                        {investment.plazo} meses
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray">Rendimiento a la Fecha</span>
                      <span className=" font-semibold text-green-600">
                        {formatCurrency(investment.rendimientoALaFecha)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray">Tipo de Inversión</span>
                      <span className="text-primary font-semibold">
                        {getTypeLabel(investment.tipoInversion)}
                      </span>
                    </div>
                  </div>

                  {/* Fechas */}
                  <div className="border-t border-white/10 pt-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray">Inicio</span>
                      <span className="text-white/80">
                        {formatDate(investment.fechaInicio)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray">Fin</span>
                      <span className="text-white/80">
                        {formatDate(investment.fechaFin)}
                      </span>
                    </div>
                    {investment.montoUltimaCuota > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray">Última Cuota</span>
                        <span className="text-white/80">
                          {formatCurrency(investment.montoUltimaCuota)} -{" "}
                          {formatDate(investment.fechaUltimaCuota)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-12 text-center">
              <svg
                className="w-16 h-16 text-white/30 mx-auto mb-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
                />
              </svg>
              <p className="text-white/65 text-lg">No tienes inversiones aún</p>
              <p className="text-white/50 text-sm mt-2">
                Comienza a invertir para ver tus inversiones aquí
              </p>
            </div>
          )}
        </div>
        <div className="mt-8">
          <div className="text-header-body font-bold mb-6">
            Haz una nueva inversión
          </div>
          <Button onClick={() => setIsModalOpen(true)}>Nueva Inversión</Button>
        </div>
      </div>
      {isModalOpen && (
        <ModalChatBot
          open={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          options={modalOptionsInvestors}
        />
      )}
    </div>
  );
};
