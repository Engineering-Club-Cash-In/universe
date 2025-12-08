import { NavBar } from "@/components";
import { HeaderInvestor, HowFunction, WhyInvest, FAQ, Now } from "./Sections";

export const Investors = () => {

  return (
    <div>
      <NavBar />
      <HeaderInvestor />
      <HowFunction />
      <WhyInvest />
      <FAQ />
      <Now />
    </div>
  );
};
