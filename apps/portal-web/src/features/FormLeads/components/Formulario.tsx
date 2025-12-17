import { Input, Button } from "@/components";
import { useFormLeads } from "../hooks/useForm";
import { useIsMobile } from "@/hooks";

export const Formulario = () => {
  const {
    values,
    errors,
    touched,
    handleChange,
    handleBlur,
    handleSubmit,
    isSubmitting,
    serverError,
  } = useFormLeads();
  const isMobile = useIsMobile();

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 text-center">
      <h1 className="lg:text-body mb-4">
        Completa la información y nos pondremos en contacto contigo
      </h1>
      <Input
        name="nombreCompleto"
        placeholder="Nombre completo"
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
        name="correo"
        type="email"
        placeholder="Correo electrónico"
        value={values.correo}
        onChange={handleChange("correo")}
        onBlur={handleBlur}
        error={touched.correo && errors.correo ? errors.correo : undefined}
      />

      <Input
        name="telefono"
        placeholder="Número telefónico"
        value={values.telefono}
        onChange={handleChange("telefono")}
        onBlur={handleBlur}
        error={
          touched.telefono && errors.telefono ? errors.telefono : undefined
        }
      />

      <Input
        name="dpi"
        placeholder="DPI"
        value={values.dpi}
        onChange={handleChange("dpi")}
        onBlur={handleBlur}
        error={touched.dpi && errors.dpi ? errors.dpi : undefined}
      />

      <Input
        name="descripcion"
        type="area"
        placeholder="Descrìbenos el auto de tus sueños para que nuestros agentes puedan ayudarte de la mejor manera."
        value={values.descripcion}
        onChange={handleChange("descripcion")}
        onBlur={handleBlur}
      />

      {serverError && (
        <div className="text-red-500 text-sm text-left bg-red-50 border border-red-200 rounded-lg p-3">
          {serverError}
        </div>
      )}

      <Button
        className="mt-4 w-1/2 mx-auto"
        type="submit"
        size={isMobile ? "sm" : "md"}
        isLoading={isSubmitting}
      >
        {isSubmitting ? "Enviando..." : "Enviar"}
      </Button>
    </form>
  );
};
