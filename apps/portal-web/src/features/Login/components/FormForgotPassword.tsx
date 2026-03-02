import { Input, Button, Link } from "@components/ui";
import { useForgotPassword } from "../hook/useForgotPassword";
import { useIsMobile } from "@/hooks";

export const FormForgotPassword = () => {
  const { formik, isLoading, errorMessage, emailSent } = useForgotPassword();
  const isMobile = useIsMobile();

  if (emailSent) {
    return (
      <div className="w-full flex justify-center mb-20 mt-16 items-center">
        <div className="w-full lg:w-[500px] flex flex-col text-center items-center gap-6">
          <div className="w-16 h-16 rounded-full bg-green-500/20 border border-green-500/50 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-green-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
          </div>
          <h2 className="text-4xl lg:text-header-2">Revisa tu correo</h2>
          <p className="text-white/60 text-sm lg:text-base leading-relaxed">
            Te enviamos un correo con las instrucciones para restablecer tu
            contraseña. Si no lo ves, revisa tu carpeta de spam.
          </p>
          <p className="text-white/40 text-xs">
            Enviado a{" "}
            <span className="text-white/70 font-medium">
              {formik.values.email}
            </span>
          </p>
          <Link href="/login" underline>
            Volver al inicio de sesión
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full flex justify-center mb-20 mt-16 items-center">
      <div className="w-full lg:w-[500px] flex flex-col text-center">
        <h2 className="text-4xl lg:text-header-2">Recuperar cuenta</h2>
        <p className="text-white/60 mt-2 text-sm lg:text-base">
          Ingresa tu correo electrónico y te enviaremos un enlace para
          restablecer tu contraseña
        </p>

        {errorMessage && (
          <div className="mt-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg">
            <p className="text-red-400 text-sm">{errorMessage}</p>
          </div>
        )}

        <form
          className="w-full mt-10 flex flex-col gap-6"
          onSubmit={formik.handleSubmit}
        >
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

          <div className="flex justify-center items-center mt-4 flex-col gap-8 text-sm lg:text-base">
            <Button
              type="submit"
              isLoading={isLoading}
              size={isMobile ? "md" : "lg"}
            >
              {isLoading ? "Enviando correo..." : "Continuar"}
            </Button>
            <div className="flex justify-center items-center flex-col">
              <span>¿No tienes cuenta?</span>
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
