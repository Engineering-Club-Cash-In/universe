import React, { useState, useEffect } from "react";
import {
  SearchIcon,
  HeartIcon,
  UserIcon,
  FilesIcon,
  ChevronDownIcon,
  CarIcon,
} from "lucide-react";

const NewLandingPage: React.FC = () => {
  /* Variables and State*/
  const [activeSection, setActiveSection] = useState<string>("Inicio");
  const sections = [
    "Inicio",
    "Nuevos",
    "Usados",
    "Vende",
    "Invierte",
    "Contáctanos",
  ];

  const cyclingTitles = [
    "Compra y vende tu carro con crédito fácil y seguro",
    "Compra tu carro con financiamiento fácil y rápido",
    "Encuentra la mejor selección de autos con garantía",
    "Vende tu carro con inspección y garantía Tranki",
  ];
  const [currentTitleIndex, setCurrentTitleIndex] = useState(0);
  const [activeFinderTab, setActiveFinderTab] = useState<string>("Todos");

  /* Handlers */
  const handleSectionChange = (section: string) => {
    setActiveSection(section);
  };

  /* Effects */
  useEffect(() => {
    const intervalId = setInterval(() => {
      setCurrentTitleIndex(
        (prevIndex) => (prevIndex + 1) % cyclingTitles.length
      );
    }, 5000); // Change title every 3 seconds

    return () => clearInterval(intervalId); // Cleanup on unmount
  }, []);

  /* Render */
  return (
    <div className="flex flex-col min-h-screen">
      {/* Section 1 */}
      <section className="min-h-screen bg-purple-300 flex flex-col">
        <header className="flex flex-col justify-between w-full p-12 gap-4">
          <div className="flex flex-row justify-between items-center">
            <div className="flex flex-row gap-2">
              <div className="rounded-full bg-white w-10 h-10 flex items-center justify-center">
                <img src="/images/logo.png" alt="" />
              </div>
              <span className="text-xl font-bold flex self-center items-center h-full text-white">
                Tranki
              </span>
            </div>
            <nav className="flex flex-row gap-12">
              {sections.map((item) => (
                <a
                  key={item}
                  href="#"
                  className={`text-white text-xl font-semibold hover:text-yellow-500 transition-colors ${
                    activeSection === item ? "text-yellow-500" : ""
                  }`}
                  onClick={() => handleSectionChange(item)}
                >
                  {item}
                </a>
              ))}
            </nav>
            <nav className="flex flex-row gap-2 items-center">
              <button className="text-white text-xl font-semibold hover:text-yellow-500 transition-colors">
                <SearchIcon className="w-5 h-5" />
              </button>
              <div id="separator" className="w-px h-4 bg-white/20"></div>
              <button className="text-white text-xl font-semibold hover:text-yellow-500 transition-colors">
                <HeartIcon className="w-5 h-5" />
              </button>
              <div id="separator" className="w-px h-4 bg-white/20"></div>
              <div className="flex flex-row gap-2 items-center">
                <button className="text-white text-lg font-semibold hover:text-yellow-500 transition-colors">
                  <UserIcon className="w-5 h-5" />
                </button>
                <span className="text-white text-xl">Ingresar / Registro</span>
              </div>
            </nav>
            <button className="flex flex-row gap-2 items-center text-white text-xl border rounded-lg py-1 px-4 hover:text-yellow-500 transition-colors">
              <FilesIcon className="w-5 h-5" />
              <span className="text-white text-lg">Crédito</span>
            </button>
          </div>
          <hr className="w-full border border-white" />
        </header>
        {/* Wrapper to push title up and finder down */}
        <div className="flex-grow flex flex-col justify-between">
          {/* Title and Subtitle Section */}
          <div className="flex flex-col w-full items-start text-left px-48 mt-28">
            <div className="flex items-start gap-3 mb-4">
              <div className="flex flex-col gap-2 mr-4 pt-2 self-center">
                {cyclingTitles.map((_, index) => (
                  <button
                    key={index}
                    onClick={() => setCurrentTitleIndex(index)}
                    className={`w-3 h-3 rounded-full transition-colors ${currentTitleIndex === index ? "bg-yellow-500" : "bg-white/50 hover:bg-white/75"}`}
                  />
                ))}
              </div>
              <h1 className="text-6xl font-bold text-white max-w-xl leading-tight">
                {cyclingTitles[currentTitleIndex]}
              </h1>
            </div>
            <p className="text-2xl text-white font-semibold ml-9">
              mientras disfrutas la vida <strong>Tranki</strong>
            </p>
          </div>

          {/* Car Finder Section */}
          <div className="flex flex-col items-start gap-3 w-full px-48 pb-8">
            {/* Tabs */}
            <div className="flex justify-start gap-1 mb-3 w-full">
              {["Todos", "Nuevos", "Usados"].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveFinderTab(tab)}
                  className={`relative px-6 py-2 rounded-lg text-sm font-semibold transition-colors ${
                    activeFinderTab === tab
                      ? "bg-yellow-500 text-black"
                      : "bg-transparent text-white hover:bg-white/20 border border-white"
                  }`}
                >
                  {tab}
                  {activeFinderTab === tab && (
                    <div
                      className="absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-[calc(100%-1px)] w-0 h-0"
                      style={{
                        borderLeft: "10px solid transparent",
                        borderRight: "10px solid transparent",
                        borderTop: "10px solid #ffd100",
                      }}
                    />
                  )}
                </button>
              ))}
            </div>

            {/* Search Bar */}
            <div className="bg-white rounded-xl p-4 shadow-lg flex items-center gap-4 w-full">
              {/* Tipo auto Dropdown */}
              <div className="flex items-center justify-between min-h-12 rounded-2xl border px-4 flex-1 cursor-pointer text-gray-500 hover:text-gray-700">
                <span>Tipo auto</span>
                <ChevronDownIcon className="w-4 h-4" />
              </div>
              {/* Modelo Dropdown */}
              <div className="flex items-center justify-between min-h-12 rounded-2xl border px-4 flex-1 cursor-pointer text-gray-500 hover:text-gray-700">
                <span>Modelo</span>
                <ChevronDownIcon className="w-4 h-4" />
              </div>
              {/* Precio Dropdown */}
              <div className="flex items-center justify-between min-h-12 rounded-2xl border px-4 flex-1 cursor-pointer text-gray-500 hover:text-gray-700">
                <span>Precio</span>
                <ChevronDownIcon className="w-4 h-4" />
              </div>
              {/* Buscar característica Input */}
              <input
                type="text"
                placeholder="Buscar característica"
                className="flex-1 min-h-12 rounded-2xl border px-4 outline-none placeholder-gray-400"
              />
              {/* Search Button */}
              <button className="bg-purple-500 text-white px-6 py-2 rounded-2xl flex items-center gap-2 hover:bg-purple-700 transition-colors">
                Buscar
                <SearchIcon className="w-4 h-4" />
              </button>
            </div>

            {/* Car Type Links */}
            <div className="flex gap-6 mt-4 text-white text-sm">
              <a
                href="#"
                className="flex items-center gap-1 hover:text-yellow-400"
              >
                <CarIcon className="w-4 h-4" />
                SUV
              </a>
              <a
                href="#"
                className="flex items-center gap-1 hover:text-yellow-400"
              >
                <CarIcon className="w-4 h-4" />
                Deportivo
              </a>
              <a
                href="#"
                className="flex items-center gap-1 hover:text-yellow-400"
              >
                <CarIcon className="w-4 h-4" />
                Coupe
              </a>
              <a
                href="#"
                className="flex items-center gap-1 hover:text-yellow-400"
              >
                <CarIcon className="w-4 h-4" />
                Híbrido
              </a>
            </div>
          </div>
        </div>{" "}
        {/* End Wrapper */}
      </section>

      {/* Section 2 */}
      <section className="min-h-screen bg-green-100 flex items-center justify-center">
        <h1 className="text-4xl font-bold">Section 2</h1>
        {/* Add your content for section 2 here */}
      </section>

      {/* Section 3 */}
      <section className="min-h-screen bg-yellow-100 flex items-center justify-center">
        <h1 className="text-4xl font-bold">Section 3</h1>
        {/* Add your content for section 3 here */}
      </section>

      {/* Section 4 */}
      <section className="min-h-screen bg-red-100 flex items-center justify-center">
        <h1 className="text-4xl font-bold">Section 4</h1>
        {/* Add your content for section 4 here */}
      </section>

      {/* Footer */}
      <footer className="h-20 bg-gray-800 text-white flex items-center justify-center">
        <p>© {new Date().getFullYear()} Your Company Name</p>
        {/* Add your footer content here */}
      </footer>
    </div>
  );
};

export default NewLandingPage;
