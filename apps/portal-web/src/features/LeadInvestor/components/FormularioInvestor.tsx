import { Input, Button, Select } from "@/components";
import { IconPersonIndividual } from "@/components/icons/IconPersonIndividual";
import { IconPersonJuridica } from "@/components/icons/IconPersonJuridica";
import { useFormInvestor } from "../hooks/useFormInvestor";
import { useIsMobile } from "@/hooks";
import type { ProfileType } from "../hooks/useFormInvestor";

const PROFILE_OPTIONS: {
  value: ProfileType;
  label: string;
  icon: React.ReactNode;
}[] = [
  {
    value: "individual",
    label: "Persona Individual",
    icon: <IconPersonIndividual className="w-5 h-5" />,
  },
  {
    value: "juridica",
    label: "Persona Jurídica",
    icon: <IconPersonJuridica className="w-5 h-5" />,
  },
];

const EXPERIENCE_OPTIONS = [
  { value: "ninguna", label: "Sin experiencia" },
  { value: "basica", label: "Básica" },
  { value: "intermedia", label: "Intermedia" },
  { value: "avanzada", label: "Avanzada" },
];

export const FormularioInvestor = () => {
  const {
    values,
    errors,
    touched,
    handleChange,
    setFieldValue,
    setFieldTouched,
    handleBlur,
    handleSubmit,
    isSubmitting,
    serverError,
  } = useFormInvestor();
  const isMobile = useIsMobile();

  const handleProfileSelect = (type: ProfileType) => {
    setFieldValue("profileType", type, false);
    setFieldTouched("profileType", true, false);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 text-center">
      <h1 className="text-2xl  mb-2">
        Solicita asesoría personalizada
      </h1>
      <p className="text-base text-[#7A7A8A] mb-4">
        Déjanos tus datos y un asesor de inversiones se comunicará
        <br />
        contigo para brindarte información detallada.
      </p>

      {/* Selector de tipo de perfil */}
      <div className="flex flex-col gap-3 mb-2">
        <p className="text-left font-medium text-sm text-[#7A7A8A]">
          Selecciona tipo de perfil *
        </p>
        <div className="flex flex-row gap-3">
          {PROFILE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => handleProfileSelect(option.value)}
              className={`flex-1 flex flex-col items-center justify-center gap-3 p-4 border rounded-lg cursor-pointer transition-all ${
                values.profileType === option.value
                  ? "border-secondary bg-secondary/10 text-secondary"
                  : "border-white/20 hover:border-white/40 text-white/70"
              }`}
            >
              <div className="flex items-center gap-2">{option.icon}</div>
              <span className="font-semibold text-sm">{option.label}</span>
            </button>
          ))}
        </div>
        {touched.profileType && errors.profileType && (
          <p className="text-[#FD5353] text-sm text-left">{errors.profileType}</p>
        )}
      </div>

      {/* Campos condicionales según tipo de perfil */}
      {values.profileType === "individual" && (
        <>
          <Input
            name="nombreCompleto"
            placeholder="Nombre y apellido *"
            value={values.nombreCompleto}
            onChange={handleChange("nombreCompleto")}
            onBlur={handleBlur}
            variant="secondary"
            sanitize="name"
            error={
              touched.nombreCompleto && errors.nombreCompleto
                ? errors.nombreCompleto
                : undefined
            }
          />
          <Input
            name="dpi"
            placeholder="DPI o número de identificación *"
            value={values.dpi}
            onChange={handleChange("dpi")}
            onBlur={handleBlur}
            sanitize="numeric"
            maxLength={13}
            error={touched.dpi && errors.dpi ? errors.dpi : undefined}
          />
        </>
      )}

      {values.profileType === "juridica" && (
        <>
          <Input
            name="nombreSociedad"
            placeholder="Nombre de Sociedad *"
            value={values.nombreSociedad}
            onChange={handleChange("nombreSociedad")}
            onBlur={handleBlur}
            sanitize="safe-text"
            error={
              touched.nombreSociedad && errors.nombreSociedad
                ? errors.nombreSociedad
                : undefined
            }
          />
          <Input
            name="representanteLegal"
            placeholder="Nombre de representante legal *"
            value={values.representanteLegal}
            onChange={handleChange("representanteLegal")}
            onBlur={handleBlur}
            sanitize="name"
            error={
              touched.representanteLegal && errors.representanteLegal
                ? errors.representanteLegal
                : undefined
            }
          />
        </>
      )}

      {/* Campos comunes (solo se muestran si ya se eligió perfil) */}
      {values.profileType && (
        <>
          <Input
            name="correo"
            type="email"
            placeholder="Correo electrónico *"
            value={values.correo}
            onChange={handleChange("correo")}
            onBlur={handleBlur}
            error={touched.correo && errors.correo ? errors.correo : undefined}
          />

          <Input
            name="telefono"
            placeholder="Teléfono (WhatsApp) *"
            value={values.telefono}
            onChange={handleChange("telefono")}
            onBlur={handleBlur}
            sanitize="numeric"
            maxLength={8}
            error={
              touched.telefono && errors.telefono ? errors.telefono : undefined
            }
          />

          <Select
            options={EXPERIENCE_OPTIONS}
            value={values.experiencia}
            onChange={(value) => {
              setFieldValue("experiencia", value);
              setFieldTouched("experiencia", true, false);
            }}
            placeholder="Tu experiencia en inversión"
            variant="secondary"
          />
          {touched.experiencia && errors.experiencia && (
            <p className="text-[#FD5353] text-sm text-left -mt-2">{errors.experiencia}</p>
          )}

          <Input
            name="mensaje"
            type="area"
            placeholder="Mensaje o preguntas adicionales"
            value={values.mensaje}
            onChange={handleChange("mensaje")}
            onBlur={handleBlur}
            sanitize="safe-text"
            maxLength={500}
          />

          <p className="text-xs text-[#7A7A8A] text-left">* Campos obligatorios</p>

          {serverError && (
            <div className="text-[#FD5353] text-sm text-left bg-[#FD5353]/10 border border-[#FD5353]/30 rounded-lg p-3">
              {serverError}
            </div>
          )}

          <Button
            className="mt-2"
            type="submit"
            size={isMobile ? "sm" : "md"}
            variant="secondary"
            isLoading={isSubmitting}
          >
            {isSubmitting ? "Enviando..." : "Enviar formulario"}
          </Button>
          <p className="text-xs text-[#7A7A8A]">
            Tus datos están protegidos. No compartimos tu información con terceros.
          </p>
        </>
      )}
    </form>
  );
};
