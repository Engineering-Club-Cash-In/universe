import { Menu } from "./Menu";
import { SelectorEntidad } from "./SelectorEntidad";

interface ContainerMenuProps {
  children: React.ReactNode;
}

export const ContainerMenu = ({ children }: ContainerMenuProps) => {
  return (
    <>
      {/* Menu - Solo visible en desktop (posición fija) */}
      <div className="hidden lg:block">
        <Menu />
      </div>

      {/* Contenido principal - con margen izquierdo en desktop para el menú fijo */}
      <div className=" mx-auto lg:ml-72 mt-14 mb-20 lg:mt-20 lg:mb-20 px-8 lg:px-20">
        {/* En desktop el selector vive en el rail (ver Menu). Acá queda solo
            para mobile, donde no hay rail. */}
        <SelectorEntidad className="lg:hidden" />
        {children}
      </div>
    </>
  );
};
