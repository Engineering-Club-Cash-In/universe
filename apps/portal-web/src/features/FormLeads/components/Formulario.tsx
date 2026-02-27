import { Input, Button } from "@/components";
import { IconCar } from "@/components/icons/IconCar";
import { IconLockClose } from "@/components/icons/IconLockClose";
import { useFormLeads } from "../hooks/useForm";
import { useIsMobile } from "@/hooks";
import type { CreditType } from "../hooks/useForm";
import { IconTarget2 } from "@/components/icons/IconTarget2";

const CREDIT_OPTIONS: {
  value: CreditType;
  label: string;
  icons: React.ReactNode;
}[] = [
  {
    value: "autocompra",
    label: "Comprar auto",
    icons: (
      <>
        <IconCar className="w-5 h-5" />
        <IconTarget2 className="w-5 h-5" />
      </>
    ),
  },
  {
    value: "sobre_vehiculo",
    label: "Auto en garantía",
    icons: (
      <>
        <IconCar className="w-5 h-5" />
        <IconLockClose className="w-5 h-5" />
      </>
    ),
  },
];

export const Formulario = () => {
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
  } = useFormLeads();
  const isMobile = useIsMobile();

  const handleCreditTypeSelect = (type: CreditType) => {
    setFieldValue("creditType", type);
    setFieldTouched("creditType", true, false);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 text-center">
      <h1 className="lg:text-body mb-4">
        Completa la información y nos pondremos en contacto contigo
      </h1>

      {/* Selector de tipo de crédito */}
      <div className="flex flex-col gap-3 mb-2">
        <p className="text-left  font-medium text-sm text-[#7A7A8A]">
          ¿Qué tipo de crédito estás buscando?
          <br />
          Esto nos ayuda a brindarte la información necesaria.
        </p>
        <div className="flex flex-col lg:flex-row gap-3">
          {CREDIT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => handleCreditTypeSelect(option.value)}
              className={`flex-1 flex flex-col items-center justify-center gap-3 p-4 border rounded-lg cursor-pointer transition-all ${
                values.creditType === option.value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-white/20 hover:border-white/40 text-white/70"
              }`}
            >
              <div className="flex items-center gap-2">{option.icons}</div>
              <span className="font-semibold text-sm">{option.label}</span>
            </button>
          ))}
        </div>
        {touched.creditType && errors.creditType && (
          <p className="text-[#FD5353] text-sm text-left">{errors.creditType}</p>
        )}
      </div>
      <Input
        name="nombreCompleto"
        placeholder="Nombre y apellido *"
        value={values.nombreCompleto}
        onChange={handleChange("nombreCompleto")}
        onBlur={handleBlur}
        error={
          touched.nombreCompleto && errors.nombreCompleto
            ? errors.nombreCompleto
            : undefined
        }
      />


      <Input
        name="dpi"
        placeholder="DPI *"
        value={values.dpi}
        onChange={handleChange("dpi")}
        onBlur={handleBlur}
        error={touched.dpi && errors.dpi ? errors.dpi : undefined}
      />

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
        error={
          touched.telefono && errors.telefono ? errors.telefono : undefined
        }
      />


      <Input
        name="descripcion"
        type="area"
        placeholder="Descríbenos el auto de tus sueños para que nuestros agentes puedan ayudarte de la mejor manera."
        value={values.descripcion}
        onChange={handleChange("descripcion")}
        onBlur={handleBlur}
      />

      {serverError && (
        <div className="text-[#FD5353] text-sm text-left bg-[#FD5353]/10 border border-[#FD5353]/30 rounded-lg p-3">
          {serverError}
        </div>
      )}

      <Button
        className="mt-4 w-1/2 mx-auto"
        type="submit"
        size={isMobile ? "sm" : "md"}
        isLoading={isSubmitting}
      >
        {isSubmitting ? "Enviando..." : "Enviar Formulario"}
      </Button>
      <p className="text-xs text-[#7A7A8A]">
        Tus datos están protegidos. No compartimos tu información con terceros.
      </p>
    </form>
  );
};
