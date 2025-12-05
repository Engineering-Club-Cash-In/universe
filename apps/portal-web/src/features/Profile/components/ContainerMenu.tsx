import { Menu } from "./Menu";

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
      <div className=" mx-auto lg:ml-60 mt-10 mb-20 lg:mt-20 lg:mb-20 px-8 lg:px-20">{children}</div>
    </>
  );
};
