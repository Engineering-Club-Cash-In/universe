import * as React from "react";
import {
  Banknote,
  CreditCard,
  ListOrdered,
  LogOut,
  Landmark,
  ChevronDown,
  Receipt,
  Users,
  TrendingUp,
  FolderOpen,
  FileText,
  Settings,
  BarChart3,
  Briefcase,
  TrendingDown,
  Clock,
  Wallet,
  PiggyBank,
} from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { useState, useRef, useEffect } from "react";
import { Menu, X } from "lucide-react";
import { CASHIN_LOGO_URL } from "@/lib/constants";
import { useAuth } from "@/Provider/authProvider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

// --- Secciones del menú ---
interface MenuItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  path: string;
  roles: string[];
}

interface MenuSection {
  key: string;
  label: string;
  icon: React.ReactNode;
  items: MenuItem[];
}

const menuSections: MenuSection[] = [
  {
    key: "operaciones",
    label: "Operaciones",
    icon: <Banknote className="h-4 w-4" />,
    items: [
      {
        key: "registro-prestamo",
        label: "Registro Crédito",
        icon: <Banknote className="h-4 w-4" />,
        path: "/realizarCredito",
        roles: ["ADMIN"],
      },
      {
        key: "registro-pago",
        label: "Registro Pago",
        icon: <CreditCard className="h-4 w-4" />,
        path: "/realizarPago",
        roles: ["ADMIN", "ASESOR"],
      },
    ],
  },
  {
    key: "cartera",
    label: "Cartera",
    icon: <Briefcase className="h-4 w-4" />,
    items: [
      {
        key: "total-prestamos",
        label: "Créditos",
        icon: <ListOrdered className="h-4 w-4" />,
        path: "/creditos",
        roles: ["ADMIN", "CONTA", "ASESOR"],
      },
      {
        key: "total-pagos",
        label: "Pagos",
        icon: <ListOrdered className="h-4 w-4" />,
        path: "/pagos",
        roles: ["ADMIN", "CONTA", "ASESOR"],
      },
      {
        key: "late-fee",
        label: "Moras",
        icon: <ListOrdered className="h-4 w-4" />,
        path: "/mora",
        roles: ["ADMIN"],
      },
      {
        key: "payment-agreements",
        label: "Convenios",
        icon: <ListOrdered className="h-4 w-4" />,
        path: "/convenios",
        roles: ["ADMIN", "ASESOR"],
      },
      {
        key: "creditos-caidos",
        label: "Créditos Caídos",
        icon: <TrendingDown className="h-4 w-4" />,
        path: "/creditos-caidos",
        roles: ["ADMIN"],
      },
      {
        key: "devolucion-cube",
        label: "Devolución Cube",
        icon: <Briefcase className="h-4 w-4" />,
        path: "/devolucion-cube",
        roles: ["ADMIN"],
      },
    ],
  },
  {
    key: "inversionistas",
    label: "Inversionistas",
    icon: <TrendingUp className="h-4 w-4" />,
    items: [
      {
        key: "investors",
        label: "Inversionistas",
        icon: <Users className="h-4 w-4" />,
        path: "/inversionistas",
        roles: ["ADMIN"],
      },
      {
        key: "liquidaciones-inversionistas",
        label: "Liquidaciones",
        icon: <Receipt className="h-4 w-4" />,
        path: "/liquidaciones-inversionistas",
        roles: ["ADMIN"],
      },
      {
        key: "sesiones-pendientes",
        label: "Sesiones Pendientes",
        icon: <Clock className="h-4 w-4" />,
        path: "/sesiones-pendientes",
        roles: ["ADMIN"],
      },
    ],
  },
  {
    key: "documentos",
    label: "Documentos",
    icon: <FolderOpen className="h-4 w-4" />,
    items: [
      {
        key: "facturas-genericas",
        label: "Facturas Genéricas",
        icon: <FileText className="h-4 w-4" />,
        path: "/facturas-genericas",
        roles: ["ADMIN"],
      },
      {
        key: "recibos-genericos",
        label: "Recibos Genéricos",
        icon: <Receipt className="h-4 w-4" />,
        path: "/recibos-genericos",
        roles: ["ADMIN"],
      },
    ],
  },
  {
    key: "administracion",
    label: "Administración",
    icon: <Settings className="h-4 w-4" />,
    items: [
      {
        key: "advisors",
        label: "Usuarios",
        icon: <Users className="h-4 w-4" />,
        path: "/usuarios",
        roles: ["ADMIN"],
      },
      {
        key: "banks-fee",
        label: "Bancos",
        icon: <Landmark className="h-4 w-4" />,
        path: "/bancos",
        roles: ["ADMIN"],
      },
      {
        key: "cuentas-empresa",
        label: "Cuentas de empresa",
        icon: <Wallet className="h-4 w-4" />,
        path: "/cuentas-empresa",
        roles: ["ADMIN", "CONTA"],
      },
      {
        key: "cuentas-extra-inversionista",
        label: "Cuentas extra inversionistas",
        icon: <CreditCard className="h-4 w-4" />,
        path: "/cuentas-extra-inversionista",
        roles: ["ADMIN", "CONTA"],
      },
    ],
  },
  {
    key: "reportes",
    label: "Reportes",
    icon: <BarChart3 className="h-4 w-4" />,
    items: [
      {
        key: "summary-advisors",
        label: "Resumen de Asesores",
        icon: <ListOrdered className="h-4 w-4" />,
        path: "/resumenAsesores",
        roles: ["ADMIN", "ASESOR"],
      },
      {
        key: "efectividad-asesores",
        label: "Efectividad",
        icon: <BarChart3 className="h-4 w-4" />,
        path: "/efectividad-asesores",
        roles: ["ADMIN", "ASESOR"],
      },
      {
        key: "pagos-por-vencimiento",
        label: "Pagos por Vencimiento",
        icon: <Receipt className="h-4 w-4" />,
        path: "/pagos-por-vencimiento",
        roles: ["ADMIN"],
      },
      {
        key: "cierre-cartera",
        label: "Cierre de Cartera",
        icon: <PiggyBank className="h-4 w-4" />,
        path: "/cierre-cartera",
        roles: ["ADMIN"],
      },
      {
        key: "capital-inversionistas",
        label: "Capital Inversionistas",
        icon: <TrendingUp className="h-4 w-4" />,
        path: "/capital-inversionistas",
        roles: ["ADMIN"],
      },
    ],
  },
];

// --- Dropdown para desktop ---
function NavDropdown({
  section,
  userRole,
  navigate,
  currentPath,
}: {
  section: MenuSection;
  userRole: string;
  navigate: (path: string) => void;
  currentPath: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const filteredItems = section.items.filter((item) =>
    item.roles.includes(userRole)
  );

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (filteredItems.length === 0) return null;

  const isActive = filteredItems.some((item) => item.path === currentPath);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-medium transition-all duration-200 whitespace-nowrap text-sm ${
          isActive
            ? "bg-blue-600 text-white shadow-md"
            : "text-gray-700 hover:bg-blue-100"
        }`}
      >
        {section.icon}
        <span>{section.label}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1.5 bg-white rounded-xl shadow-xl border border-blue-100 py-1.5 min-w-[200px] z-50 animate-in fade-in slide-in-from-top-1 duration-150">
          {filteredItems.map((item) => (
            <button
              key={item.key}
              onClick={() => {
                navigate(item.path);
                setOpen(false);
              }}
              className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium transition-colors ${
                currentPath === item.path
                  ? "bg-blue-50 text-blue-700"
                  : "text-gray-700 hover:bg-gray-50"
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function DashBoardCartera() {
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const { logout, user } = useAuth();

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  // Flat list for mobile drawer
  const allFilteredItems = menuSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) =>
        user ? item.roles.includes(user.role) : false
      ),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <>
      {/* NAVBAR DESKTOP (1280px+) */}
      <nav className="hidden xl:flex fixed top-0 left-0 right-0 z-40 bg-gradient-to-r from-white via-blue-50 to-white border-b-4 border-blue-600 shadow-lg">
        <div className="w-full px-6 flex items-center justify-center gap-3 py-3 min-h-[64px]">
          {/* Logo */}
          <div className="flex items-center flex-shrink-0">
            <img
              src={CASHIN_LOGO_URL}
              alt="Club Cashin Logo"
              className="h-14 drop-shadow-md"
              style={{ objectFit: "contain" }}
            />
          </div>

          {/* Menu Sections - Dropdowns */}
          <div className="flex items-center justify-center gap-1 flex-wrap flex-1">
            {user &&
              menuSections.map((section) => (
                <NavDropdown
                  key={section.key}
                  section={section}
                  userRole={user.role}
                  navigate={navigate}
                  currentPath={location.pathname}
                />
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

      {/* NAVBAR MOBILE/TABLET (hasta 1280px) */}
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
              src={CASHIN_LOGO_URL}
              alt="Club Cashin Logo"
              className="h-11 drop-shadow-md"
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

      {/* DRAWER MOBILE/TABLET */}
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
                src={CASHIN_LOGO_URL}
                alt="Club Cashin Logo"
                className="h-16 mb-3"
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

            {/* Menu Items por sección */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4">
              <div className="flex flex-col gap-1">
                {allFilteredItems.map((section, idx) => (
                  <div key={section.key}>
                    {idx > 0 && <div className="my-2 border-t border-blue-100" />}
                    <p className="px-4 py-2 text-xs font-bold text-blue-500 uppercase tracking-wider flex items-center gap-2">
                      {section.icon}
                      {section.label}
                    </p>
                    {section.items.map((item) => (
                      <button
                        key={item.key}
                        onClick={() => {
                          navigate(item.path);
                          setMenuOpen(false);
                        }}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg font-medium transition-all duration-200 text-left text-sm ${
                          location.pathname === item.path
                            ? "bg-blue-600 text-white shadow-md"
                            : "text-gray-700 hover:bg-blue-100"
                        }`}
                      >
                        {item.icon}
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </div>
                ))}

                {/* Logout */}
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
