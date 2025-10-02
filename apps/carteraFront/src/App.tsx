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

// 🎯 Restricción por roles
function RoleRoute({ children, allowedRoles }: { children: JSX.Element; allowedRoles: string[] }) {
  const { user } = useAuth(); // 👉 aquí tu contexto ya devuelve user con { role }
  if (!user) return <Navigate to="/login" replace />;
  if (!allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />; // 🚫 sin permisos
  }
  return children;
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
          {/* Solo ADMIN puede registrar créditos */}
          <Route
            path="realizarCredito"
            element={
              <RoleRoute allowedRoles={["ADMIN"]}>
                <CreditForm />
              </RoleRoute>
            }
          />

          {/* ADMIN y ASESOR pueden registrar pagos */}
          <Route
            path="realizarPago"
            element={
              <RoleRoute allowedRoles={["ADMIN", "ASESOR"]}>
                <PagoForm />
              </RoleRoute>
            }
          />

          {/* Todos pueden ver créditos */}
          <Route
            path="creditos"
            element={
              <RoleRoute allowedRoles={["ADMIN", "CONTA", "ASESOR"]}>
                <ListaCreditosPagos />
              </RoleRoute>
            }
          />

          {/* Todos pueden ver pagos */}
          <Route
            path="pagos"
            element={
              <RoleRoute allowedRoles={["ADMIN", "CONTA", "ASESOR"]}>
                <PaymentsTable />
              </RoleRoute>
            }
          />

          {/* Solo ADMIN puede manejar inversionistas */}
          <Route
            path="inversionistas"
            element={
              <RoleRoute allowedRoles={["ADMIN"]}>
                <TableInvestors />
              </RoleRoute>
            }
          />

          {/* Solo ADMIN puede manejar usuarios */}
          <Route
            path="usuarios"
            element={
              <RoleRoute allowedRoles={["ADMIN"]}>
                <AdvisorsManager />
              </RoleRoute>
            }
          />

          {/* Todos pueden ver pagos por crédito */}
          <Route
            path="pagos/:numero_credito_sifco"
            element={
              <RoleRoute allowedRoles={["ADMIN", "CONTA", "ASESOR"]}>
                <PaymentsCredits />
              </RoleRoute>
            }
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
