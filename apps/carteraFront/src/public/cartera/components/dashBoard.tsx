import * as React from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarRail,
} from "@/components/ui/sidebar";
 
import { CreditForm } from "./formCredit";
import { Banknote, CreditCard, ListOrdered } from "lucide-react"; // 👈 Íconos aquí
 
import { PagoForm } from "./PagoForm";
import { ListaCreditosPagos } from "./CreditsPaymentsData";
import { PaymentsTable } from "./paymentsTable";

const menuOptions = [
  {
    key: "registro-prestamo",
    label: "Registro Crédito",
    icon: <Banknote className="mr-2 h-5 w-5" />,
  },
  {
    key: "registro-pago",
    label: "Registro Pago",
    icon: <CreditCard className="mr-2 h-5 w-5" />,
  },
  {
    key: "total-prestamos",
    label: "Prestamos",
    icon: <ListOrdered className="mr-2 h-5 w-5" />,
  },
   {
    key: "total-pagos",
    label: "Pagos",
    icon: <ListOrdered className="mr-2 h-5 w-5" />,
  },
];

export function DashBoardCartera() {
  const [selected, setSelected] = React.useState(menuOptions[0].key);

  return (
    <div className="flex min-h-screen w-full bg-white">
      {/* Sidebar gris claro, letras negras */}
  <Sidebar className="
  bg-[#f8fbff]
  border-r-8 border-blue-600
  rounded-2xl
  shadow-lg
  mr-8           // Solo margen derecho, para separar del main
  min-w-[260px]
  px-6 py-8
  flex flex-col
">
        <SidebarHeader className="flex items-center justify-center py-4">
          <img
            src="/logo-cashin.png"
            alt="Club Cashin Logo"
            className="h-10"
            style={{ objectFit: "contain" }}
          />
        </SidebarHeader>
        <SidebarContent>
          <SidebarMenu>
            {menuOptions.map((opt) => (
              <SidebarMenuItem key={opt.key}>
                <SidebarMenuButton
                  isActive={selected === opt.key}
                  onClick={() => setSelected(opt.key)}
                  className={`w-full flex items-center text-left text-gray-900 font-medium rounded transition-all
    ${
      selected === opt.key
        ? "bg-white border border-blue-600 shadow-md font-bold ring-2 ring-blue-100 ring-inset"
        : "hover:bg-blue-50"
    }`}
                  style={
                    selected === opt.key
                      ? { borderLeftWidth: 6, borderLeftColor: "#2563eb" } // azul-600 tailwind
                      : undefined
                  }
                >
                  {opt.icon}
                  {opt.label}
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarContent>
        <SidebarRail />
      </Sidebar>

      {/* Contenido totalmente blanco */}
<main className="flex flex-col items-center mt-4 w-full">
  {selected === "registro-prestamo" && (
    <div className="flex items-center justify-center w-full">
      {/* El CreditForm ahora ocupa hasta 5xl si hay espacio */}
      <div className="w-full max-w-5xl">
        <CreditForm />
      </div>
    </div>
  )}
  {selected === "registro-pago" && (
    <div className="flex items-center justify-center w-full">
      {/* El CreditForm ahora ocupa hasta 5xl si hay espacio */}
      <div className="w-full max-w-5xl">
      <PagoForm />
      </div>
    </div>
  )}
 {selected === "total-prestamos" && (
  <div className="flex items-center justify-center w-full  ">
    <div className="w-full">
      <ListaCreditosPagos   />
    </div>
  </div>
)}
 {selected === "total-pagos" && (
  <div className="flex items-center justify-center w-full  ">
    <div className="w-full">
      <PaymentsTable   />
    </div>
  </div>
)}
</main>

    </div>
  );
}
