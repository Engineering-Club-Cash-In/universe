import Map from "./assets/Map.png";
import {
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
    title: "Autos",
    links: [
      { label: "Encuentra tu auto", href: "/credit" }, // TODO: devolver a "/marketplace" cuando esté habilitado
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
// eslint-disable-next-line react-refresh/only-export-components
export const SOCIAL_CONTACTS = [
  {
    icon: Instagram,
    label: "@clubcashin",
    href: "https://instagram.com/clubcashin",
  },
  {
    icon: Whatsapp,
    lead: false,
    label: "+502 3484-9518",
    href: "https://wa.me/50234849518",
  },
  {
    icon: Facebook,
    label: "ClubCashIn",
    href: "https://facebook.com/ClubCashIn",
  },
  {
    icon: Linkedin,
    label: "Club Cash In",
    href: "https://linkedin.com/company/club-cash-in",
  },
  {
    icon: Location,
    lead: false,
    label: "Km 16.5, Centro Comercial Muxbal, Guatemala",
    className: "max-w-[280px] text-center",
    href: "https://www.google.com/maps/search/Centro+Comercial+Muxbal+Guatemala",
  },
];

interface FooterProps {
  notShowRedirects?: boolean;
}

export const Footer: React.FC<FooterProps> = ({ notShowRedirects = false }) => {
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
      <div className="flex justify-end flex-col gap-6 h-full p-8 lg:px-40 lg:py-20 z-10 relative">
        {/* Logo section */}
        <div className="flex flex-col lg:flex-row gap-6 lg:gap-10 lg:items-center">
          <Link href="/"><h1 className="text-3xl lg:text-header-3">Cashin</h1></Link>
        </div>

        <div className="border-t border-white border-2"></div>

        {/* Main content grid */}
        <div className="grid grid-cols-1  lg:grid-cols-5 gap-6 lg:gap-0 w-full ">
          {/* Navigation links */}
          {!notShowRedirects && (
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
          )}

          {/* Social media and contact */}
          <div
            className={`order-1 lg:order-2 w-full col-span-2 lg:col-span-3 flex ${notShowRedirects ? "" : "lg:justify-end lg:pr-14"} gap-4 lg:gap-8 `}
          >
            {SOCIAL_CONTACTS.filter(contact => notShowRedirects ? contact.lead !== false : true).map((contact) => {
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
                  <div className={`hidden lg:block text-[14px] ${contact.className ? "" : "whitespace-nowrap"}`}>{contact.label}</div>
                </a>
              );
            })}
          </div>
        </div>
      </div>
    </footer>
  );
};
