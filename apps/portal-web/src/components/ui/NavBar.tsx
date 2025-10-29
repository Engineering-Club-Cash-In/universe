import { Link } from "./Link";

export const NavBar = () => {
  const defaultNavItems = [
    { label: "Sobre nosotros", href: "#about" },
    { label: "Solicita tu crédito", href: "#credit" },
    { label: "Compra- vende", href: "#trade" },
    { label: "Invierte con nosotros", href: "#invest" },
  ];

  return (
    <nav
      className="fixed top-8 sm:top-12 left-4 sm:left-8 right-4 sm:right-8 flex items-center justify-center lg:justify-between z-50 gap-4"
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

      {/* Icono de usuario en la esquina derecha */}
      <div className="ml-4 flex items-center justify-center cursor-pointer hover:bg-light/10 transition-colors">
        User
      </div>
    </nav>
  );
};
