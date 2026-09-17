import type { FormikProps } from "formik";
import { Input, Button, Link } from "@components/ui";
import { useIsMobile } from "@/hooks";

/**
 * La pantalla de "elegí tu contraseña", sin saber de dónde viene.
 *
 * La usan los dos caminos que ponen una contraseña nueva —el enlace del correo
 * y el primer ingreso con la contraseña que generamos— y por eso no tiene
 * lógica propia: recibe el formik ya armado y el texto que corresponda. Antes
 * de esto el formulario estaba pegado al camino del enlace, y el primer ingreso
 * habría terminado siendo una segunda pantalla casi igual que se despega de
 * esta a la primera corrección.
 */

export interface ValoresNuevaPassword {
  /** Solo el primer ingreso lo usa: la contraseña temporal que le mandamos. */
  passwordActual?: string;
  password: string;
  confirmPassword: string;
}

interface FormularioNuevaPasswordProps {
  formik: FormikProps<ValoresNuevaPassword>;
  isLoading: boolean;
  errorMessage: string;
  successMessage: string;
  titulo: string;
  descripcion: string;
  /** Muestra el campo de la contraseña temporal (solo primer ingreso). */
  pidePasswordActual?: boolean;
  textoBoton: string;
  textoBotonCargando: string;
  pie: React.ReactNode;
}

export const FormularioNuevaPassword = ({
  formik,
  isLoading,
  errorMessage,
  successMessage,
  titulo,
  descripcion,
  pidePasswordActual = false,
  textoBoton,
  textoBotonCargando,
  pie,
}: FormularioNuevaPasswordProps) => {
  const isMobile = useIsMobile();

  return (
    <div className="w-full flex justify-center mb-20 mt-26 items-center">
      <div className="w-full lg:w-[500px] flex flex-col text-center">
        <h2 className="text-4xl lg:text-header-2">{titulo}</h2>
        <p className="text-white/60 mt-2">{descripcion}</p>

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
          {pidePasswordActual && (
            <Input
              name="passwordActual"
              value={formik.values.passwordActual ?? ""}
              onChange={(value) => formik.setFieldValue("passwordActual", value)}
              onBlur={formik.handleBlur}
              placeholder="Contraseña temporal *"
              type="password"
              error={
                formik.touched.passwordActual && formik.errors.passwordActual
                  ? formik.errors.passwordActual
                  : undefined
              }
            />
          )}

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
            <Button
              type="submit"
              isLoading={isLoading || !!successMessage}
              size={isMobile ? "md" : "lg"}
            >
              {isLoading ? textoBotonCargando : textoBoton}
            </Button>
            <div className="flex justify-center items-center flex-col text-sm lg:text-base">
              {pie}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

/** El pie del camino del enlace, que ya existía. */
export const PieVolverAlLogin = () => (
  <>
    <span>¿Recordaste tu contraseña?</span>
    <Link href="/login" underline>
      Inicia sesión
    </Link>
  </>
);
