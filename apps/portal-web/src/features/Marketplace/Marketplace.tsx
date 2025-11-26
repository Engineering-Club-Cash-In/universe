import { NavBar } from "@/components";
import { HeaderMarket, CarOverlay,  CalculatorCredit } from "./Sections";
import { FindYourIdealModel } from "../HomePage/sections";

export const Marketplace = () => {
  return (
    <div className="mt-4">
        <NavBar />
        <HeaderMarket />
        <CarOverlay />
        <FindYourIdealModel />
        <CalculatorCredit />
    </div>
  );
}