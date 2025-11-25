import { NavBar } from "@/components";
import { Header, BuyCar, GetMoney, Choose, StartToday } from "./Sections";

export const Credit = () => {
  return (
    <div>
      <NavBar />
      <Header />
      <BuyCar />
      <GetMoney />
      <Choose />
      <StartToday />
    </div>
  );
};
