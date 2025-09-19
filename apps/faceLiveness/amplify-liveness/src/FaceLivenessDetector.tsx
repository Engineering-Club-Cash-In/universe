/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { FaceLivenessDetector } from "@aws-amplify/ui-react-liveness";
import { Loader, ThemeProvider, View, Heading, Text, Button, Link } from "@aws-amplify/ui-react";

const API_BASE = import.meta.env.VITE_API_BASE_URL;
const WA_SIMPLETECH = import.meta.env.VITE_WA_SIMPLETECH || "50212345678"; // Default number or get from environment variable

export function LivenessWithRenapValidation({ dpi }: { dpi: string }) {
  const [loading, setLoading] = useState(true);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [validated, setValidated] = useState(false);

  // 0. Validar magic URL antes de crear sesión
  const validateMagicUrl = async () => {
    const res = await fetch(`${API_BASE}/info/validate-magic-url?userDpi=${dpi}`);
    const data = await res.json();
    return data; // { success: boolean, message: string }
  };

  // 1. Crear sesión de liveness si el link es válido
const fetchCreateLiveness = async () => {
  const validation = await validateMagicUrl();

  if (!validation.success) {
    console.error("❌ Magic URL inválido:", validation.message);
    setErrorMessage("🚫 Link no válido o expirado. Solicita uno nuevo.");
    setLoading(false);
    return;
  }

  const res = await fetch(`${API_BASE}/info/liveness-session`);
  const data = await res.json();
  if (data.success) {
    setSessionId(data.sessionId);
  } else {
    console.error("❌ Error creando sesión de liveness:", data.message);
    setErrorMessage("⚠️ No se pudo iniciar la validación. Intenta nuevamente más tarde.");
  }
  setLoading(false);
};

  useEffect(() => {
    fetchCreateLiveness();
  }, []);

  // 2. Al terminar validación → llamar backend
  const handleAnalysisComplete = async () => {
    try {
      const res = await fetch(
        `${API_BASE}/info/validate-liveness?sessionId=${sessionId}&userDpi=${dpi}`
      );
      const data = await res.json();

      if (data.success && data.isMatch) {
        console.log("✅ Usuario validado con RENAP:", data);
        setValidated(true);
      } else {
        console.log("❌ No coincide con RENAP:", data);
        setErrorMessage("❌ No pudimos validar tu identidad, revisa tu DPI o inténtalo más tarde.");
      }
    } catch (err) {
      console.error("Error validando liveness con RENAP:", err);
      setErrorMessage("⚠️ Ocurrió un error inesperado durante la validación.");
    }
  };

  const handleError = async (error: any) => {
    console.error("Liveness error:", error);
    setLoading(true);
    await fetchCreateLiveness(); // retry con nueva sesión
  };

  // 📌 URL de WhatsApp (ejemplo Guatemala +502 con DPI en el mensaje)
const message = encodeURIComponent(`Hola, ya terminé mi validación de vida con el DPI ${dpi}`);
const whatsappUrl = `https://wa.me/${WA_SIMPLETECH}?text=${message}`;

  return (
    <ThemeProvider>
      {loading ? (
        <Loader />
      ) : errorMessage ? (
        <View
          height="100vh"
          display="flex"
          style={{ alignItems: "center", justifyContent: "center" }}
          backgroundColor="#f8f9fa"
          padding="2rem"
        >
          <Heading level={3} color="#d32f2f" marginBottom="1rem">
            🚫 Validación de identidad
          </Heading>
          <Text fontSize="1.2rem">{errorMessage}</Text>
        </View>
      ) : validated ? (
        <View
          height="100vh"
          display="flex"
          style={{ alignItems: "center", justifyContent: "center", flexDirection: "column" }}
          backgroundColor="#e8f5e9"
          padding="2rem"
        >
          <Heading level={3} color="#2e7d32" marginBottom="1rem">
            ✅ Validación exitosa
          </Heading>
          <Text fontSize="1.2rem" marginBottom="1.5rem">
            Tu identidad ha sido confirmada correctamente.
          </Text>
          <Link href={whatsappUrl} isExternal>
            <Button variation="primary" colorTheme="success">
              Ir a WhatsApp
            </Button>
          </Link>
        </View>
      ) : (
        sessionId && (
          <FaceLivenessDetector
            sessionId={sessionId}
            region="us-east-1"
            onAnalysisComplete={handleAnalysisComplete}
            onError={handleError}
          />
        )
      )}
    </ThemeProvider>
  );
}
