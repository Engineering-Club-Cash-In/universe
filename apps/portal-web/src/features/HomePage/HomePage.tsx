import { NavBar } from "@components/ui";
import { HowItWorks, FindYourIdealModel } from "./sections";

export const HomePage = () => {
  return (
    <div>
      <NavBar />
      <div className="w-full">
        <HowItWorks />
        <FindYourIdealModel />
      </div>
    </div>
  );
};
