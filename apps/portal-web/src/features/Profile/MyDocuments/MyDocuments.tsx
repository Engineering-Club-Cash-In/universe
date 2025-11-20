import { NavBar } from "@/components";
import { Menu } from "../components";

export const MyDocuments = () => {
  return (
    <div className="">
      <NavBar />
      <Menu />
      <div className="max-w-7xl mx-auto mt-16 mb-20">
        <h1 className="text-header-2 mb-6">Mis Documentos</h1>
        {/* Aquí va el contenido de Mis Documentos */}
      </div>
    </div>
    );
    };
