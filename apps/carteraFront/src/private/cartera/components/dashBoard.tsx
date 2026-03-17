import * as React from "react";
import {
  Banknote,
  CreditCard,
  ListOrdered,
  LogOut,
  Landmark,
  ChevronDown,
  Receipt,
} from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { useAuth } from "@/Provider/authProvider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

const menuOptions = [
  {
    key: "registro-prestamo",
    label: "Registro Crédito",
    icon: <Banknote className="h-5 w-5" />,
    path: "/realizarCredito",
    roles: ["ADMIN"],
  },
  {
    key: "registro-pago",
    label: "Registro Pago",
    icon: <CreditCard className="h-5 w-5" />,
    path: "/realizarPago",
    roles: ["ADMIN", "ASESOR"],
  },
  {
    key: "total-prestamos",
    label: "Créditos",
    icon: <ListOrdered className="h-5 w-5" />,
    path: "/creditos",
    roles: ["ADMIN", "CONTA", "ASESOR"],
  },
  {
    key: "total-pagos",
    label: "Pagos",
    icon: <ListOrdered className="h-5 w-5" />,
    path: "/pagos",
    roles: ["ADMIN", "CONTA", "ASESOR"],
  },
  {
    key: "investors",
    label: "Inversionistas",
    icon: <ListOrdered className="h-5 w-5" />,
    path: "/inversionistas",
    roles: ["ADMIN"],
  },
  {
    key: "liquidaciones-inversionistas",
    label: "Liquidaciones Inversionistas",
    icon: <Receipt className="h-5 w-5" />,
    path: "/liquidaciones-inversionistas",
    roles: ["ADMIN"],
  },
  {
    key: "advisors",
    label: "Usuarios",
    icon: <ListOrdered className="h-5 w-5" />,
    path: "/usuarios",
    roles: ["ADMIN"],
  },
  {
    key: "late-fee",
    label: "Moras",
    icon: <ListOrdered className="h-5 w-5" />,
    path: "/mora",
    roles: ["ADMIN"],
  },
  {
    key: "banks-fee",
    label: "Bancos",
    icon: <Landmark className="h-5 w-5" />,
    path: "/bancos",
    roles: ["ADMIN"],
  },
  {
    key: "summary-advisors",
    label: "Resumen de Asesores",
    icon: <ListOrdered className="h-5 w-5" />,
    path: "/resumenAsesores",
    roles: ["ADMIN", "ASESOR"],
  },
  {
    key: "payment-agreements",
    label: "Convenios",
    icon: <ListOrdered className="h-5 w-5" />,
    path: "/convenios",
    roles: ["ADMIN", "ASESOR"],
  },
  {
    key: "facturas-genericas",
    label: "Facturas Genéricas",
    icon: <Receipt className="h-5 w-5" />,
    path: "/facturas-genericas",
    roles: ["ADMIN"],
  },
  {
    key: "efectividad-asesores",
    label: "Efectividad",
    icon: <ListOrdered className="h-5 w-5" />,
    path: "/efectividad-asesores",
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

  return (
    <>
      {/* 🔥 NAVBAR DESKTOP (1280px+) - 100% ANCHO, CENTRADO */}
      <nav className="hidden xl:flex fixed top-0 left-0 right-0 z-40 bg-gradient-to-r from-white via-blue-50 to-white border-b-4 border-blue-600 shadow-lg">
        <div className="w-full px-6 flex items-center justify-center gap-4 py-3 min-h-[64px]">
          {/* Logo */}
          <div className="flex items-center flex-shrink-0">
            <img
              src="/logo-cashin.png"
              alt="Club Cashin Logo"
              className="h-10 drop-shadow-md"
              style={{ objectFit: "contain" }}
            />
          </div>

          {/* Menu Items - Centrado con wrap */}
          <div className="flex items-center justify-center gap-2 flex-wrap flex-1">
            {filteredOptions.map((opt) => (
              <button
                key={opt.key}
                onClick={() => navigate(opt.path)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-medium transition-all duration-200 whitespace-nowrap text-sm ${
                  location.pathname === opt.path
                    ? "bg-blue-600 text-white shadow-md scale-105"
                    : "text-gray-700 hover:bg-blue-100 hover:scale-105"
                }`}
              >
                {opt.icon}
                <span>{opt.label}</span>
              </button>
            ))}
          </div>

          {/* User Info + Logout */}
          <div className="flex items-center gap-3 flex-shrink-0">
            {user && (
              <div className="bg-blue-50 rounded-lg px-3 py-2 border border-blue-200">
                <p className="text-sm font-semibold text-gray-900">
                  {user.email.split("@")[0]}
                </p>
                <p className="text-xs text-gray-500">{user.role}</p>
              </div>
            )}

            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-red-600 font-medium hover:bg-red-50 transition-all duration-200"
            >
              <LogOut className="h-5 w-5" />
              <span className="text-sm">Salir</span>
            </button>
          </div>
        </div>
      </nav>

      {/* 🔥 NAVBAR MOBILE/TABLET (hasta 1280px) - 100% ANCHO, CENTRADO */}
      <nav className="xl:hidden fixed top-0 left-0 right-0 z-40 bg-gradient-to-r from-white via-blue-50 to-white border-b-4 border-blue-600 shadow-lg h-16">
        <div className="w-full h-full px-4 flex items-center justify-between">
          {/* Hamburguesa */}
          <button
            className="p-2 rounded-lg bg-white shadow-md border border-blue-100 hover:shadow-xl hover:scale-105 transition-all duration-200"
            onClick={() => setMenuOpen(true)}
            aria-label="Abrir menú"
          >
            <Menu className="h-6 w-6 text-blue-700" />
          </button>

          {/* Logo centrado */}
          <div className="absolute left-1/2 -translate-x-1/2">
            <img
              src="/logo-cashin.png"
              alt="Club Cashin Logo"
              className="h-8 drop-shadow-md"
              style={{ objectFit: "contain" }}
            />
          </div>

          {/* User Dropdown */}
          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 hover:bg-blue-100 transition-all">
                  <div className="text-right">
                    <p className="text-xs font-semibold text-gray-900">
                      {user.email.split("@")[0]}
                    </p>
                  </div>
                  <ChevronDown className="h-4 w-4 text-blue-600" />
                </button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end" className="w-48">
                <div className="px-3 py-2">
                  <p className="text-sm font-semibold text-gray-900">
                    {user.email.split("@")[0]}
                  </p>
                  <p className="text-xs text-gray-500">Rol: {user.role}</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleLogout}
                  className="text-red-600 cursor-pointer"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Cerrar sesión
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </nav>

      {/* 🔥 DRAWER MOBILE/TABLET */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 flex xl:hidden">
          {/* Overlay */}
          <div
            className="fixed inset-0 bg-black bg-opacity-40 backdrop-blur-sm animate-fadeIn"
            onClick={() => setMenuOpen(false)}
          />

          {/* Drawer */}
          <aside className="relative bg-gradient-to-b from-white to-blue-50 w-80 max-w-[85vw] h-full shadow-2xl border-r-4 border-blue-600 flex flex-col overflow-hidden animate-slideInLeft">
            {/* Botón cerrar */}
            <button
              className="absolute top-4 right-4 z-10 p-2 rounded-full bg-blue-50 hover:bg-blue-100 transition-all duration-200 hover:rotate-90"
              onClick={() => setMenuOpen(false)}
              aria-label="Cerrar menú"
            >
              <X className="h-6 w-6 text-blue-600" />
            </button>

            {/* Header */}
            <div className="flex-shrink-0 flex flex-col items-center justify-center py-6 px-6 border-b border-blue-100">
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
            </div>

            {/* Menu Items */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4">
              <div className="flex flex-col gap-2">
                {filteredOptions.map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => {
                      navigate(opt.path);
                      setMenuOpen(false);
                    }}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-all duration-200 text-left ${
                      location.pathname === opt.path
                        ? "bg-blue-600 text-white shadow-md"
                        : "text-gray-700 hover:bg-blue-100"
                    }`}
                  >
                    {opt.icon}
                    <span>{opt.label}</span>
                  </button>
                ))}

                {/* Logout en el drawer */}
                <div className="mt-4 pt-4 border-t border-blue-200">
                  <button
                    onClick={() => {
                      handleLogout();
                      setMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium text-red-600 hover:bg-red-50 transition-all duration-200"
                  >
                    <LogOut className="h-5 w-5" />
                    <span>Cerrar sesión</span>
                  </button>
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}