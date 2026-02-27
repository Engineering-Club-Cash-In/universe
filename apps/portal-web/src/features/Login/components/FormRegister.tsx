import { Input, ButtonIcon, CheckBox, Button, Link } from "@components/ui";
import { IconGoogle } from "@components/icons";
import { useRegister } from "../hook/useRegister";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useState } from "react";
import { ModalTerms } from "./ModalTerms";

export const FormRegister = () => {
  const {
    formik,
    handleGoogleRegister,
    isLoading,
    isGoogleLoading,
    currentStep,
    nextStep,
  } = useRegister();
  const isMobile = useIsMobile();
  const [isTermsOpen, setIsTermsOpen] = useState(false);

  const handleStep1Next = () => {
    // Validar tipo de usuario y DPI antes de continuar
    formik.setFieldTouched("userType", true);
    formik.setFieldTouched("dpi", true);

    if (formik.values.userType && formik.values.dpi && !formik.errors.dpi) {
      nextStep();
    }
  };

  return (
    <div className="w-full flex justify-center mb-20 mt-16 items-center">
      <div className="w-full lg:w-[500px] flex flex-col text-center">
        <h2 className="text-4xl lg:text-header-2">Crea tu usuario</h2>

        {/* Indicador de pasos */}
        <div className="flex items-center justify-center gap-2 mt-8 mb-6">
          <div
            className={`h-2 rounded-full transition-all ${
              currentStep >= 1 ? "w-8 bg-primary" : "w-2 bg-white/20"
            }`}
          />
          <div
            className={`h-2 rounded-full transition-all ${
              currentStep >= 2 ? "w-8 bg-primary" : "w-2 bg-white/20"
            }`}
          />
        </div>

        {/* Paso 1: Tipo de usuario y DPI */}
        {currentStep === 1 && (
          <div className="w-full mt-4 flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <label className="text-left text-sm lg:text-base font-medium">
                ¿Qué deseas hacer? *
              </label>
              <div className="flex flex-col lg:flex-row gap-4">
                <label
                  className={`flex-1 flex items-center gap-3 p-4 border rounded-lg cursor-pointer transition-all ${
                    formik.values.userType === "CLIENT"
                      ? "border-primary bg-primary/10"
                      : "border-white/20 hover:border-white/40"
                  }`}
                >
                  <input
                    type="radio"
                    name="userType"
                    value="CLIENT"
                    checked={formik.values.userType === "CLIENT"}
                    onChange={() => formik.setFieldValue("userType", "CLIENT")}
                    onBlur={formik.handleBlur}
                    className="w-4 h-4 accent-primary"
                  />
                  <div className="text-left">
                    <p className="font-semibold">Solicitar Crédito</p>
                    <p className="text-xs text-white/65">
                      Para financiar tu vehículo
                    </p>
                  </div>
                </label>

                <label
                  className={`flex-1 flex items-center gap-3 p-4 border rounded-lg cursor-pointer transition-all ${
                    formik.values.userType === "INVESTOR"
                      ? "border-primary bg-primary/10"
                      : "border-white/20 hover:border-white/40"
                  }`}
                >
                  <input
                    type="radio"
                    name="userType"
                    value="INVESTOR"
                    checked={formik.values.userType === "INVESTOR"}
                    onChange={() =>
                      formik.setFieldValue("userType", "INVESTOR")
                    }
                    onBlur={formik.handleBlur}
                    className="w-4 h-4 accent-primary"
                  />
                  <div className="text-left">
                    <p className="font-semibold">Invertir</p>
                    <p className="text-xs text-white/65">
                      Para generar rendimientos
                    </p>
                  </div>
                </label>
              </div>
              {formik.touched.userType && formik.errors.userType && (
                <p className="text-red-500 text-sm text-left">
                  {formik.errors.userType}
                </p>
              )}
            </div>

            <Input
              name="dpi"
              value={formik.values.dpi}
              onChange={(value) => formik.setFieldValue("dpi", value)}
              onBlur={formik.handleBlur}
              placeholder="DPI *"
              type="text"
              error={
                formik.touched.dpi && formik.errors.dpi
                  ? formik.errors.dpi
                  : undefined
              }
            />

            <Button
              onClick={handleStep1Next}
              size={isMobile ? "sm" : "md"}
              type="button"
            >
              Continuar
            </Button>

            <div className="flex justify-center items-center gap-1 flex-col text-sm lg:text-base">
              <div>¿Ya tienes una cuenta?</div>
              <div>
                <Link href="/login" underline>
                  Inicia sesión
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Paso 2: Métodos de registro */}
        {currentStep === 2 && (
          <div className="w-full mt-4 flex flex-col gap-6">
            {/* Botón de Google */}
            <ButtonIcon
              icon={<IconGoogle />}
              onClick={handleGoogleRegister}
              variant={isMobile ? "md" : "lg"}
              isLoading={isGoogleLoading}
            >
              {isGoogleLoading
                ? "Redirigiendo a Google..."
                : "Continuar con Google"}
            </ButtonIcon>

            {/* Separador */}
            <div className="flex items-center gap-4 my-2">
              <div className="flex-1 h-px bg-white/20"></div>
              <span className="text-sm text-white/60">o</span>
              <div className="flex-1 h-px bg-white/20"></div>
            </div>

            {/* Formulario manual */}
            <form
              className="w-full flex flex-col gap-6"
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
                onChange={(value) =>
                  formik.setFieldValue("confirmPassword", value)
                }
                onBlur={formik.handleBlur}
                placeholder="Confirmar contraseña *"
                type="password"
                error={
                  formik.touched.confirmPassword &&
                  formik.errors.confirmPassword
                    ? formik.errors.confirmPassword
                    : undefined
                }
              />

              <CheckBox
                checked={formik.values.acceptTerms}
                onChange={(checked) =>
                  formik.setFieldValue("acceptTerms", checked)
                }
                label="Acepto los términos y condiciones"
                isLabelLink={true}
                onLabelClick={() => setIsTermsOpen(true)}
              />
              {formik.touched.acceptTerms && formik.errors.acceptTerms && (
                <p className="text-red-500 text-sm -mt-4">
                  {formik.errors.acceptTerms}
                </p>
              )}

              <div className="flex flex-col gap-4 mt-4">
                <Button
                  type="submit"
                  isLoading={isLoading}
                  size={isMobile ? "sm" : "md"}
                >
                  Crear cuenta
                </Button>
              </div>

              <div className="flex justify-center items-center gap-1 flex-col text-sm lg:text-base">
                <div>¿Ya tienes una cuenta?</div>
                <div>
                  <Link href="/login" underline>
                    Inicia sesión
                  </Link>
                </div>
              </div>
            </form>
          </div>
        )}
      </div>

      <ModalTerms
        open={isTermsOpen}
        onClose={() => setIsTermsOpen(false)}
        onAccept={() => {
          formik.setFieldValue("acceptTerms", true);
          setIsTermsOpen(false);
        }}
      />
    </div>
  );
};
