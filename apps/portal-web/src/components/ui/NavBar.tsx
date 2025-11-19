import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "./Link";
import { InvestorsLogo } from "@/features/footer/icons";
import { useMatchRoute } from "@tanstack/react-router";
import { IconUser } from "../icons";

export const NavBar = () => {
  const [isUserMenuOpen, setIsUserMenuOpen] = React.useState(false);

  const matchRoute = useMatchRoute();
  const isInvestorPage = !!matchRoute({ to: "/invest" });

  const defaultNavItems = [
    { label: "Solicita tu crédito", href: "/credit" },
    { label: "Autos en venta", href: "/marketplace" },
    { label: "Vendemos tu auto", href: "/sell" },
    {
      label: "Invierte con nosotros",
      href: "/invest",
      className: "text-secondary",
    },
  ];

  const userMenuItems = [
    { label: "Inicia sesión", href: "/login" },
    { label: "Regístrate", href: "/register" },
  ];

  return (
    <nav
      className="sticky top-6 sm:top-8 left-4 sm:left-8 right-16 sm:right-8 flex items-center justify-center lg:justify-between z-50 gap-4 mx-20 "
      aria-label="Main navigation"
    >
      <div className="hidden lg:block shrink-0"></div>

      <div
        className={`flex items-center justify-between w-full max-w-[1250px] h-[61px] rounded-[56px] px-4 sm:px-6 py-3 ${isInvestorPage ? "border border-secondary" : "border-[0.8px] border-transparent"} `}
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
          className="text-light font-plus-jakarta font-bold text-lg  sm:text-xl"
        >
          {" "}
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
              <Link href={item.href} className={item.className}>
                {item.label}
              </Link>
            </div>
          ))}
        </div>

        <div
          className={`flex items-center justify-center shrink-0 
            ${isInvestorPage ? "w-24 lg:w-20 h-10 " : "w-10 sm:w-8 h-8 "}
          `}
        >
          {isInvestorPage ? (
            <InvestorsLogo />
          ) : (
            <img
              src="/logo1.png"
              alt="CashIn company logo"
              className="w-full h-full object-contain"
            />
          )}
        </div>
      </div>

      {/* Icono de usuario con menú desplegable */}
      <div className="relative ml-4">
        <motion.div
          className={`flex items-center justify-center cursor-pointer hover:text-primary transition-colors ${isInvestorPage ? "text-secondary" : ""}`}
          onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
          transition={{ type: "spring", stiffness: 400, damping: 17 }}
        >
          <IconUser />
        </motion.div>

        {/* Menú desplegable */}
        <AnimatePresence>
          {isUserMenuOpen && (
            <div className="absolute left-1/2 -translate-x-1/2 mt-4">
              <motion.div
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                transition={{
                  type: "spring",
                  stiffness: 500,
                  damping: 30,
                }}
                className="w-48 rounded-lg overflow-hidden shadow-lg"
                style={{
                  fill: "#0F0F0F",
                  strokeWidth: "1px",
                  stroke: "#FFF",
                  border: "1px solid #FFF",
                  backgroundColor: "#0F0F0F",
                }}
              >
                {userMenuItems.map((item) => (
                  <motion.div
                    key={item.href}
                    whileHover={{ backgroundColor: "#1a1a1a" }}
                    transition={{ duration: 0.2 }}
                  >
                    <Link
                      href={item.href}
                      className="block px-4 py-3 text-white hover:text-primary transition-colors"
                      onClick={() => setIsUserMenuOpen(false)}
                    >
                      {item.label}
                    </Link>
                  </motion.div>
                ))}
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </nav>
  );
};
