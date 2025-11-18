import { NavBar } from "@components/ui";
import { Footer } from "@features/footer";
import { FormLogin } from "./components";

export const Login = () => {
  return (
    <div>
      <div className="w-full mt-4 p-8 ">
        <NavBar />
        <FormLogin />
      </div>
      <Footer />
    </div>
  );
};
