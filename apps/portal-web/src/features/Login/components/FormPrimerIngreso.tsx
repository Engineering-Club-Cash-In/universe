import { usePrimerIngreso } from "../hook/usePrimerIngreso";
import { FormularioNuevaPassword } from "./FormularioNuevaPassword";

export const FormPrimerIngreso = () => {
  const { formik, isLoading, errorMessage, successMessage, cerrarSesion } =
    usePrimerIngreso();

  return (
    <FormularioNuevaPassword
      formik={formik}
      isLoading={isLoading}
      errorMessage={errorMessage}
      successMessage={successMessage}
      titulo="Elegí tu contraseña"
      descripcion="La contraseña con la que entraste la generamos nosotros y viajó por correo. Poné una que solo vos sepas para continuar."
      pidePasswordActual
      textoBoton="Guardar contraseña"
      textoBotonCargando="Guardando..."
      pie={
        // La salida. Sin esto, quien abre el correo en una computadora ajena o
        // simplemente no quiere seguir ahora, queda encerrado en la pantalla.
        <button
          type="button"
          onClick={cerrarSesion}
          className="text-white/60 underline cursor-pointer"
        >
          Cerrar sesión
        </button>
      }
    />
  );
};
