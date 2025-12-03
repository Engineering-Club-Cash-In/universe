import Map from "./assets/Map.png";
import {
  InvestorsLogo as Investors,
  Tranki,
  Listo,
  Facebook,
  Instagram,
  Linkedin,
  Location,
  Whatsapp,
} from "./icons";
import { Link } from "@components/ui";
import { useIsMobile } from "@/hooks";

// Navigation sections configuration
const FOOTER_SECTIONS = [
  {
    title: "Acerca de nosotros",
    links: [
      { label: "Preguntas frecuentes", href: "" },
      { label: "News Letter", href: "" },
    ],
  },
  {
    title: "Autos",
    links: [
      { label: "Encuentra tu auto", href: "/marketplace" },
      { label: "Obtén tu financiamiento", href: "/credit" },
      { label: "Compramos tu auto", href: "/sell" },
    ],
  },
  {
    title: "Investors",
    links: [{ label: "Quiero invertir", href: "/invest" }],
  },
];

// Social media and contact information
const SOCIAL_CONTACTS = [
  {
    icon: Instagram,
    label: "@clubcashin",
    href: "https://instagram.com/clubcashin",
  },
  {
    icon: Whatsapp,
    label: "+502 2234-1368",
    href: "https://wa.me/50222341368",
  },
  {
    icon: Facebook,
    label: "Clubcashin",
    href: "https://facebook.com/clubcashin",
  },
  {
    icon: Linkedin,
    label: "clubcashin-com",
    href: "https://linkedin.com/company/clubcashin-com",
  },
  {
    icon: Location,
    label: '3a avenida "A" 13-78, Colonia Lomas de Pamplona zona 13',
    className: "max-w-[280px] text-center",
    href: "https://www.google.com/maps/place/Club+Cash+In/@14.5992026,-90.5374228,873m/data=!3m2!1e3!4b1!4m6!3m5!1s0x8589a1a13ede014d:0xcc9c190a50d9f749!8m2!3d14.5992026!4d-90.5348479!16s%2Fg%2F11k0wwn0rc!5m1!1e1?entry=ttu&g_ep=EgoyMDI1MTExNi4wIKXMDSoASAFQAw%3D%3D",
  },
];

export const Footer: React.FC = () => {
  const isMobile = useIsMobile();

  return (
    <footer className="relative bg-[#0F0F0F] lg:h-[550px] h-full ">
      {/* Gradient shadow at the top - always visible */}
      <div
        style={{
          background:
            "linear-gradient(180deg, rgba(15, 15, 15, 0.00) 0%, #0F0F0F 100%)",
        }}
        className="absolute -top-32 left-0 right-0 h-32 pointer-events-none z-10"
      />

      {/* Background image with transparency */}
      <div
        style={{
          backgroundImage: `url(${Map})`,
          backgroundSize: isMobile ? "400% auto" : "100% auto",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          opacity: 0.3,
        }}
        className="absolute inset-0 z-0 pointer-events-none"
      />

      {/* Content */}
      <div className="flex justify-end flex-col gap-6 h-full p-10 lg:px-40 lg:py-20 z-10 relative">
        {/* Logo section */}
        <div className="flex flex-col lg:flex-row gap-10 lg:items-center">
          <h1 className="text-header-3">Cashin</h1>
          <div className="flex gap-10">
            <Investors />
            <Tranki />
            <Listo />
          </div>
        </div>

        <div className="border-t border-white border-2"></div>

        {/* Main content grid */}
        <div className="grid grid-cols-1  lg:grid-cols-5 gap-6 lg:gap-0 w-full ">
          {/* Navigation links */}
          <div className="order-2 lg:order-1  w-full col-span-3 lg:col-span-2 flex flex-col lg:flex-row gap-10 lg:gap-14">
            {FOOTER_SECTIONS.map((section) => (
              <div key={section.title} className="flex flex-col gap-6">
                <div className="text-[20px] font-bold">{section.title}</div>
                {section.links.map((link) => (
                  <Link
                    key={link.label}
                    href={link.href}
                    className="transition-colors hover:text-gray-300"
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            ))}
          </div>

          {/* Social media and contact */}
          <div className="order-1 lg:order-2 w-full col-span-2 lg:col-span-3 flex  lg:justify-end gap-8 lg:pr-14 ">
            {SOCIAL_CONTACTS.map((contact) => {
              const IconComponent = contact.icon;
              return (
                <a
                  key={contact.label}
                  href={contact.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex flex-col items-center gap-1 text-[14px] font-normal transition-all hover:scale-110 hover:text-gray-300 cursor-pointer ${contact.className || ""}`}
                >
                  <IconComponent />
                  <div className="hidden lg:block">{contact.label}</div>
                </a>
              );
            })}
          </div>
        </div>
      </div>
    </footer>
  );
};
