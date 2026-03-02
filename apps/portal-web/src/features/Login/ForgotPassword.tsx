import { NavBar } from "@/components";
import { FormForgotPassword } from "./components/FormForgotPassword";

export const ForgotPassword = () => {
  return (
    <div>
      <div className="w-full mt-4 p-8">
        <NavBar />
        <FormForgotPassword />
      </div>
    </div>
  );
};
