import { NavBar } from "@components/ui";
import { Footer } from "@features/footer";
import { FormRegister } from "./components/FormRegister";

export const Register = () => {
  return (
    <div>
      <div className="w-full mt-4 p-8">
        <NavBar />
        <FormRegister />
      </div>
      <Footer />
    </div>
  );
};
