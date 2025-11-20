import {
  IconPerson,
  IconArrow,
  IconCar2,
  IconDocument,
  IconOut,
} from "@/components";
import { motion } from "framer-motion";
import { useNavigate, useLocation } from "@tanstack/react-router";
import { authClient } from "@/lib/auth";


export const Menu = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    try {
      // Cerrar sesión con better-auth
      await authClient.signOut();

      // Limpiar localStorage (solo el token de recordar email)
      localStorage.removeItem("remembered-email");

      // Redirigir al login
      navigate({ to: "/login" });
    } catch (error) {
      console.error("Error during logout:", error);
      navigate({ to: "/login" });
    }
  };

  const menuItems = [
    {
      id: "/profile",
      label: "Mi Perfil",
      icon: <IconPerson width="24" height="24" />,
    },
    {
      id: "/investments",
      label: "Mis Inversiones",
      icon: <IconArrow width="24" height="24" />,
    },
    {
      id: "/loans",
      label: "Mis Préstamos",
      icon: <IconCar2 width="24" height="24" />,
    },
    { id: "/documents", label: "Documentos", icon: <IconDocument /> },
  ];

  return (
    <div
      className="fixed left-0 top-1/2 -translate-y-1/2 z-50"
      style={{
        borderRadius: "0 39.874px 39.874px 0",
        border: "1px solid #9499EC",
        background:
          "linear-gradient(180deg, rgba(148, 153, 236, 0.25) 0%, rgba(84, 87, 134, 0.25) 100%)",
      }}
    >
      <div className="py-12 px-6 space-y-6">
        {/* Items del menú */}
        {menuItems.map((item) => {
          const isActive = location.pathname === item.id;

          return (
            <motion.button
              key={item.id}
              onClick={() => navigate({ to: item.id })}
              className={`flex items-center gap-4 w-full px-4 py-3 transition-all ${
                isActive
                  ? "rounded-[13.524px] text-white"
                  : "rounded-2xl text-white/70 hover:bg-white/10 hover:text-white"
              }`}
              style={isActive ? { background: "#9499EC" } : {}}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: "spring", stiffness: 400, damping: 17 }}
            >
              <div className="shrink-0 text-light">{item.icon}</div>
              <span className="text-xl font-medium whitespace-nowrap">
                {item.label}
              </span>
            </motion.button>
          );
        })}

        {/* Separador */}
        <div className="h-px bg-white/20 my-4"></div>

        {/* Cerrar sesión */}
        <motion.button
          onClick={handleLogout}
          className="flex items-center gap-4 w-full px-4 py-3 rounded-2xl  hover:bg-red-500/20 transition-all"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          transition={{ type: "spring", stiffness: 400, damping: 17 }}
        >
          <div className="shrink-0">
            <IconOut width="24" height="24" />
          </div>
          <span className="text-xl font-medium whitespace-nowrap">
            Cerrar Sesión
          </span>
        </motion.button>
      </div>
    </div>
  );
};
