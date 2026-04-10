import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "./Link";
import { useMatchRoute } from "@tanstack/react-router";
import {
  IconMenu,
  IconX,
  IconPerson,
  IconArrow,
  IconCar2,
  IconDocument,
  IconOut,
} from "../icons";
import { useIsMobile } from "@/hooks";
import { useAuth } from "@/lib/useAuth";
import { authClient } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { IconCCI } from "../IconCCI";
import { Button } from "./Button";

export const NavBar = () => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);

  const matchRoute = useMatchRoute();
  const { isAuthenticated, user } = useAuth();
  const queryClient = useQueryClient();

  const defaultNavItems = [
    { label: "Solicita tu crédito", href: "/credit" },
    { label: "Autos en venta", href: "/marketplace", disabled: true },
    { label: "Vendemos tu auto", href: "/sell", disabled: true },
    {
      label: "Invierte con nosotros",
      href: "/invest"
    },
  ];

  const userMenuItems = [
    { label: "Inicia sesión", href: "/login" },
    { label: "Regístrate", href: "/register" },
  ];

  // Items del menú de perfil (cuando está autenticado)
  const allProfileMenuItems = [
    {
      id: "/profile",
      label: "Mi Perfil",
      icon: <IconPerson width="24" height="24" />,
      roles: ["CLIENT", "INVESTOR"],
    },
    {
      id: "/investments",
      label: "Mis Inversiones",
      icon: <IconArrow width="24" height="24" />,
      roles: ["INVESTOR"],
    },
    {
      id: "/loans",
      label: "Mis Préstamos",
      icon: <IconCar2 width="24" height="24" />,
      roles: ["CLIENT"],
    },
    {
      id: "/documents",
      label: "Documentos",
      icon: <IconDocument width="24" height="24" />,
      roles: ["CLIENT", "INVESTOR"],
    },
  ];

  // Filtrar por rol del usuario
  const filteredProfileItems = allProfileMenuItems.filter((item) =>
    item.roles.includes(user?.role || "CLIENT")
  );

  // Si no tiene DPI, solo mostrar "Mi Perfil"
  const profileMenuItems =  filteredProfileItems;

  const handleLogout = async () => {
    try {
      await authClient.signOut();
    } catch (error) {
      console.error("Error during logout:", error);
    } finally {
      queryClient.setQueryData(["auth", "session"], null);
      queryClient.removeQueries({ queryKey: ["auth", "session"] });
      setIsMobileMenuOpen(false);
      globalThis.location.href = "/login";
    }
  };

  const closeMobileMenu = () => setIsMobileMenuOpen(false);
  const isMobile = useIsMobile();

  return (
    <>
      {/* Desktop: fondo gradiente full-width detrás de la navbar */}
      <div
        className="fixed top-0 left-0 w-full h-[80px] lg:h-[175px] z-40 pointer-events-none"
        style={{
          background:
            "linear-gradient(180deg, #171717 46.15%, rgba(23, 23, 23, 0.00) 100%)",
        }}
      />
      <nav
        className="sticky top-4 md:top-8 flex items-center justify-between lg:justify-center z-50 gap-4 mx-4 md:mx-20"
        aria-label="Main navigation"
        style={
          isMobile
            ? {
                padding: "10px 16px",
                background:
                  "linear-gradient(180deg, #0F0F0F 0%, #0F0F0F 100%, rgba(15, 15, 15, 0.00) 100%)",
                borderRadius: "42px",
              }
            : {}
        }
      >
        {/* Mobile: Logo a la izquierda */}
        <Link href={"/"} className="lg:hidden font-semibold text-lg flex gap-2">
          <div className="w-6 h-6">
            <IconCCI />
          </div>
          CashIn
        </Link>

        {/* Desktop navbar */}
        <div
          className={`hidden lg:flex items-center justify-between w-full max-w-[1250px] h-[61px] rounded-[56px] px-4 md:px-6 py-3 `}
          style={{
            background:
              "linear-gradient(181.54deg, #0F0F0F 1.31%, #262626 98.69%)",
            backgroundImage: `
              linear-gradient(181.54deg, #0F0F0F 1.31%, #262626 98.69%),
              linear-gradient(90deg, #2C2C2C 0%, #353535 100%)
            `,
            backgroundOrigin: "border-box",
            backgroundClip: "padding-box, border-box",
          }}
        >
          <Link
            href={"/"}
            className="text-light flex gap-2 font-plus-jakarta font-bold text-lg md:text-xl"
          >
             <div className="w-6 h-6">
            <IconCCI />
          </div>
            CashIn
          </Link>

          <div
            className="hidden md:flex items-center gap-3 lg:gap-6 xl:gap-8 text-light text-sm lg:text-base flex-1 justify-center mx-4"
            role="navigation"
          >
            {defaultNavItems.map((item, index) => (
              <div
                key={item.href}
                className="flex items-center gap-3 lg:gap-6 xl:gap-8"
              >
                {index > 0 && (
                  <span className="text-light/50" aria-hidden="true">
                    |
                  </span>
                )}
                {item.disabled ? (
                  <motion.div
                    className="flex flex-col items-center cursor-not-allowed relative"
                    initial="rest"
                    whileHover="hover"
                    animate="rest"
                  >
                    <motion.span
                      className="text-light text-sm lg:text-base"
                      variants={{
                        rest: { y: 0 },
                        hover: { y: -8 },
                      }}
                      transition={{ duration: 0.3 }}
                    >
                      {item.label}
                    </motion.span>
                    <motion.span
                      className="text-secondary text-xs absolute"
                      variants={{
                        rest: { opacity: 0, y: 10 },
                        hover: { opacity: 1, y: 12 },
                      }}
                      transition={{ duration: 0.3 }}
                    >
                      (Próximamente)
                    </motion.span>
                  </motion.div>
                ) : (
                  <Link
                    href={item.href}
                    className={`hover:text-secondary transition-colors ${
                      matchRoute({ to: item.href }) ? "text-secondary" : ""
                    }`}
                  >
                    {item.label}
                  </Link>
                )}
              </div>
            ))}
          </div>

          {isAuthenticated ? (
            <Link href="/profile" className="shrink-0">
              <Button size="sm">Mi Perfil</Button>
            </Link>
          ) : (
            <Link href="/login" className="shrink-0">
              <Button size="sm">Iniciar sesión</Button>
            </Link>
          )}
        </div>

        {/* Mobile: Icono de menú hamburguesa */}
        <motion.div
          className="lg:hidden flex items-center justify-center cursor-pointer text-light"
          onClick={() => setIsMobileMenuOpen(true)}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
          transition={{ type: "spring", stiffness: 400, damping: 17 }}
        >
          <IconMenu />
        </motion.div>
      </nav>

      {/* Mobile: Menú fullscreen */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-100 bg-[#0F0F0F] flex flex-col"
          >
            {/* Header del menú móvil */}
            <div className="flex items-center justify-between px-12 pt-12 ">
              <Link
                href={"/"}
                className="text-light font-plus-jakarta font-bold text-lg"
                onClick={closeMobileMenu}
              >
                CashIn
              </Link>
              <motion.div
                className="cursor-pointer text-light"
                onClick={closeMobileMenu}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                transition={{ type: "spring", stiffness: 400, damping: 17 }}
              >
                <IconX className="w-6 h-6" />
              </motion.div>
            </div>

            {/* Links del menú */}
            <div className="flex-1 flex flex-col justify-center items-center gap-6 px-8 overflow-y-auto">
              {defaultNavItems.filter((item) => !item.disabled).map((item, index) => (
                <motion.div
                  key={item.href}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="flex flex-col items-center"
                >
                  <Link
                    href={item.href}
                    className={`text-2xl font-medium text-light hover:text-primary transition-colors`}
                    onClick={closeMobileMenu}
                  >
                    {item.label}
                  </Link>
                </motion.div>
              ))}

              {/* Separador decorativo */}
              <div
                className="w-full h-2.5 my-2"
                style={{
                  opacity: 0.5,
                  background:
                    "linear-gradient(90deg, #0F0F0F 0%, #9A9FF5 50%, #0F0F0F 100%)",
                }}
              />

              {/* Si está autenticado: mostrar items del perfil */}
              {isAuthenticated ? (
                <>
                  {profileMenuItems.map((item, index) => (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        delay: (defaultNavItems.length + index) * 0.1,
                      }}
                    >
                      <Link
                        href={item.id}
                        className="flex items-center gap-3 text-xl font-medium text-light/80 hover:text-primary transition-colors"
                        onClick={closeMobileMenu}
                      >
                        <span className="text-primary">{item.icon}</span>
                        {item.label}
                      </Link>
                    </motion.div>
                  ))}

                  {/* Separador antes de cerrar sesión */}
                  <div
                    className="w-full h-2.5 my-2"
                    style={{
                      opacity: 0.5,
                      background:
                        "linear-gradient(90deg, #0F0F0F 0%, #9A9FF5 50%, #0F0F0F 100%)",
                    }}
                  />

                  {/* Cerrar sesión */}
                  <motion.button
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      delay:
                        (defaultNavItems.length + profileMenuItems.length) *
                        0.1,
                    }}
                    onClick={handleLogout}
                    className="flex items-center gap-3 text-xl font-medium text-red-400  transition-colors"
                  >
                    <IconOut width="24" height="24" />
                    Cerrar Sesión
                  </motion.button>
                </>
              ) : (
                <>
                  {/* Si no está autenticado: mostrar login/registro */}
                  {userMenuItems.map((item, index) => (
                    <motion.div
                      key={item.href}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        delay: (defaultNavItems.length + index) * 0.1,
                      }}
                    >
                      <Link
                        href={item.href}
                        className="text-xl font-medium text-light/80 hover:text-primary transition-colors"
                        onClick={closeMobileMenu}
                      >
                        {item.label}
                      </Link>
                    </motion.div>
                  ))}
                </>
              )}
            </div>

            {/* Logo al fondo */}
            <div className="flex justify-center pb-12">
              <Link href={"/"} onClick={closeMobileMenu}>
                <img
                  src="/logo1.png"
                  alt="CashIn company logo"
                  className="w-10 h-10 object-contain opacity-50"
                />
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
