import { NavBar } from "@/components";
import { CalculatorCredit } from "./Sections";
import { BarFilters } from "./components";
import { SearchCar } from "./Sections/Car/SearchCar";

export const SingleCar = () => {
  return (
    <div className="mt-4">
      <NavBar />
      <div className="flex min-h-screen relative pt-12">
        {/* Sidebar de filtros */}
        <div className="max-w-80 sticky left-0 top-0 h-screen overflow-y-auto bg-linear-to-b from-[rgba(154,159,245,0.05)] to-[rgba(90,93,143,0.05)] p-8 px-6 border-r border-white/10 self-start">
          <BarFilters />
        </div>

        {/* Contenido principal */}
        <div  className="flex-1 flex flex-col items-center">
          <SearchCar />
        </div>
      </div>
      <CalculatorCredit />
    </div>
  );
};
