import { NavBar } from "@/components";
import { Link } from "@components/ui";
import { FormResetPassword } from "./components/FormResetPassword";
import { useEstadoEnlaceReset } from "./hook/useEstadoEnlaceReset";

interface ResetPasswordProps {
  token: string;
}

/**
 * Lo que se ve cuando el enlace ya no sirve.
 *
 * Dice las dos razones reales por las que puede pasar —ya se usó, o venció— y
 * ofrece la salida en el mismo lugar. Antes esto solo aparecía si la URL venía
 * SIN token; con un token muerto la pantalla abría normal.
 */
const EnlaceNoValido = () => (
  <div className="w-full flex justify-center mb-20 mt-26 items-center">
    <div className="w-full lg:w-[500px] flex flex-col text-center">
      <h2 className="text-4xl lg:text-header-2">Este enlace ya no sirve</h2>
      <p className="text-white/60 mt-4">
        Los enlaces para cambiar la contraseña se usan una sola vez y vencen a
        las 24 horas. Si ya cambiaste tu contraseña, entrá con la nueva; si no,
        pedí uno nuevo.
      </p>
      <div className="flex justify-center items-center mt-8 flex-col gap-4 text-sm lg:text-base">
        <Link href="/forgot-password" underline>
          Solicitar un enlace nuevo
        </Link>
        <Link href="/login" underline>
          Ir a iniciar sesión
        </Link>
      </div>
    </div>
  </div>
);

export const ResetPassword = ({ token }: ResetPasswordProps) => {
  const estado = useEstadoEnlaceReset(token);

  return (
    <div>
      <NavBar />
      {estado === "validando" && (
        <div className="w-full flex justify-center mb-20 mt-26 items-center">
          <p className="text-white/60">Verificando el enlace...</p>
        </div>
      )}
      {estado === "invalido" && <EnlaceNoValido />}
      {estado === "valido" && <FormResetPassword token={token} />}
    </div>
  );
};
