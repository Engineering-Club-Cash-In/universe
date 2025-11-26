import { useNavigate, useLocation } from "@tanstack/react-router";
import { useCallback } from "react";

/**
 * Hook reutilizable para manejar la navegación cuando cambian los filtros
 * Si el usuario está en una página de detalle (ej: /marketplace/search/veh-1)
 * lo redirige a la página de búsqueda principal con animación
 */
export const useFilterNavigation = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const navigateToSearch = useCallback(() => {
    // Verificar si estamos en una página de detalle (tiene un ID)
    const isDetailPage = location.pathname.includes("/marketplace/search/") &&
                         location.pathname.split("/").length > 3;

    if (isDetailPage) {
      // Navegar a la página de búsqueda principal con animación
      navigate({
        to: "/marketplace/search",
        // Opciones de animación usando viewTransition
        replace: false,
      });
    }
  }, [navigate, location]);

  return { navigateToSearch, isDetailPage: location.pathname.includes("/marketplace/search/") && location.pathname.split("/").length > 3 };
};
