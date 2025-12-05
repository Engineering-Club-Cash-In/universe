import { HeaderSell, HowItWorks, Questions, ReadyStart } from "./sections";
import { NavBar } from "@/components";

export const Sell = () => {
  return (
    <div>
      <NavBar />
      <HeaderSell />
      <div
        style={{
          paddingBottom: "40px",
          background:
            "linear-gradient(to bottom, rgba(0, 0, 0, 0.50) 0%, rgba(0, 0, 0, 0) 100%)",
        }}
      >
        <HowItWorks />
        <ReadyStart />
        <Questions />
      </div>
    </div>
  );
};
