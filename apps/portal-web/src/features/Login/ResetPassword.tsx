import { NavBar } from "@/components";
import { FormResetPassword } from "./components/FormResetPassword";

interface ResetPasswordProps {
  token: string;
}

export const ResetPassword = ({ token }: ResetPasswordProps) => {
  if (!token) {
    return (
      <div className="w-full flex justify-center mb-20 mt-26 items-center">
        <div className="w-[500px] flex flex-col text-center">
          <h2 className="text-header-2">Enlace inválido</h2>
          <p className="text-white/60 mt-4">
            El enlace para restablecer la contraseña es inválido o ha expirado.
            Por favor, solicita un nuevo enlace desde la página de inicio de
            sesión.
          </p>
        </div>
      </div>
    );
  }

  return <div>
    <NavBar />
    <FormResetPassword token={token} />;
    </div>
};
