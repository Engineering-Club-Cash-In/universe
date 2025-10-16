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
import { Banknote, CreditCard, ListOrdered, LogOut } from "lucide-react";
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
    <SidebarMenu>
      {filteredOptions.map((opt) => (
        <SidebarMenuItem key={opt.key}>
          <SidebarMenuButton
            isActive={location.pathname === opt.path}
            onClick={() => {
              navigate(opt.path);
              if (closeMenu) closeMenu();
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
  );

  return (
    <>
      {/* 🔹 Hamburguesa SOLO en mobile */}
      <button
        className="fixed top-4 left-4 z-50 md:hidden p-2 rounded-full bg-white shadow-lg border border-blue-100"
        onClick={() => setMenuOpen(true)}
        aria-label="Abrir menú"
      >
        <Menu className="h-7 w-7 text-blue-700" />
      </button>

      {/* 🔹 Sidebar FIJO en desktop (siempre visible, no colapsa) */}
      <Sidebar className="hidden md:flex bg-[#f8fbff] border-r-8 border-blue-600 rounded-2xl shadow-lg min-w-[260px] px-6 py-8 flex-col h-screen">
        <SidebarHeader className="flex flex-col items-center justify-center py-4">
          <img
            src="/logo-cashin.png"
            alt="Club Cashin Logo"
            className="h-10 mb-2"
            style={{ objectFit: "contain" }}
          />
          {user && (
            <div className="text-center">
              <p className="text-sm font-semibold text-gray-900">
                Hola, {user.email.split("@")[0]}
              </p>
              <p className="text-xs text-gray-500">Rol: {user.role}</p>
            </div>
          )}
        </SidebarHeader>
        <SidebarContent className="flex flex-col justify-between h-full">
          {renderMenu()}
          <div className="mt-6">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={handleLogout}
                  className="w-full flex items-center text-left text-red-600 font-medium rounded hover:bg-red-50 transition"
                >
                  <LogOut className="mr-2 h-5 w-5" />
                  Cerrar sesión
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </div>
        </SidebarContent>
        <SidebarRail />
      </Sidebar>

      {/* 🔹 Drawer en mobile */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black bg-opacity-30"
            onClick={() => setMenuOpen(false)}
          />
          <aside className="relative bg-white w-72 max-w-full h-full shadow-xl border-r-4 border-blue-600 rounded-r-2xl flex flex-col px-6 py-8 animate-slideInLeft">
            <button
              className="absolute top-4 right-4 p-2 rounded-full bg-blue-50 hover:bg-blue-100 transition"
              onClick={() => setMenuOpen(false)}
              aria-label="Cerrar menú"
            >
              <X className="h-6 w-6 text-blue-600" />
            </button>
            <SidebarHeader className="flex flex-col items-center justify-center py-4">
              <img
                src="/logo-cashin.png"
                alt="Club Cashin Logo"
                className="h-10 mb-2"
                style={{ objectFit: "contain" }}
              />
              {user && (
                <div className="text-center">
                  <p className="text-sm font-semibold text-gray-900">
                    Hola, {user.email.split("@")[0]}
                  </p>
                  <p className="text-xs text-gray-500">Rol: {user.role}</p>
                </div>
              )}
            </SidebarHeader>
            <SidebarContent className="flex flex-col justify-between h-full">
              {renderMenu(() => setMenuOpen(false))}
              <div className="mt-6">
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      onClick={() => {
                        handleLogout();
                        setMenuOpen(false);
                      }}
                      className="w-full flex items-center text-left text-red-600 font-medium rounded hover:bg-red-50 transition"
                    >
                      <LogOut className="mr-2 h-5 w-5" />
                      Cerrar sesión
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </div>
            </SidebarContent>
            <SidebarRail />
          </aside>
        </div>
      )}
    </>
  );
}
