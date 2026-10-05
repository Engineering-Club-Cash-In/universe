import { useResetPassword } from "../hook/useResetPassword";
import {
  FormularioNuevaPassword,
  PieVolverAlLogin,
} from "./FormularioNuevaPassword";

interface FormResetPasswordProps {
  token: string;
}

export const FormResetPassword = ({ token }: FormResetPasswordProps) => {
  const { formik, isLoading, errorMessage, successMessage } =
    useResetPassword(token);

  return (
    <FormularioNuevaPassword
      formik={formik}
      isLoading={isLoading}
      errorMessage={errorMessage}
      successMessage={successMessage}
      titulo="Restablecer contraseña"
      descripcion="Ingresa tu nueva contraseña para continuar"
      textoBoton="Restablecer contraseña"
      textoBotonCargando="Restableciendo..."
      pie={<PieVolverAlLogin />}
    />
  );
};
