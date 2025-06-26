import { BrowserRouter, Routes, Route } from "react-router-dom";
import { DashBoardCartera } from "./public";
  // Este lo vas a crear
import {  SidebarProvider } from "@/components/ui/sidebar";

import "./App.css";
import {PaymentsCredits} from "./public/cartera/components/PaymentsCredits";

function App() {
  return (
    <BrowserRouter>
      <SidebarProvider>
        <Routes>
          <Route path="/" element={<DashBoardCartera />} />
          <Route path="/pagos/:numero_credito_sifco" element={<PaymentsCredits></PaymentsCredits>} />
        </Routes>
        {/* Si usas SidebarInset aquí ponlo si lo quieres global */}
      </SidebarProvider>
    </BrowserRouter>
  );
}

export default App;
