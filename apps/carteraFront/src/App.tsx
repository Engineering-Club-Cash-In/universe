import { BrowserRouter, Routes, Route } from "react-router-dom";
 
import { PaymentsCredits } from "./public/cartera/components/PaymentsCredits";
import { ListaCreditosPagos } from "./public/cartera/components/CreditsPaymentsData";
import { PagoForm } from "./public/cartera/components/PagoForm";
import { PaymentsTable } from "./public/cartera/components/paymentsTable";
import { TableInvestors } from "./public/cartera/components/tableInvestors";
import { CreditForm } from "./public/cartera/components/formCredit"; // Si tienes esta ruta
import { MainLayout } from "./public/cartera/components/mainLayout";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MainLayout />}>
          {/* Ajusta las rutas al path que usaste en el sidebar */}
          <Route path="realizarCredito" element={<CreditForm />} />
          <Route path="realizarPago" element={<PagoForm />} />
          <Route path="creditos" element={<ListaCreditosPagos />} />
          <Route path="Pagos" element={<PaymentsTable />} />
          <Route path="inversionistas" element={<TableInvestors />} />
          <Route path="pagos/:numero_credito_sifco" element={<PaymentsCredits />} />
          <Route index element={<ListaCreditosPagos />} /> {/* Ruta por defecto */}
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
export default App;
