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
import { Banknote, CreditCard, ListOrdered } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { useState } from "react";
import { Menu, X } from "lucide-react"; // Hamburguesa y cerrar
const menuOptions = [
  {
    key: "registro-prestamo",
    label: "Registro Crédito",
    icon: <Banknote className="mr-2 h-5 w-5" />,
    path: "/realizarCredito", // Ajusta la ruta según tus paths reales
  },
  {
    key: "registro-pago",
    label: "Registro Pago",
    icon: <CreditCard className="mr-2 h-5 w-5" />,
    path: "/realizarPago",
  },
  {
    key: "total-prestamos",
    label: "Créditos",
    icon: <ListOrdered className="mr-2 h-5 w-5" />,
    path: "/creditos",
  },
  {
    key: "total-pagos",
    label: "Pagos",
    icon: <ListOrdered className="mr-2 h-5 w-5" />,
    path: "/Pagos",
  },
  {
    key: "investors",
    label: "Inversionistas",
    icon: <ListOrdered className="mr-2 h-5 w-5" />,
    path: "/inversionistas",
  },
];

export function DashBoardCartera() {
  const navigate = useNavigate();
  const location = useLocation();
   const [menuOpen, setMenuOpen] = useState(false);
 return (
    <>
      {/* HAMBURGUESA EN MOBILE */}
      <button
        className="fixed top-4 left-4 z-50 md:hidden p-2 rounded-full bg-white shadow-lg border border-blue-100"
        onClick={() => setMenuOpen(true)}
        aria-label="Abrir menú"
      >
        <Menu className="h-7 w-7 text-blue-700" />
      </button>

      {/* SIDEBAR NORMAL EN DESKTOP */}
    <Sidebar
        className="hidden md:flex bg-[#f8fbff] border-r-8 border-blue-600 rounded-2xl shadow-lg mr-8 min-w-[260px] px-6 py-8 flex-col h-screen"
      >
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
                  isActive={location.pathname === opt.path}
                  onClick={() => navigate(opt.path)}
                  className={`w-full flex items-center text-left text-gray-900 font-medium rounded transition-all
                    ${
                      location.pathname === opt.path
                        ? "bg-white border border-blue-600 shadow-md font-bold ring-2 ring-blue-100 ring-inset"
                        : "hover:bg-blue-50"
                    }`}
                  style={
                    location.pathname === opt.path
                      ? { borderLeftWidth: 6, borderLeftColor: "#2563eb" }
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

      {/* DRAWER RESPONSIVO EN MOBILE */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 flex">
          {/* Fondo oscuro semi-transparente */}
          <div
            className="fixed inset-0 bg-black bg-opacity-30"
            onClick={() => setMenuOpen(false)}
          />
          {/* Drawer lateral */}
          <aside className="relative bg-white w-72 max-w-full h-full shadow-xl border-r-4 border-blue-600 rounded-r-2xl flex flex-col px-6 py-8 animate-slideInLeft">
            <button
              className="absolute top-4 right-4 p-2 rounded-full bg-blue-50 hover:bg-blue-100 transition"
              onClick={() => setMenuOpen(false)}
              aria-label="Cerrar menú"
            >
              <X className="h-6 w-6 text-blue-600" />
            </button>
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
                      isActive={location.pathname === opt.path}
                      onClick={() => {
                        navigate(opt.path);
                        setMenuOpen(false); // Cierra el menú
                      }}
                      className={`w-full flex items-center text-left text-gray-900 font-medium rounded transition-all
                      ${
                        location.pathname === opt.path
                          ? "bg-white border border-blue-600 shadow-md font-bold ring-2 ring-blue-100 ring-inset"
                          : "hover:bg-blue-50"
                      }`}
                      style={
                        location.pathname === opt.path
                          ? { borderLeftWidth: 6, borderLeftColor: "#2563eb" }
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
          </aside>
        </div>
      )}
    </>
  );
}