import { Link } from "./Link";

export const NavBar = () => {
  return (
    <nav className="fixed top-12 left-8 right-8 flex items-center justify-between z-50">
      <div></div>
      {/* Container principal */}
      <div
        className="flex items-center justify-between"
        style={{
          width: "1134px",
          height: "61.27px",
          borderRadius: "56.18px",
          padding: "13px 21px",
          background:
            "linear-gradient(181.54deg, #0F0F0F 1.31%, #262626 98.69%)",
          border: "0.8px solid transparent",
          backgroundImage: `
            linear-gradient(181.54deg, #0F0F0F 1.31%, #262626 98.69%),
            linear-gradient(90deg, #2C2C2C 0%, #353535 100%)
          `,
          backgroundOrigin: "border-box",
          backgroundClip: "padding-box, border-box",
        }}
      >
        {/* Logo/Nombre de la empresa */}
        <div className="text-light font-plus-jakarta font-bold text-xl">
          CashIn
        </div>

        {/* Links de navegación */}
        <div className="flex items-center gap-8 text-light">
          <Link href="#">Sobre nosotros</Link>
          <span className="text-light/50">|</span>
          <Link href="#">Solicita tu crédito</Link>
          <span className="text-light/50">|</span>
          <Link href="#">Compra- vende</Link>
          <span className="text-light/50">|</span>
          <Link href="#">Invierte con nosotros</Link>
        </div>

        {/* Icono empresa (placeholder) */}
        <div className="w-8 h-8 flex items-center justify-center">
          <img src="/logo1.png" alt="Logo" className="w-full h-full object-contain" />
        </div>
      </div>

      {/* Icono de usuario en la esquina derecha */}
      <div className="ml-4 flex items-center justify-center cursor-pointer hover:bg-light/10 transition-colors">
        User
      </div>
    </nav>
  );
};
