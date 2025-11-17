import { NavBar } from "@/components";
import { Header, BuyCar, GetMoney, Choose, StartToday } from "./Sections";
import { Footer } from "../footer";

export const Credit = () => {
  return (
    <div>
      <NavBar />
      <Header />
      <BuyCar />
      <GetMoney />
      <Choose />
      <StartToday />
      <Footer />
    </div>
  );
};
