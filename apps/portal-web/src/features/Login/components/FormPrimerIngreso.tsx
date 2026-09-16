import { Link } from "@components/ui";
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
        <div className="flex flex-col items-center gap-3">
          {/*
            La segunda salida, y no es decorativa: si al cambiar la contraseña
            el servidor no logró limpiar la marca de primer ingreso, esta
            pantalla vuelve a pedir la contraseña temporal —que ya no existe— y
            la cuenta queda sin forma de entrar. El enlace por correo reintenta
            esa misma limpieza, así que es la salida real de ese estado.
          */}
          <Link href="/forgot-password" underline>
            ¿La contraseña temporal ya no te funciona? Pedí un enlace por correo
          </Link>
          {/* Y la de siempre, para quien abre el correo en una máquina ajena. */}
          <button
            type="button"
            onClick={cerrarSesion}
            className="text-white/60 underline cursor-pointer"
          >
            Cerrar sesión
          </button>
        </div>
      }
    />
  );
};
