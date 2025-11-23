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
import { CreatePaymentAgreementForm } from "./private/cartera/components/paymentAgreement";

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
            <RoleRoute allowedRoles={["ADMIN"]}>
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
          path="bancos"
          element={
            <RoleRoute allowedRoles={["ADMIN"]}>
              <BancosManager />
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
            <RoleRoute allowedRoles={["ADMIN"]}>
              <CreatePaymentAgreementForm />
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
