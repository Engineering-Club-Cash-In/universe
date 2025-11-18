import { NavBar } from "@components/ui";
import {
  CarrouselStart,
  HowItWorks,
  Testimonies,
  GraphLine,
} from "./sections";
import { Footer } from "@features/footer";
import { WhoWeAre } from "./sections/whoWeAre/WhoWeAre";
import { HowSellOrBuy } from "./sections/howSellOrBuy/HowSellOrBuy";

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
      <div className="w-full mt-6 p-8 ">
        <NavBar />
        <WhoWeAre />
        <HowItWorks />
        <GraphLine />
        <HowSellOrBuy />
        <Testimonies />
      </div>
      <Footer />
    </div>
  );
};
