import { Input, ButtonIcon, CheckBox, Button, Link } from "@components/ui";
import { IconGoogle } from "@components/icons";
import { useRegister } from "../hook/useRegister";

export const FormRegister = () => {
  const { formik, handleGoogleRegister, isLoading, isGoogleLoading } =
    useRegister();

  return (
    <div className="w-full flex justify-center mb-20 mt-6 items-center">
      <div className="w-[500px] flex flex-col text-center">
        <h2 className="text-header-2">Crea tu usuario</h2>
        <form
          className="w-full mt-10 flex flex-col gap-6"
          onSubmit={formik.handleSubmit}
        >
          <Input
            name="fullName"
            value={formik.values.fullName}
            onChange={(value) => formik.setFieldValue("fullName", value)}
            onBlur={formik.handleBlur}
            placeholder="Nombre completo *"
            type="text"
            error={
              formik.touched.fullName && formik.errors.fullName
                ? formik.errors.fullName
                : undefined
            }
          />

          <Input
            name="email"
            value={formik.values.email}
            onChange={(value) => formik.setFieldValue("email", value)}
            onBlur={formik.handleBlur}
            placeholder="Correo electrónico *"
            type="email"
            error={
              formik.touched.email && formik.errors.email
                ? formik.errors.email
                : undefined
            }
          />
          <Input
            name="phone"
            value={formik.values.phone}
            onChange={(value) => formik.setFieldValue("phone", value)}
            onBlur={formik.handleBlur}
            placeholder="Número telefónico"
            type="text"
            error={
              formik.touched.phone && formik.errors.phone
                ? formik.errors.phone
                : undefined
            }
          />
          <Input
            name="password"
            value={formik.values.password}
            onChange={(value) => formik.setFieldValue("password", value)}
            onBlur={formik.handleBlur}
            placeholder="Contraseña *"
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
            placeholder="Confirmar contraseña *"
            type="password"
            error={
              formik.touched.confirmPassword && formik.errors.confirmPassword
                ? formik.errors.confirmPassword
                : undefined
            }
          />
          <ButtonIcon
            icon={<IconGoogle />}
            onClick={handleGoogleRegister}
            variant="lg"
            isLoading={isGoogleLoading}
          >
            {isGoogleLoading ? "Redirigiendo a Google..." : "Google"}
          </ButtonIcon>
          <CheckBox
            checked={formik.values.acceptTerms}
            onChange={(checked) => formik.setFieldValue("acceptTerms", checked)}
            label="Acepto los términos y condiciones"
            isLabelLink={true}
            // labelHref="/terms"
          />
          {formik.touched.acceptTerms && formik.errors.acceptTerms && (
            <p className="text-red-500 text-sm -mt-4">
              {formik.errors.acceptTerms}
            </p>
          )}
          <div className="flex justify-center items-center mt-4 flex-col gap-8">
            <Button type="submit" isLoading={isLoading}>
              Crear cuenta
            </Button>
            <div className="flex justify-center items-center flex-col">
              <span>¿Ya tienes una cuenta?</span>
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
