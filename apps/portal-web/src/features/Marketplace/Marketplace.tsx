import { NavBar } from "@/components";
import { HeaderMarket, CarOverlay } from "./Sections";

export const Marketplace = () => {
  return (
    <div className="mt-4">
        <NavBar />
        <HeaderMarket />
        <CarOverlay />
        {/* Marketplace content goes here */}
    </div>
  );
}