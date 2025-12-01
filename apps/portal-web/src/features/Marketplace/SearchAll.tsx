import { NavBar } from "@/components";
import { ViewCars, CalculatorCredit } from "./Sections";

export const SearchAll = () => {
  return (
    <div className="mt-4">
      <NavBar />
      <ViewCars />
      <CalculatorCredit />
    </div>
  );
};
