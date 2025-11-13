import * as React from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import { Banknote, CreditCard, ListOrdered, LogOut, Landmark } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { useAuth } from "@/Provider/authProvider"; 

const menuOptions = [
  {
    key: "registro-prestamo",
    label: "Registro Crédito",
    icon: <Banknote className="mr-2 h-5 w-5" />,
    path: "/realizarCredito",
    roles: ["ADMIN"],
  },
  {
    key: "registro-pago",
    label: "Registro Pago",
    icon: <CreditCard className="mr-2 h-5 w-5" />,
    path: "/realizarPago",
    roles: ["ADMIN", "ASESOR"],
  },
  {
    key: "total-prestamos",
    label: "Créditos",
    icon: <ListOrdered className="mr-2 h-5 w-5" />,
    path: "/creditos",
    roles: ["ADMIN", "CONTA", "ASESOR"],
  },
  {
    key: "total-pagos",
    label: "Pagos",
    icon: <ListOrdered className="mr-2 h-5 w-5" />,
    path: "/pagos",
    roles: ["ADMIN", "CONTA", "ASESOR"],
  },
  {
    key: "investors",
    label: "Inversionistas",
    icon: <ListOrdered className="mr-2 h-5 w-5" />,
    path: "/inversionistas",
    roles: ["ADMIN"],
  },
  {
    key: "advisors",
    label: "Usuarios",
    icon: <ListOrdered className="mr-2 h-5 w-5" />,
    path: "/usuarios",
    roles: ["ADMIN"],
  },
  {
    key: "late-fee",
    label: "Moras",
    icon: <ListOrdered className="mr-2 h-5 w-5" />,
    path: "/mora",
    roles: ["ADMIN"],
  },
   {
    key: "banks-fee",
    label: "Bancos",
    icon: <Landmark className="mr-2 h-5 w-5" />,
    path: "/bancos",
    roles: ["ADMIN"],
  },
  {
    key: "summary-advisors",
    label: "Resumen de Asesores",
    icon: <ListOrdered className="mr-2 h-5 w-5" />,
    path: "/resumenAsesores",
    roles: ["ADMIN", "ASESOR"],
  },
];

export function DashBoardCartera() {
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const { logout, user } = useAuth();

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  const filteredOptions = menuOptions.filter((opt) =>
    user ? opt.roles.includes(user.role) : false
  );

  const renderMenu = (closeMenu?: () => void) => (
    <SidebarMenu className="space-y-1">
      {filteredOptions.map((opt) => (
        <SidebarMenuItem key={opt.key}>
          <SidebarMenuButton
            isActive={location.pathname === opt.path}
            onClick={() => {
              navigate(opt.path);
              if (closeMenu) closeMenu();
            }}
            className={`w-full flex items-center text-left text-gray-900 font-medium rounded-lg transition-all duration-200 ease-in-out
              ${
                location.pathname === opt.path
                  ? "bg-white border border-blue-600 shadow-md font-bold ring-2 ring-blue-100 ring-inset scale-[1.02]"
                  : "hover:bg-blue-50 hover:scale-[1.01]"
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
  );

  return (
    <>
      {/* 🔹 Hamburguesa SOLO en mobile */}
      <button
        className="fixed top-4 left-4 z-50 md:hidden p-2 rounded-full bg-white shadow-lg border border-blue-100 hover:shadow-xl hover:scale-105 transition-all duration-200"
        onClick={() => setMenuOpen(true)}
        aria-label="Abrir menú"
      >
        <Menu className="h-7 w-7 text-blue-700" />
      </button>

      {/* 🔹 Sidebar COMPLETAMENTE ESTÁTICO - SIN COLAPSO - SIEMPRE VISIBLE */}
      <Sidebar 
        className="hidden md:flex fixed left-0 top-0 h-screen bg-gradient-to-b from-[#f8fbff] to-white border-r-4 border-blue-600 shadow-xl w-[260px] flex-col overflow-hidden"
        // ⚠️ IMPORTANTE: Quitamos cualquier prop que permita colapsar
      >
        {/* Header fijo en la parte superior */}
        <SidebarHeader className="flex-shrink-0 flex flex-col items-center justify-center py-6 px-6 border-b border-blue-100">
          <img
            src="/logo-cashin.png"
            alt="Club Cashin Logo"
            className="h-12 mb-3 drop-shadow-md"
            style={{ objectFit: "contain" }}
          />
          {user && (
            <div className="text-center bg-blue-50 rounded-lg px-4 py-2 w-full">
              <p className="text-sm font-semibold text-gray-900 truncate">
                Hola, {user.email.split("@")[0]}
              </p>
              <p className="text-xs text-gray-500 font-medium">
                Rol: {user.role}
              </p>
            </div>
          )}
        </SidebarHeader>

        {/* Contenido con scroll independiente */}
        <SidebarContent className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4">
          <div className="flex flex-col h-full justify-between">
            {/* Menú principal */}
            <div className="flex-1">
              {renderMenu()}
            </div>

            {/* Botón de logout fijo en la parte inferior */}
            <div className="mt-6 pt-4 border-t border-blue-100">
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={handleLogout}
                    className="w-full flex items-center text-left text-red-600 font-medium rounded-lg hover:bg-red-50 transition-all duration-200 hover:scale-[1.02]"
                  >
                    <LogOut className="mr-2 h-5 w-5" />
                    Cerrar sesión
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </div>
          </div>
        </SidebarContent>
        {/* ⚠️ REMOVIDO: SidebarRail (la barrita que permite colapsar) */}
      </Sidebar>

      {/* 🔹 Drawer en mobile - MEJORADO */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          {/* Overlay con animación */}
          <div
            className="fixed inset-0 bg-black bg-opacity-40 backdrop-blur-sm animate-fadeIn"
            onClick={() => setMenuOpen(false)}
          />
          
          {/* Drawer con animación de entrada */}
          <aside className="relative bg-gradient-to-b from-white to-blue-50 w-80 max-w-[85vw] h-full shadow-2xl border-r-4 border-blue-600 flex flex-col overflow-hidden animate-slideInLeft">
            {/* Botón de cerrar */}
            <button
              className="absolute top-4 right-4 z-10 p-2 rounded-full bg-blue-50 hover:bg-blue-100 transition-all duration-200 hover:rotate-90"
              onClick={() => setMenuOpen(false)}
              aria-label="Cerrar menú"
            >
              <X className="h-6 w-6 text-blue-600" />
            </button>

            {/* Header */}
            <SidebarHeader className="flex-shrink-0 flex flex-col items-center justify-center py-6 px-6 border-b border-blue-100">
              <img
                src="/logo-cashin.png"
                alt="Club Cashin Logo"
                className="h-12 mb-3"
                style={{ objectFit: "contain" }}
              />
              {user && (
                <div className="text-center bg-blue-50 rounded-lg px-4 py-2 w-full">
                  <p className="text-sm font-semibold text-gray-900 truncate">
                    Hola, {user.email.split("@")[0]}
                  </p>
                  <p className="text-xs text-gray-500 font-medium">
                    Rol: {user.role}
                  </p>
                </div>
              )}
            </SidebarHeader>

            {/* Contenido con scroll */}
            <SidebarContent className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4">
              <div className="flex flex-col h-full justify-between">
                <div className="flex-1">
                  {renderMenu(() => setMenuOpen(false))}
                </div>

                <div className="mt-6 pt-4 border-t border-blue-100">
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        onClick={() => {
                          handleLogout();
                          setMenuOpen(false);
                        }}
                        className="w-full flex items-center text-left text-red-600 font-medium rounded-lg hover:bg-red-50 transition-all duration-200"
                      >
                        <LogOut className="mr-2 h-5 w-5" />
                        Cerrar sesión
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </div>
              </div>
            </SidebarContent>
          </aside>
        </div>
      )}
    </>
  );
}