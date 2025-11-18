import { Routes, Route, useParams } from "react-router-dom";
import { LivenessWithRenapValidation } from "./FaceLivenessDetector";

function LivenessWrapper() {
  const { dpi } = useParams<{ dpi: string }>();
  if (!dpi) return <div>⚠️ No se encontró el DPI en la ruta</div>;
  return <LivenessWithRenapValidation dpi={dpi} />;
}

function NotFound() {
  return (
    <div style={{ textAlign: "center", marginTop: "2rem" }}>
      <h2>🚫 No encontramos la ruta</h2>
    </div>
  );
}

export default function App() {
  return (
    <div>
      <h1>Demo Face Liveness</h1>
      <Routes>
        <Route path="/liveness/:dpi" element={<LivenessWrapper />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </div>
  );
}
