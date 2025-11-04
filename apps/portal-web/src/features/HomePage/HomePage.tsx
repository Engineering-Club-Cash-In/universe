import { NavBar } from "@components/ui";
import {
  CarrouselStart,
  HowItWorks,
  FindYourIdealModel,
  Testimonies,
  GraphLine
} from "./sections";
import { Footer } from "@features/footer";

export const HomePage = () => {
  return (
    <div>
      <CarrouselStart />
      <div className="relative">
        {/* Shadow overlay - Enhanced visibility */}
        <div
          style={{
            background:
              "linear-gradient(180deg, rgba(0, 0, 0, 0.95) 0%, rgba(0, 0, 0, 0.7) 25%, rgba(0, 0, 0, 0.4) 50%, rgba(0, 0, 0, 0) 100%)",
          }}
          className="absolute top-0 left-0 right-0 h-[200px] pointer-events-none z-40"
        />
      </div>
      <div className="w-full mt-10 p-8 ">
        <NavBar />
        <HowItWorks />
        <FindYourIdealModel />
        <GraphLine />
        <Testimonies />
      </div>
      <Footer />
    </div>
  );
};
