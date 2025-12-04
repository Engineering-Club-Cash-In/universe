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
      <div className=" mx-auto lg:ml-60 my-20 px-10 lg:px-20">{children}</div>
    </>
  );
};
