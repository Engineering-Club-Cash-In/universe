import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"; 
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

// 🔒 Rutas privadas
function PrivateRoute({ children }: { children: JSX.Element }) {
  const { isLoggedIn, loading } = useAuth();
  if (loading) return <p>Cargando...</p>; // evita el flicker
  return isLoggedIn ? children : <Navigate to="/login" replace />;
}

// 🌐 Rutas públicas (redirige si ya está logueado)
function PublicRoute({ children }: { children: JSX.Element }) {
  const { isLoggedIn, loading } = useAuth();
  if (loading) return <p>Cargando...</p>;
  return isLoggedIn ? <Navigate to="/" replace /> : children;
}

function App() {
  return (
    <BrowserRouter>
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

        {/* Rutas privadas */}
        <Route
          path="/"
          element={
            <PrivateRoute>
              <MainLayout />
            </PrivateRoute>
          }
        >
          <Route path="realizarCredito" element={<CreditForm />} />
          <Route path="realizarPago" element={<PagoForm />} />
          <Route path="creditos" element={<ListaCreditosPagos />} />
          <Route path="pagos" element={<PaymentsTable />} />
          <Route path="inversionistas" element={<TableInvestors />} />
          <Route path="asesores" element={<AdvisorsManager />} />
          <Route
            path="pagos/:numero_credito_sifco"
            element={<PaymentsCredits />}
          />
          <Route index element={<ListaCreditosPagos />} />
        </Route>

        {/* Ruta 404 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
