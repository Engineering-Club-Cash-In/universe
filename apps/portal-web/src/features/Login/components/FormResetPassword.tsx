import { Input, Button, Link } from "@components/ui";
import { useResetPassword } from "../hook/useResetPassword";

interface FormResetPasswordProps {
  token: string;
}

export const FormResetPassword = ({ token }: FormResetPasswordProps) => {
  const { formik, isLoading, errorMessage, successMessage } =
    useResetPassword(token);

  return (
    <div className="w-full flex justify-center mb-20 mt-26 items-center">
      <div className="w-[500px] flex flex-col text-center">
        <h2 className="text-header-2">Restablecer contraseña</h2>
        <p className="text-white/60 mt-2">
          Ingresa tu nueva contraseña para continuar
        </p>

        {errorMessage && (
          <div className="mt-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg">
            <p className="text-red-400 text-sm">{errorMessage}</p>
          </div>
        )}

        {successMessage && (
          <div className="mt-6 p-4 bg-green-500/20 border border-green-500/50 rounded-lg">
            <p className="text-green-400 text-sm">{successMessage}</p>
          </div>
        )}

        <form
          className="w-full mt-10 flex flex-col gap-6"
          onSubmit={formik.handleSubmit}
        >
          <Input
            name="password"
            value={formik.values.password}
            onChange={(value) => formik.setFieldValue("password", value)}
            onBlur={formik.handleBlur}
            placeholder="Nueva contraseña *"
            type="password"
            error={
              formik.touched.password && formik.errors.password
                ? formik.errors.password
                : undefined
            }
          />

          <Input
            name="confirmPassword"
            value={formik.values.confirmPassword}
            onChange={(value) => formik.setFieldValue("confirmPassword", value)}
            onBlur={formik.handleBlur}
            placeholder="Confirmar nueva contraseña *"
            type="password"
            error={
              formik.touched.confirmPassword && formik.errors.confirmPassword
                ? formik.errors.confirmPassword
                : undefined
            }
          />

          <div className="flex justify-center items-center mt-4 flex-col gap-8">
            <Button type="submit" isLoading={isLoading || !!successMessage}>
              {isLoading ? "Restableciendo..." : "Restablecer contraseña"}
            </Button>
            <div className="flex justify-center items-center flex-col">
              <span>¿Recordaste tu contraseña?</span>
              <Link href="/login" underline>
                Inicia sesión
              </Link>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
