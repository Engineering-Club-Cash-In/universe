import Map from "./assets/Map.png";
import {
  Investors,
  Tranki,
  Listo,
  Facebook,
  Instagram,
  Linkedin,
  Location,
  Whatsapp,
} from "./icons";
import { Link } from "@components/ui";

// Navigation sections configuration
const FOOTER_SECTIONS = [
  {
    title: "Acerca de nosotros",
    links: [
      { label: "Preguntas frecuentes", href: "/faq" },
      { label: "News Letter", href: "/newsletter" },
    ],
  },
  {
    title: "Autos",
    links: [
      { label: "Encuentra tu auto", href: "/faq" },
      { label: "Obtén tu financiamiento", href: "/newsletter" },
      { label: "Compramos tu auto", href: "/newsletter" },
    ],
  },
  {
    title: "Investors",
    links: [{ label: "Quiero invertir", href: "/faq" }],
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
];

const LOCATION_INFO = {
  icon: Location,
  address: '3a avenida "A" 13-78, Colonia Lomas de Pamplona zona 13',
  href: "https://maps.google.com",
};

export const Footer: React.FC = () => {
  return (
    <footer className="relative bg-[#0F0F0F] h-[550px]">
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
          backgroundSize: "100% auto",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          opacity: 0.3,
        }}
        className="absolute inset-0 z-0 pointer-events-none"
      />

      {/* Content */}
      <div className="flex justify-end flex-col gap-6 h-full px-40 py-20 z-10 relative">
        {/* Logo section */}
        <div className="flex gap-10 items-center">
          <h1 className="text-header-3">Cashin</h1>
          <Investors />
          <Tranki />
          <Listo />
        </div>

        <div className="border-t border-white border-2"></div>

        {/* Main content grid */}
        <div className="grid grid-cols-5 w-full">
          {/* Navigation links */}
          <div className="w-full col-span-2 flex gap-14">
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
          <div className="w-full col-span-3 flex justify-end gap-8 pr-14">
            {SOCIAL_CONTACTS.map((contact) => {
              const IconComponent = contact.icon;
              return (
                <a
                  key={contact.label}
                  href={contact.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col items-center gap-1 text-[14px] font-normal transition-all hover:scale-110 hover:text-gray-300 cursor-pointer"
                >
                  <IconComponent />
                  {contact.label}
                </a>
              );
            })}
            <a
              href={LOCATION_INFO.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center gap-1 text-[14px] font-normal max-w-[280px] text-center transition-all hover:scale-105 hover:text-gray-300 cursor-pointer"
            >
              <Location />
              {LOCATION_INFO.address}
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};
