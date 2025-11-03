import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "./Link";

export const NavBar = () => {
  const [isUserMenuOpen, setIsUserMenuOpen] = React.useState(false);

  const defaultNavItems = [
    { label: "Sobre nosotros", href: "#about" },
    { label: "Solicita tu crédito", href: "#credit" },
    { label: "Compra - vende", href: "#trade" },
    { label: "Invierte con nosotros", href: "#invest" },
  ];

  const userMenuItems = [
    { label: "Inicia sesión", href: "/login" },
    { label: "Regístrate", href: "/register" },
  ];

  return (
    <nav
      className="sticky top-6 sm:top-8 left-4 sm:left-8 right-16 sm:right-8 flex items-center justify-center lg:justify-between z-50 gap-4 mx-28"
      aria-label="Main navigation"
    >
      <div className="hidden lg:block shrink-0"></div>

      <div
        className="flex items-center justify-between w-full max-w-[1134px] h-[61px] rounded-[56px] px-4 sm:px-6 py-3 border-[0.8px] border-transparent"
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
              <Link href={item.href}>{item.label}</Link>
            </div>
          ))}
        </div>

        <div className="w-6 h-6 sm:w-8 sm:h-8 flex items-center justify-center shrink-0">
          <img
            src="/logo1.png"
            alt="CashIn company logo"
            className="w-full h-full object-contain"
          />
        </div>
      </div>

      {/* Icono de usuario con menú desplegable */}
      <div className="relative ml-4">
        <motion.div
          className="flex items-center justify-center cursor-pointer hover:text-primary transition-colors"
          onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
          transition={{ type: "spring", stiffness: 400, damping: 17 }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="36"
            height="36"
            viewBox="0 0 36 36"
            fill="none"
            className="transition-colors"
          >
            <circle
              cx="18"
              cy="10.5"
              r="6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path
              d="M8.65092 25.2508C9.57272 22.5319 12.2717 21 15.1426 21H20.8574C23.7283 21 26.4273 22.5319 27.3491 25.2508C27.8733 26.797 28.3373 28.6275 28.4652 30.5007C28.5028 31.0517 28.0523 31.5 27.5 31.5H8.5C7.94772 31.5 7.49717 31.0517 7.53479 30.5007C7.66267 28.6275 8.12668 26.797 8.65092 25.2508Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
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
