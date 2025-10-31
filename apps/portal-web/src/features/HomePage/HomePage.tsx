import { NavBar } from "@components/ui";
import { CarrouselStart, HowItWorks, FindYourIdealModel } from "./sections";

export const HomePage = () => {
  return (
    <div>
      <CarrouselStart />
      <div className="w-full mt-12 p-8">
        <NavBar />
        <HowItWorks />
        <FindYourIdealModel />
      </div>
    </div>
  );
};
