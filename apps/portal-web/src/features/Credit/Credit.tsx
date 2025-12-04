import { NavBar } from "@/components";
import { Header, BuyCar, GetMoney, Choose, StartToday } from "./Sections";
import { useIsMobile } from "@/hooks";

export const Credit = () => {
  const isMobile = useIsMobile();

  const middleSections = [<Choose key="choose" />, <GetMoney key="getmoney" />];

  return (
    <div>
      <NavBar />
      <Header />
      <BuyCar />
      {isMobile ? middleSections.reverse() : middleSections}
      <StartToday />
    </div>
  );
};
