import { Routes, Route, Navigate } from "react-router-dom";
import { PaymentsCredits } from "./private/cartera/components/PaymentsCredits";
import { ListaCreditosPagos } from "./private/cartera/components/CreditsPaymentsData";
import { PagoForm } from "./private/cartera/components/PagoForm";
import { PaymentsTable } from "./private/cartera/components/paymentsTable";
import { TableInvestors } from "./private/cartera/components/tableInvestors";
import { CreditForm } from "./private/cartera/components/formCredit";
import { MainLayout } from "./private/cartera/components/mainLayout";
import LoginPage from "./public/login";
import { useAuth } from "./Provider/authProvider";
import AdvisorsManager from "./private/cartera/components/advisor";
import MorasManager from "./private/cartera/components/Latefee";
import CreditosPorAsesorManager from "./private/cartera/components/resumeAdvisor";
import { BancosManager } from "./private/cartera/components/bank";
import { CuentasEmpresaManager } from "./private/cartera/components/CuentasEmpresaManager";
import { CuentasExtraInversionistaManager } from "./private/cartera/components/CuentasExtraInversionistaManager";
import { CreatePaymentAgreementForm } from "./private/cartera/components/paymentAgreement";
import { FacturasGenericas } from "./private/cartera/components/FacturasGenericas";
import EfectividadAsesores from "./private/cartera/components/EfectividadAsesores";
import { HistorialLiquidaciones } from "./private/cartera/components/HistorialLiquidaciones";
import { SesionesPendientes } from "./private/cartera/components/SesionesPendientes";
import { RecibosGenericos } from "./private/recibos-genericos/components/RecibosGenericos";
import { FallenCredits } from "./private/cartera/components/FallenCredits";
import { PagosPorVencimiento } from "./private/cartera/components/PagosPorVencimiento";
import { MoraHistorial } from "./private/cartera/components/MoraHistorial";
import { BucketsHistorial } from "./private/cartera/components/BucketsHistorial";
import { BucketsCambiosAsesor } from "./private/cartera/components/BucketsCambiosAsesor";
import { DevolucionCube } from "./private/cartera/components/DevolucionCube";
import { CierreCartera } from "./private/cartera/components/CierreCartera";
import { FacturacionDiaria } from "./private/cartera/components/FacturacionDiaria";
import { CapitalInversionistas } from "./private/cartera/components/CapitalInversionistas";
import { Seguros } from "./private/cartera/components/Seguros";
import { ProyeccionInversionistas } from "./private/cartera/components/ProyeccionInversionistas";

// 🔒 Rutas privadas
function PrivateRoute({ children }: { children: JSX.Element }) {
  const { isLoggedIn, loading } = useAuth();
  if (loading) return <p>Cargando...</p>;
  return isLoggedIn ? children : <Navigate to="/login" replace />;
}

function PublicRoute({ children }: { children: JSX.Element }) {
  const { isLoggedIn, loading } = useAuth();
  if (loading) return <p>Cargando...</p>;
  return isLoggedIn ? <Navigate to="/" replace /> : children;
}

function RoleRoute({
  children,
  allowedRoles,
}: {
  children: JSX.Element;
  allowedRoles: string[];
}) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!allowedRoles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

function App() {
  return (
    <Routes>
      {/* Ruta pública */}
      <Route
        path="/login"
        element={
          <PublicRoute>
            <LoginPage />
          </PublicRoute>
        }
      />

      {/* Área privada */}
      <Route
        path="/"
        element={
          <PrivateRoute>
            <MainLayout />
          </PrivateRoute>
        }
      >
        <Route
          path="realizarCredito"
          element={
            <RoleRoute allowedRoles={["ADMIN", "CONTA"]}>
              <CreditForm />
            </RoleRoute>
          }
        />

        <Route
          path="realizarPago"
          element={
            <RoleRoute allowedRoles={["ADMIN", "ASESOR"]}>
              <PagoForm />
            </RoleRoute>
          }
        />

        <Route
          path="creditos"
          element={
            <RoleRoute allowedRoles={["ADMIN", "CONTA", "ASESOR"]}>
              <ListaCreditosPagos />
            </RoleRoute>
          }
        />

        <Route
          path="pagos"
          element={
            <RoleRoute allowedRoles={["ADMIN", "CONTA", "ASESOR"]}>
              <PaymentsTable />
            </RoleRoute>
          }
        />

        <Route
          path="inversionistas"
          element={
            <RoleRoute allowedRoles={["ADMIN"]}>
              <TableInvestors />
            </RoleRoute>
          }
        />

        <Route
          path="liquidaciones-inversionistas"
          element={
            <RoleRoute allowedRoles={["ADMIN"]}>
              <HistorialLiquidaciones />
            </RoleRoute>
          }
        />

        <Route
          path="sesiones-pendientes"
          element={
            <RoleRoute allowedRoles={["ADMIN"]}>
              <SesionesPendientes />
            </RoleRoute>
          }
        />

        <Route
          path="bancos"
          element={
            <RoleRoute allowedRoles={["ADMIN"]}>
              <BancosManager />
            </RoleRoute>
          }
        />

        <Route
          path="cuentas-empresa"
          element={
            <RoleRoute allowedRoles={["ADMIN", "CONTA"]}>
              <CuentasEmpresaManager />
            </RoleRoute>
          }
        />

        <Route
          path="cuentas-extra-inversionista"
          element={
            <RoleRoute allowedRoles={["ADMIN", "CONTA"]}>
              <CuentasExtraInversionistaManager />
            </RoleRoute>
          }
        />

        <Route
          path="mora"
          element={
            <RoleRoute allowedRoles={["ADMIN"]}>
              <MorasManager />
            </RoleRoute>
          }
        />

        <Route
          path="resumenAsesores"
          element={
            <RoleRoute allowedRoles={["ADMIN", "ASESOR"]}>
              <CreditosPorAsesorManager />
            </RoleRoute>
          }
        />

        <Route
          path="usuarios"
          element={
            <RoleRoute allowedRoles={["ADMIN"]}>
              <AdvisorsManager />
            </RoleRoute>
          }
        />

        <Route
          path="pagos/:numero_credito_sifco"
          element={
            <RoleRoute allowedRoles={["ADMIN", "CONTA", "ASESOR"]}>
              <PaymentsCredits />
            </RoleRoute>
          }
        />

        <Route
          path="convenios"
          element={
            <RoleRoute allowedRoles={["ADMIN", "ASESOR"]}>
              <CreatePaymentAgreementForm />
            </RoleRoute>
          }
        />

        <Route
          path="facturas-genericas"
          element={
            <RoleRoute allowedRoles={["ADMIN"]}>
              <FacturasGenericas />
            </RoleRoute>
          }
        />

        <Route
          path="efectividad-asesores"
          element={
            <RoleRoute allowedRoles={["ADMIN", "ASESOR"]}>
              <EfectividadAsesores />
            </RoleRoute>
          }
        />

        <Route
          path="recibos-genericos"
          element={
            <RoleRoute allowedRoles={["ADMIN"]}>
              <RecibosGenericos />
            </RoleRoute>
          }
        />

        <Route
          path="creditos-caidos"
          element={
            <RoleRoute allowedRoles={["ADMIN"]}>
              <FallenCredits />
            </RoleRoute>
          }
        />

        <Route
          path="pagos-por-vencimiento"
          element={
            <RoleRoute allowedRoles={["ADMIN"]}>
              <PagosPorVencimiento />
            </RoleRoute>
          }
        />

        <Route
          path="mora-historial"
          element={
            <RoleRoute allowedRoles={["ADMIN", "CONTA"]}>
              <MoraHistorial />
            </RoleRoute>
          }
        />

        {/* COBROS-02: módulos temporales de auditoría del motor de buckets */}
        <Route
          path="buckets-historial"
          element={
            <RoleRoute allowedRoles={["ADMIN", "CONTA"]}>
              <BucketsHistorial />
            </RoleRoute>
          }
        />

        <Route
          path="buckets-asesores"
          element={
            <RoleRoute allowedRoles={["ADMIN", "CONTA"]}>
              <BucketsCambiosAsesor />
            </RoleRoute>
          }
        />

        <Route
          path="devolucion-cube"
          element={
            <RoleRoute allowedRoles={["ADMIN"]}>
              <DevolucionCube />
            </RoleRoute>
          }
        />

        <Route
          path="cierre-cartera"
          element={
            <RoleRoute allowedRoles={["ADMIN"]}>
              <CierreCartera />
            </RoleRoute>
          }
        />

        <Route
          path="facturacion-diaria"
          element={
            <RoleRoute allowedRoles={["ADMIN", "CONTA"]}>
              <FacturacionDiaria />
            </RoleRoute>
          }
        />

        <Route
          path="capital-inversionistas"
          element={
            <RoleRoute allowedRoles={["ADMIN"]}>
              <CapitalInversionistas />
            </RoleRoute>
          }
        />

        <Route
          path="seguros"
          element={
            <RoleRoute allowedRoles={["ADMIN"]}>
              <Seguros />
            </RoleRoute>
          }
        />

        <Route
          path="proyeccion-inversionistas"
          element={
            <RoleRoute allowedRoles={["ADMIN"]}>
              <ProyeccionInversionistas />
            </RoleRoute>
          }
        />

        <Route index element={<ListaCreditosPagos />} />
      </Route>

      {/* 404 */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
