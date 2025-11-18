import React, { useState, useEffect } from "react";
import {
  SearchIcon,
  HeartIcon,
  UserIcon,
  FilesIcon,
  ChevronDownIcon,
  CarIcon,
  CogIcon,
  Calendar1Icon,
  DollarSignIcon,
  MoveRightIcon,
} from "lucide-react";
import Hero from "../../assets/landing/new/hero.webp";
import Calc from "../../assets/landing/new/calc.webp";
import CarImage from "../../assets/landing/new/bmw.webp";
import CarCard from "@/components/ui/landing/car-card";
import AudiLogo from "../../assets/landing/new/logos/Logo_Audi.svg";
import BMWLogo from "../../assets/landing/new/logos/Logo_BMW.svg";
import FordLogo from "../../assets/landing/new/logos/Logo_Ford.svg";
import MercedesLogo from "../../assets/landing/new/logos/Logo_Mercedes.svg";
import VolkswagenLogo from "../../assets/landing/new/logos/Logo_VW.svg";
import MapaFooter from "../../assets/landing/new/mapa_footer.svg";
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

  const sampleCars = [
    {
      image: CarImage,
      category: "SUV Premium",
      name: "Toyota RAV4 XLE",
      year: "2023",
      mileage: "15,000 km",
      fuel: ["Gasolina", "Automático"],
      price: "Q32,500",
      featured: true,
      hasPhotos: true,
      hasVideo: true,
    },
    {
      image: CarImage,
      category: "Sedan",
      name: "Honda Civic Touring",
      year: "2022",
      mileage: "22,500 km",
      fuel: ["Gasolina", "Automático"],
      price: "Q28,900",
      featured: false,
      hasPhotos: true,
      hasVideo: false,
    },
    {
      image: CarImage,
      category: "Pickup",
      name: "Ford Ranger XLT",
      year: "2021",
      mileage: "35,000 km",
      fuel: ["Diesel", "Manual"],
      price: "Q42,000",
      featured: true,
      hasPhotos: true,
      hasVideo: true,
    },
    {
      image: CarImage,
      category: "Hatchback",
      name: "Volkswagen Golf GTI",
      year: "2022",
      mileage: "18,200 km",
      fuel: ["Gasolina", "Automático"],
      price: "Q35,700",
      featured: false,
      hasPhotos: true,
      hasVideo: false,
    },
    {
      image: CarImage,
      category: "SUV Compacto",
      name: "Mazda CX-5 Grand Touring",
      year: "2023",
      mileage: "12,800 km",
      fuel: ["Gasolina", "Automático"],
      price: "Q38,900",
      featured: true,
      hasPhotos: true,
      hasVideo: false,
    },
    {
      image: CarImage,
      category: "Minivan",
      name: "Toyota Sienna LE",
      year: "2021",
      mileage: "28,500 km",
      fuel: ["Híbrido", "Automático"],
      price: "Q45,200",
      featured: false,
      hasPhotos: true,
      hasVideo: true,
    },
  ];

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
      <section className="min-h-screen flex flex-col relative">
        {/* Background container with mirrored image */}
        <div
          style={{ backgroundImage: `url(${Hero})` }}
          className="absolute inset-0 bg-cover bg-center"
        ></div>

        {/* Purple Overlay */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(-46.93deg, rgb(113, 120, 245) -2.217%, rgb(113, 120, 245) -2.217%)",
            opacity: 0.6,
          }}
        ></div>

        {/* Content - now relative to appear above overlay */}
        <div className="relative z-10 flex flex-col flex-grow">
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
              <nav className="flex flex-row gap-4  xl:gap-12">
                {sections.map((item) => (
                  <a
                    key={item}
                    href="#"
                    className={`text-white text-lg  xl:text-xl font-semibold hover:text-yellow-500 transition-colors ${
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
                  <span className="text-white text-xl">
                    Ingresar / Registro
                  </span>
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
        </div>
      </section>

      {/* Section 2 - Split Screen How To */}
      <section className="min-h-screen flex flex-col md:flex-row">
        {/* Left Side - How to Buy */}
        <div className="flex-1 bg-purple-600 p-12 md:p-24 flex flex-col items-start justify-center">
          <h2 className="text-4xl md:text-5xl font-bold mb-12">
            <span className="text-yellow-400">¿Cómo comprar</span>
            <span className="text-yellow-400"> tu auto?</span>
          </h2>

          <div className="space-y-12 mb-12">
            {/* Step 1 */}
            <div className="flex items-start gap-6">
              <div className="text-4xl bg-white rounded-full p-2 flex items-center justify-center">
                <SearchIcon className="w-10 h-10 text-purple-600" />
              </div>
              <div>
                <h3 className="text-yellow-400 text-xl font-bold mb-2">
                  Encuentra tu auto
                </h3>
                <p className="text-white/90">
                  Busca entre todas las opciones de autos nuevos y usados que te
                  interesan.
                </p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex items-start gap-6">
              <div className="text-4xl bg-white rounded-full p-2 flex items-center justify-center">
                <CogIcon className="w-10 h-10 text-purple-600" />
              </div>
              <div>
                <h3 className="text-yellow-400 text-xl font-bold mb-2">
                  Configura tu compra
                </h3>
                <p className="text-white/90">
                  Completa el proceso en línea o contacta a un asesor para que
                  te guíe.
                </p>
              </div>
            </div>

            {/* Step 3 */}
            <div className="flex items-start gap-6">
              <div className="text-4xl bg-white rounded-full p-2 flex items-center justify-center">
                <CarIcon className="w-10 h-10 text-purple-600" />
              </div>
              <div>
                <h3 className="text-yellow-400 text-xl font-bold mb-2">
                  Llévatelo
                </h3>
                <p className="text-white/90">
                  ¡Listo! Ya puedes disfrutar de tu nuevo auto.
                </p>
              </div>
            </div>
          </div>

          <button className="self-center bg-yellow-400 text-purple-900 px-8 py-3 rounded-xl text-lg font-semibold hover:bg-yellow-300 transition-colors cursor-pointer">
            Comprar mi Auto
          </button>
        </div>

        {/* Right Side - How to Sell */}
        <div className="flex-1 bg-white p-12 md:p-24 flex flex-col items-start justify-center">
          <h2 className="text-4xl md:text-5xl font-bold text-purple-600 mb-12">
            ¿Cómo vender tu auto?
          </h2>

          <div className="space-y-12 mb-12">
            {/* Step 1 */}
            <div className="flex items-start gap-6">
              <div className="text-4xl bg-purple-600 rounded-full p-2 flex items-center justify-center">
                <CarIcon className="w-10 h-10 text-white" />
              </div>
              <div>
                <h3 className="text-purple-600 text-xl font-bold mb-2">
                  Cuéntanos sobre tu auto
                </h3>
                <p className="text-gray-600">
                  Proporciona algunos detalles para ayudarnos a entender tu
                  auto.
                </p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex items-start gap-6">
              <div className="text-4xl bg-purple-600 rounded-full p-2 flex items-center justify-center">
                <Calendar1Icon className="w-10 h-10 text-white" />
              </div>
              <div>
                <h3 className="text-purple-600 text-xl font-bold mb-2">
                  Agenda tu cita
                </h3>
                <p className="text-gray-600">
                  Realizaremos una inspección mecánica para ofrecer el mejor
                  precio de reventa posible.
                </p>
              </div>
            </div>

            {/* Step 3 */}
            <div className="flex items-start gap-6">
              <div className="text-4xl bg-purple-600 rounded-full p-2 flex items-center justify-center">
                <DollarSignIcon className="w-10 h-10 text-white" />
              </div>
              <div>
                <h3 className="text-purple-600 text-xl font-bold mb-2">
                  Cerramos la venta y te realizamos el pago
                </h3>
                <p className="text-gray-600">
                  Te enviamos el pago vía transferencia o depósito de inmediato.
                </p>
              </div>
            </div>
          </div>

          <button className="self-center bg-purple-600 text-white px-8 py-3 rounded-xl text-lg font-semibold hover:bg-purple-500 transition-colors cursor-pointer">
            Vender mi Auto
          </button>
        </div>
      </section>

      {/* Section 3 - Most Viewed Vehicles */}
      <section className="min-h-screen bg-gray-50 py-24 px-12 md:px-24">
        {/* Section Title */}
        <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-12">
          Nuestros vehículos más vistos
        </h2>

        {/* Vehicle Carousel */}
        <div className="mb-24">
          {/* Category Label */}
          <div className="flex flex-col mb-6">
            <span className="text-purple-600 font-semibold mb-2">SUV</span>
            <div className="h-px w-full bg-gray-200 relative">
              <div className="h-px w-[5%] bg-purple-600 absolute top-0 left-0"></div>
            </div>
          </div>

          {/* Carousel Container */}
          <div className="relative">
            {/* Left Arrow */}
            <button
              className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-white p-3 rounded-full shadow-lg hover:bg-gray-50 transition-colors"
              onClick={() => {
                const container = document.getElementById("car-carousel");
                if (container) {
                  container.scrollLeft -= container.offsetWidth;
                }
              }}
            >
              <ChevronDownIcon className="w-6 h-6 text-purple-600 rotate-90" />
            </button>

            {/* Scrollable Container */}
            <div
              id="car-carousel"
              className="flex gap-6 overflow-x-auto scroll-smooth scrollbar-hide"
            >
              {sampleCars.map((car) => (
                <div key={car.name} className="flex-none w-[300px]">
                  <CarCard {...car} />
                </div>
              ))}
            </div>

            {/* Right Arrow */}
            <button
              className="absolute right-[-20px] top-1/2 -translate-y-1/2 z-10 bg-white p-3 rounded-full shadow-lg hover:bg-gray-50 transition-colors"
              onClick={() => {
                const container = document.getElementById("car-carousel");
                if (container) {
                  container.scrollLeft += container.offsetWidth;
                }
              }}
            >
              <ChevronDownIcon className="w-6 h-6 text-purple-600 -rotate-90" />
            </button>
          </div>
        </div>

        {/* Vehicle Type Selector */}
        <div className="mb-12">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-3xl font-semibold text-gray-900">
              Busca por tipo
            </h3>
            <a
              href="#"
              className="flex justify-center items-center gap-2 text-purple-600 font-semibold hover:underline"
            >
              Ver todos
              <MoveRightIcon className="w-4 h-4" />
            </a>
          </div>

          <div className="relative">
            <div className="flex gap-4 overflow-x-auto pb-6 -mb-6 scrollbar-hide">
              {[
                "Sedan",
                "Hatchback",
                "SUV",
                "Pickup",
                "Minivan",
                "Todo terreno",
                "Mini",
                "Coupe",
              ].map((type, index) => (
                <button
                  key={type}
                  className={`flex flex-col items-center p-4 rounded-xl min-w-[140px] cursor-pointer transition-colors ${
                    index === 2
                      ? "bg-purple-600 text-white"
                      : "bg-white text-purple-600 hover:bg-purple-50"
                  }`}
                >
                  <CarIcon className="w-8 h-8 mb-2" />
                  <span className="font-semibold">{type}</span>
                  <span className="text-sm opacity-80">271 autos</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Pagination Dots */}
        <div className="flex justify-center gap-2">
          {[1, 2, 3].map((dot, index) => (
            <button
              key={dot}
              className={`w-2 h-2 rounded-full transition-colors ${
                index === 0 ? "bg-purple-600" : "bg-purple-200"
              }`}
            />
          ))}
        </div>
      </section>

      {/* Section 4 - Auto Loan Calculator */}
      <section className="min-h-[60vh] flex items-center aspect-[16/6] ">
        {/* Content Container */}
        <div
          className="w-full h-full flex items-center pl-12"
          style={{
            backgroundImage: `url(${Calc})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          {/* Calculator Card */}
          <div className="w-[500px] h-4/5 bg-white/95 backdrop-blur-sm rounded-2xl shadow-xl p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-1">
              Calculadora de préstamo de auto
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              Usa nuestra calculadora para estimar tus pagos mensuales de auto
            </p>

            {/* Calculator Form */}
            <form className="space-y-3">
              {/* Precio Total */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Precio Total
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                    Q.
                  </span>
                  <input
                    type="number"
                    className="w-full pl-7 pr-3 py-2 h-10 rounded-xl border border-gray-300 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    placeholder="0.00"
                  />
                </div>
              </div>

              {/* Enganche and Tiempo de crédito - 2 columns on md and above */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Enganche */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Enganche
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                      Q.
                    </span>
                    <input
                      type="number"
                      className="w-full pl-7 pr-3 py-2 h-10 rounded-xl border border-gray-300 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      placeholder="0.00"
                    />
                  </div>
                </div>

                {/* Tiempo de crédito */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Tiempo de crédito
                  </label>
                  <select className="w-full px-3 py-2 h-10 rounded-xl border border-gray-300 focus:ring-2 focus:ring-purple-500 focus:border-transparent">
                    <option>12 meses</option>
                    <option>24 meses</option>
                    <option>36 meses</option>
                    <option>48 meses</option>
                    <option>60 meses</option>
                  </select>
                </div>
              </div>

              {/* Interés */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Interés
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      className="w-full pl-3 pr-7 py-2 h-10 rounded-xl border border-gray-300 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      placeholder="1.3"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">
                      %
                    </span>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Frecuencia
                  </label>
                  <select className="w-full px-3 py-2 h-10 rounded-xl border border-gray-300 focus:ring-2 focus:ring-purple-500 focus:border-transparent">
                    <option>Anual</option>
                    <option>Mensual</option>
                  </select>
                </div>
              </div>

              {/* Results */}
              <div className="pt-3 space-y-2 border-t">
                <div className="flex justify-between">
                  <span className="text-md font-semibold text-gray-600">
                    Monto de Enganche:
                  </span>
                  <span className="font-semibold">Q.0.00</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-md font-semibold text-gray-600">
                    Monto a Financiar:
                  </span>
                  <span className="font-semibold">Q.600.00</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-md font-semibold text-purple-600">
                    Pago Mensual:
                  </span>
                  <span className="font-semibold text-purple-600 text-lg">
                    Q.60.00
                  </span>
                </div>
              </div>

              {/* CTA Button */}
              <button
                type="submit"
                className="w-full py-3 px-6 bg-gradient-to-r from-purple-600 to-purple-700 text-white rounded-xl font-semibold hover:from-purple-700 hover:to-purple-800 transition-colors mt-4 cursor-pointer"
              >
                Aplicar al Crédito
              </button>
            </form>
          </div>
        </div>
      </section>

      {/* Brand Search Section */}
      <section className="py-8 bg-gray-50">
        <div className="max-w-7xl mx-auto px-8">
          {/* Section Header */}
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-3xl font-semibold text-gray-900">
              Busca por marca
            </h2>
            <a
              href="#"
              className="flex items-center gap-2 text-purple-600 font-semibold hover:underline"
            >
              Ver todos
              <MoveRightIcon className="w-4 h-4" />
            </a>
          </div>

          {/* Brand Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {[
              { name: "Audi", logo: AudiLogo },
              { name: "BMW", logo: BMWLogo },
              { name: "Ford", logo: FordLogo },
              { name: "Mercedes-Benz", logo: MercedesLogo },
              { name: "Volkswagen", logo: VolkswagenLogo },
            ].map((brand, index) => (
              <button
                key={brand.name}
                className={`flex flex-col items-center p-6 rounded-xl transition-colors ${
                  index === 2
                    ? "bg-purple-600 text-white"
                    : "bg-transparent text-purple-600 hover:bg-purple-50"
                }`}
              >
                {brand.logo ? (
                  <img
                    src={brand.logo}
                    alt={`${brand.name} logo`}
                    className="w-24 h-24 mb-3 object-contain"
                  />
                ) : (
                  <CarIcon
                    className={`w-12 h-12 mb-3 ${
                      index === 2 ? "text-white" : "text-purple-600"
                    }`}
                  />
                )}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer
        className="grid [grid-template-columns:1.2fr_2fr_1fr] gap-12 bg-purple-600 text-white pt-12 pb-6 px-12 relative"
        style={{
          backgroundImage: `url(${MapaFooter})`,
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          backgroundSize: "contain",
          backgroundOrigin: "content-box",
        }}
      >
        {/* First Column - Logo and Newsletter */}
        <div className="flex flex-col justify-between">
          <div className="flex flex-col gap-12">
            <div className="flex flex-row gap-2">
              <div className="rounded-full bg-white w-10 h-10 flex items-center justify-center">
                <img src="/images/logo.png" alt="" />
              </div>
              <span className="text-xl font-bold flex self-center items-center h-full text-white">
                Cash In
              </span>
            </div>
            <p className="text-sm text-white/80 max-w-xs">
              Lorem ipsum dolor sit amet consectetur adipisicing elit. Quisquam,
              vehicula ut.
            </p>
            <span className="text-xl font-bold text-white/80">Newsletter</span>
            <div className="flex flex-row">
              <input
                type="text"
                className="w-full py-3 px-4 rounded-l-full text-sm text-white placeholder-white placeholder-opacity-50 bg-transparent focus:outline-none border border-white/20"
                placeholder="Ingresa tu email"
              />
              <button className="bg-yellow-400 hover:bg-yellow-500 transition-colors text-gray-900 font-semibold py-3 px-6 rounded-r-full whitespace-nowrap">
                Suscribirme
              </button>
            </div>
            <span className="text-sm text-white/80">
              Tu correo está seguro con nosotros, no enviamos spam.{" "}
              <strong>
                <a href="#" className="text-white hover:underline">
                  Política de privacidad
                </a>
              </strong>
            </span>
          </div>
          <div>
            <p className="text-sm text-white/80 mt-4">
              © {new Date().getFullYear()} Todos los derechos reservados.
            </p>
          </div>
        </div>

        {/* Second Column - Dirección */}
        <div className="flex flex-col gap-8">
          <h3 className="text-xl font-bold">Dirección</h3>
          <div className="space-y-4">
            <p className="text-sm text-white/80">
              4a. Calle 9-50, Zona 13
              <br />
              Colonia Lomas de Pamplona
            </p>
            <div className="space-y-1">
              <p className="text-sm text-white/80">
                Mail: comercial@publicashin.com
              </p>
              <p className="text-sm text-white/80">PBX: + (502) 1234 5678</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex gap-24">
              <div>
                <h3 className="text-xl font-bold">Sala de Ventas</h3>
                <div className="space-y-4 mt-4">
                  <p className="text-sm text-white/80">
                    Carretera a Mixchó
                    <br />
                    Bodega 174
                    <br />
                    Complejo Nombre
                  </p>
                  <div className="space-y-1">
                    <p className="text-sm text-white/80">
                      Mail: ventas@publicashin.com
                    </p>
                    <p className="text-sm text-white/80">
                      Tel: + (502) 4353 4321
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-8">
                <div>
                  <h3 className="text-xl font-bold">PBX:</h3>
                  <p className="text-xl font-bold text-yellow-400 mt-4">
                    + (502) 4353 8390
                  </p>
                </div>

                <div>
                  <h3 className="text-xl font-bold">Síguenos</h3>
                  <div className="flex gap-4 mt-4">
                    <a href="#" className="text-white/80 hover:text-white">
                      <div className="w-8 h-8 bg-white/20 rounded-sm flex items-center justify-center">
                        <span className="text-sm">f</span>
                      </div>
                    </a>
                    <a href="#" className="text-white/80 hover:text-white">
                      <div className="w-8 h-8 bg-white/20 rounded-sm flex items-center justify-center">
                        <span className="text-sm">t</span>
                      </div>
                    </a>
                    <a href="#" className="text-white/80 hover:text-white">
                      <div className="w-8 h-8 bg-white/20 rounded-sm flex items-center justify-center">
                        <span className="text-sm">in</span>
                      </div>
                    </a>
                    <a href="#" className="text-white/80 hover:text-white">
                      <div className="w-8 h-8 bg-white/20 rounded-sm flex items-center justify-center">
                        <span className="text-sm">ig</span>
                      </div>
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Third Column - Más Vendidos */}
        <div className="flex flex-col gap-8">
          <div>
            <h3 className="text-xl font-bold mb-4">Más Vendidos</h3>
            <ul className="space-y-2 text-sm text-white/80">
              <li>Jaguar</li>
              <li>BMW</li>
              <li>Toyota</li>
              <li>Hyundai</li>
              <li>Mazda</li>
              <li>Honda</li>
            </ul>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default NewLandingPage;
