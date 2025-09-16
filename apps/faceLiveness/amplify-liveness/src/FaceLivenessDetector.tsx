import { useEffect, useState } from "react";
import { FaceLivenessDetector } from "@aws-amplify/ui-react-liveness";
import { Loader, ThemeProvider, View, Heading, Text } from "@aws-amplify/ui-react";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

export function LivenessWithRenapValidation({ dpi }: { dpi: string }) {
  const [loading, setLoading] = useState(true);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
      setErrorMessage(validation.message || "El link ya no es válido");
      setLoading(false);
      return;
    }

    // Si es válido, crear sesión
    const res = await fetch(`${API_BASE}/info/liveness-session`);
    const data = await res.json();
    if (data.success) {
      setSessionId(data.sessionId);
    } else {
      setErrorMessage("Error creando sesión de liveness");
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

        // Mostrar pantalla de éxito
        setErrorMessage("✅ Validación exitosa, tu identidad ha sido confirmada.");
      } else {
        console.log("❌ No coincide con RENAP:", data);
        setErrorMessage("❌ No pudimos validar tu identidad, revisa tu DPI o inténtalo más tarde.");
      }
    } catch (err) {
      console.error("Error validando liveness con RENAP:", err);
      setErrorMessage("⚠️ Ocurrió un error inesperado durante la validación.");
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleError = async (error: any) => {
    console.error("Liveness error:", error);
    setLoading(true);
    await fetchCreateLiveness(); // retry con nueva sesión
  };

  return (
    <ThemeProvider>
      {loading ? (
        <Loader />
      ) : errorMessage ? (
        <View
          height="100vh"
          display="flex"
          style={{
            alignItems: "center",
            justifyContent: "center"
          }}
          backgroundColor="#f8f9fa"
          padding="2rem"
        >
          <Heading level={3} color="#d32f2f" marginBottom="1rem">
            🚫 Validación de identidad
          </Heading>
          <Text fontSize="1.2rem">{errorMessage}</Text>
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
