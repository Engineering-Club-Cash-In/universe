import { NavBar } from "@/components";
import { HeaderInvestor, HowFunction, WhyInvest, FAQ, Now } from "./Sections";
import { Footer } from "../footer";

export const Investors = () => {
  return (
    <div>
      <NavBar />
      <HeaderInvestor />
      <HowFunction />
      <WhyInvest />
      <FAQ />
      <Now />
      <Footer />  
    </div>
  );
};
