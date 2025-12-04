import { Input, ButtonIcon, CheckBox, Button, Link } from "@components/ui";
import { IconGoogle } from "@components/icons";
import { useLogin } from "../hook/useLogin";

export const FormLogin = () => {
  const {
    formik,
    handleGoogleLogin,
    isLoading,
    isGoogleLoading,
    errorMessage,
    handleResetPassword,
    successMessage,
  } = useLogin();

  return (
    <div className="w-full flex justify-center mb-20 mt-16 items-center">
      <div className="w-[500px] flex flex-col text-center">
        <h2 className="text-header-2">Inicia sesión</h2>
        <form
          className="w-full mt-10 flex flex-col gap-6"
          onSubmit={formik.handleSubmit}
        >
          {errorMessage && (
            <div
              className="bg-red-50 border border-red-400 text-red-700 px-4 py-3 rounded relative"
              role="alert"
            >
              <span className="block sm:inline">{errorMessage}</span>
            </div>
          )}
          <Input
            name="email"
            value={formik.values.email}
            onChange={(value) => formik.setFieldValue("email", value)}
            onBlur={formik.handleBlur}
            placeholder="Correo electrónico"
            type="email"
            error={
              formik.touched.email && formik.errors.email
                ? formik.errors.email
                : undefined
            }
          />
          <Input
            name="password"
            value={formik.values.password}
            onChange={(value) => formik.setFieldValue("password", value)}
            onBlur={formik.handleBlur}
            placeholder="Contraseña"
            type="password"
            error={
              formik.touched.password && formik.errors.password
                ? formik.errors.password
                : undefined
            }
          />
          <ButtonIcon
            icon={<IconGoogle />}
            onClick={handleGoogleLogin}
            variant="lg"
            isLoading={isGoogleLoading}
          >
            {isGoogleLoading ? "Redirigiendo a Google..." : "Google"}
          </ButtonIcon>
          <CheckBox
            checked={formik.values.rememberMe ?? false}
            onChange={(checked) => formik.setFieldValue("rememberMe", checked)}
            label="Recordar usuario"
          />
          <div className="flex justify-center items-center mt-4 flex-col gap-8">
            <Button type="submit" isLoading={isLoading}>
              Iniciar sesión
            </Button>
            <Link href="#" onClick={handleResetPassword} underline>
              ¿Olvidaste tu contraseña?
            </Link>
            {successMessage && (
              <div
                className="bg-green-50 border border-green-400 text-green-700 px-4 py-3 rounded relative"
                role="alert"
              >
                <span className="block sm:inline">{successMessage}</span>
              </div>
            )}
            <div className="flex justify-center items-center flex-col">
              <span>¿No tienes una cuenta?</span>
              <Link href="/register" underline>
                Regístrate
              </Link>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
