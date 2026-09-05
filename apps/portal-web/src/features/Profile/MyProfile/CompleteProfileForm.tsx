import { useState } from "react";
import { InputIcon, Button, IconPerson } from "@/components";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib";
import { registerExternalUserAuth } from "../services";
import {
  mensajeDeDpiPendiente,
  mensajeDeWhatsAppPorDpiPendiente,
  registroQuedoSinDpi,
} from "../services/registroSinDpi";
import {
  rolFueEstablecido,
  tipoInicialDelFormulario,
} from "../identidadDelPortal";
import { openWhatsApp } from "@/hooks/useModalOptionsCall";

interface CompleteProfileFormProps {
  onSuccess: () => void;
  /**
   * Tipo que la persona eligió en un registro que no llegó a terminar (el
   * camino de Google lo lleva en la URL del callback). Sin esto el formulario
   * arrancaba en CLIENT, que es el valor por defecto, no su elección.
   */
  tipoSolicitado?: "CLIENT" | "INVESTOR" | null;
  /** Motivo por el que ese registro falló, para no llegar aquí en silencio. */
  mensajeInicial?: string;
  /**
   * Aviso de que el registro del camino de Google salió BIEN pero quedó sin
   * DPI. Va aparte de `mensajeInicial` porque no es un error suyo: se muestra
   * en el bloque de espera, no en el rojo, y bloquea el reintento.
   */
  pendienteInicial?: string;
}

export const CompleteProfileForm = ({
  onSuccess,
  tipoSolicitado = null,
  mensajeInicial = "",
  pendienteInicial = "",
}: CompleteProfileFormProps) => {
  const { user } = useAuth();
  const [dpi, setDpi] = useState("");
  // `CLIENT` a secas NO cuenta como rol elegido: es el valor por defecto de
  // toda cuenta nueva, así que una cuenta cuyo registro falló llegaba aquí como
  // cliente, con el selector escondido, y se reinscribía como cliente para
  // siempre. Ver `rolFueEstablecido`.
  const hasRole = rolFueEstablecido(user);
  const [userType, setUserType] = useState<"CLIENT" | "INVESTOR">(() =>
    tipoInicialDelFormulario({ tipoSolicitado, user }),
  );
  const [error, setError] = useState(mensajeInicial);
  // Aparte de `error` a propósito: no es algo que la persona pueda corregir
  // aquí, así que no se limpia al editar el DPI ni deja reintentar. Ver
  // `registroQuedoSinDpi`.
  const [pendiente, setPendiente] = useState(pendienteInicial);

  const completeMutation = useMutation({
    mutationFn: async () => {
      if (!dpi || dpi.length !== 13) {
        throw new Error("El DPI debe tener 13 dígitos");
      }

      // El rol y el DPI los escribe el servidor al validar el registro, no el
      // cliente. Antes había aquí una rama `onlyApi` que llamaba a la variante
      // SIN sesión; nunca se activaba (nadie pasaba la prop) y se retiró junto
      // con esa ruta, que filtraba fichas del CRM a cualquiera.
      //
      // La respuesta se DEVUELVE: un 200 no siempre significa que la cuenta
      // quedó con DPI, y descartarla era lo que dejaba a la persona dando
      // vueltas en este mismo formulario.
      return await registerExternalUserAuth({
        userType: userType,
        fullName: user?.name || user?.email.split("@")[0] || "",
        email: user?.email ?? "",
        dpi: dpi,
      });
    },
    onSuccess: (resultado) => {
      setError("");

      // El servidor se negó a escribir el DPI porque la ficha la abrió un
      // asesor y solo él puede completarla. Recargar aquí volvería a abrir este
      // mismo formulario —la puerta de `Profile.tsx` es `!user?.dpi`— sin un
      // solo texto que explique por qué: el bucle mudo. Se corta y se dice.
      if (registroQuedoSinDpi(resultado)) {
        setPendiente(mensajeDeDpiPendiente(user?.email ?? ""));
        return;
      }

      setPendiente("");
      onSuccess();
    },
    onError: (err: any) => {
      setError(err?.message || "Error al completar el perfil");
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Reintentar es inútil por construcción: el DPI de esa ficha solo lo puede
    // poner un humano del equipo, así que otro envío devolvería exactamente lo
    // mismo. Se corta aquí porque el `Button` compartido no tiene `disabled` y
    // no vale la pena ampliarle la API por este caso.
    if (pendiente) {
      return;
    }

    setError("");
    await completeMutation.mutateAsync();
  };

  return (
    <div className="bg-red-500/10 border-2 border-red-500/50 rounded-2xl p-8 max-w-2xl mx-auto">
      <div className="flex items-start gap-4 mb-6">
        <svg
          className="w-8 h-8 text-red-400 shrink-0 mt-1"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <div>
          <h2 className="text-xl font-bold text-red-400 mb-2">
            Información Requerida
          </h2>
          <p className="text-red-200/90">
            Para continuar usando la plataforma, necesitamos que completes la
            siguiente información importante.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Tipo de Usuario - solo si no tiene rol asignado */}
        {!hasRole && (
          <div>
            <label className="text-white font-medium mb-3 block">
              ¿Qué deseas hacer? *
            </label>
            <div className="flex flex-col lg:flex-row gap-4">
              <label
                className={`flex-1 flex items-center gap-3 p-4 border rounded-lg cursor-pointer transition-all ${
                  userType === "CLIENT"
                    ? "border-primary bg-primary/10"
                    : "border-white/20 hover:border-white/40"
                }`}
              >
                <input
                  type="radio"
                  name="userType"
                  value="CLIENT"
                  checked={userType === "CLIENT"}
                  onChange={() => setUserType("CLIENT")}
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
                  userType === "INVESTOR"
                    ? "border-primary bg-primary/10"
                    : "border-white/20 hover:border-white/40"
                }`}
              >
                <input
                  type="radio"
                  name="userType"
                  value="INVESTOR"
                  checked={userType === "INVESTOR"}
                  onChange={() => setUserType("INVESTOR")}
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
          </div>
        )}

        {/* DPI */}
        <div>
          <label className="text-white font-medium mb-2 block">
            DPI (13 dígitos) *
          </label>
          <InputIcon
            icon={<IconPerson />}
            placeholder="Ingresa tu DPI"
            value={dpi}
            onChange={(e) => {
              setDpi(e.target.value);
              setError("");
            }}
            type="text"
            name="dpi"
            maxLength={13}
            disabled={Boolean(pendiente)}
          />
        </div>

        {error && (
          <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4">
            <p className="text-red-300 text-sm">{error}</p>
          </div>
        )}

        {/* Ámbar y no rojo: no es un error de la persona ni hay nada que
            corregir en este formulario. La salida es hablar con nosotros. */}
        {pendiente && (
          <div className="bg-amber-500/15 border border-amber-500/50 rounded-lg p-4 space-y-4">
            <div>
              <p className="text-amber-200 font-semibold mb-1">
                Tu registro quedó guardado, pero falta un paso de nuestro lado
              </p>
              <p className="text-amber-100/90 text-sm">{pendiente}</p>
            </div>
            <Button
              type="button"
              size="lg"
              variant="whatsapp"
              onClick={() =>
                openWhatsApp(mensajeDeWhatsAppPorDpiPendiente(user?.email ?? ""))
              }
            >
              Escribirnos por WhatsApp
            </Button>
          </div>
        )}

        <div className="flex justify-end">
          <Button
            type="submit"
            isLoading={completeMutation.isPending}
            size="lg"
            className={
              !dpi || dpi.length !== 13 || pendiente
                ? "opacity-50 cursor-not-allowed"
                : ""
            }
          >
            {completeMutation.isPending
              ? "Guardando..."
              : "Guardar y Continuar"}
          </Button>
        </div>
      </form>
    </div>
  );
};
