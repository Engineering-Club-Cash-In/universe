import { NavBar } from "@/components";
import { Header, BuyCar, GetMoney, Choose, StartToday } from "./Sections";
import { CalculatorCredit } from "@/features/Marketplace/Sections/CalculatorCredit";

export const Credit = () => {
  return (
    <div>
      <NavBar />
      <Header />
      <BuyCar />
      <CalculatorCredit />
      <GetMoney key="getmoney" />
      <Choose key="choose" />
      <StartToday />
    </div>
  );
};
