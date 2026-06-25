import React from "react";
import { Button } from "@/components/ui/button";
import {
  Download,
  Upload,
  CheckCircle2,
  XCircle,
  Loader2,
  ArrowLeft,
  FileSpreadsheet,
} from "lucide-react";
import {
  descargarPlantillaInsolutos,
  validarInsolutosExcel,
  cargarInsolutos,
} from "../services/services";

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const downloadBase64Xlsx = (base64: string, filename: string) => {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  const blob = new Blob([arr], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

type Validacion = Awaited<ReturnType<typeof validarInsolutosExcel>>;
type Carga = Awaited<ReturnType<typeof cargarInsolutos>>;

export function BulkInsolutoUpload({ onFinish }: { onFinish?: () => void }) {
  const [step, setStep] = React.useState<1 | 2 | 3>(1);
  const [descargando, setDescargando] = React.useState(false);
  const [validando, setValidando] = React.useState(false);
  const [validacion, setValidacion] = React.useState<Validacion | null>(null);
  const [fileName, setFileName] = React.useState("");
  const [cargando, setCargando] = React.useState(false);
  const [carga, setCarga] = React.useState<Carga | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const validas = (validacion?.filas ?? []).filter((f) => f.valido);

  // Vacía el archivo cargado y la validación para subir un Excel limpio.
  const handleReset = () => {
    setValidacion(null);
    setFileName("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDescargar = async () => {
    setDescargando(true);
    try {
      const { archivoBase64, filename } = await descargarPlantillaInsolutos();
      downloadBase64Xlsx(archivoBase64, filename);
    } catch {
      alert("No se pudo descargar la plantilla.");
    } finally {
      setDescargando(false);
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setValidando(true);
    setValidacion(null);
    try {
      const base64 = await fileToBase64(file);
      const res = await validarInsolutosExcel(base64);
      setValidacion(res);
    } catch {
      setValidacion({ formatoOk: false, error: "No se pudo procesar el archivo." });
    } finally {
      setValidando(false);
    }
  };

  const handleCargar = async () => {
    setCargando(true);
    try {
      const res = await cargarInsolutos(validas);
      setCarga(res);
      setStep(3);
    } catch {
      alert("Error al cargar los créditos.");
    } finally {
      setCargando(false);
    }
  };

  const pasos = [
    { n: 1 as const, label: "Plantilla" },
    { n: 2 as const, label: "Subir y validar" },
    { n: 3 as const, label: "Confirmar" },
  ];

  return (
    <div className="flex flex-col">
      {/* Stepper */}
      <div className="mb-6 flex items-center justify-center gap-2 text-sm">
        {pasos.map((s, idx) => (
          <React.Fragment key={s.n}>
            <div
              className={`flex items-center gap-2 ${
                step >= s.n ? "font-semibold text-blue-700" : "text-gray-400"
              }`}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                  step >= s.n ? "bg-blue-600 text-white" : "bg-gray-200"
                }`}
              >
                {s.n}
              </span>
              {s.label}
            </div>
            {idx < pasos.length - 1 && <span className="text-gray-300">—</span>}
          </React.Fragment>
        ))}
      </div>

      {/* Paso 1: plantilla */}
      {step === 1 && (
        <div className="flex flex-col items-center gap-4 text-center">
          <FileSpreadsheet className="h-12 w-12 text-blue-600" />
          <p className="max-w-md text-gray-700">
            Descargá la plantilla, llenala con los créditos insolutos (uno por
            fila) y guardala. Columnas:{" "}
            <strong>cliente, nit, categoria, asesor, capital, plazo, observaciones</strong>.
          </p>
          <Button
            onClick={handleDescargar}
            disabled={descargando}
            className="gap-2 bg-green-600 font-bold text-white hover:bg-green-700"
          >
            {descargando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Descargar plantilla
          </Button>
          <Button
            variant="outline"
            onClick={() => setStep(2)}
            className="gap-2 border-blue-300 text-blue-700 hover:bg-blue-50"
          >
            Ya la llené, continuar →
          </Button>
        </div>
      )}

      {/* Paso 2: subir y validar */}
      {step === 2 && (
        <div className="flex flex-col gap-4">
          <label className="flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/50 p-8 hover:bg-blue-50">
            <Upload className="h-8 w-8 text-blue-600" />
            <span className="font-semibold text-blue-700">
              {fileName || "Seleccioná el Excel (.xlsx)"}
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleFile}
            />
          </label>

          {validando && (
            <div className="flex items-center justify-center gap-2 text-blue-700">
              <Loader2 className="h-5 w-5 animate-spin" /> Validando…
            </div>
          )}

          {validacion && !validacion.formatoOk && (
            <div className="flex flex-col gap-3">
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                <strong>Formato incorrecto:</strong> {validacion.error}
              </div>
              <Button
                variant="outline"
                onClick={handleReset}
                className="w-fit gap-2 border-blue-300 text-blue-700 hover:bg-blue-50"
              >
                <Upload className="h-4 w-4" /> Cargar otro archivo
              </Button>
            </div>
          )}

          {validacion?.formatoOk && validacion.filas && (
            <>
              <div className="text-sm text-gray-700">
                <strong className="text-green-700">{validacion.resumen?.validas}</strong>{" "}
                válidas ·{" "}
                <strong className="text-red-600">{validacion.resumen?.invalidas}</strong>{" "}
                con error · {validacion.resumen?.total} en total
              </div>
              <div className="max-h-80 overflow-auto rounded-lg border border-gray-200">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50">
                    <tr className="text-left text-gray-600">
                      <th className="p-2">#</th>
                      <th className="p-2">Cliente</th>
                      <th className="p-2">Categoría</th>
                      <th className="p-2">Asesor</th>
                      <th className="p-2 text-right">Capital</th>
                      <th className="p-2 text-right">Plazo</th>
                      <th className="p-2">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validacion.filas.map((f) => (
                      <tr
                        key={f.fila}
                        className={`border-t text-gray-800 ${
                          f.valido ? "" : "bg-red-50"
                        }`}
                      >
                        <td className="p-2">{f.fila}</td>
                        <td className="p-2">{f.cliente}</td>
                        <td className="p-2">{f.categoria}</td>
                        <td className="p-2">{f.asesor}</td>
                        <td className="p-2 text-right">
                          {f.capital.toLocaleString()}
                        </td>
                        <td className="p-2 text-right">{f.plazo}</td>
                        <td className="p-2">
                          {f.valido ? (
                            <span className="inline-flex items-center gap-1 text-green-700">
                              <CheckCircle2 className="h-4 w-4" /> OK
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-red-600">
                              <XCircle className="h-4 w-4" /> {f.error}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setStep(1)}
                    className="gap-1 border-blue-300 text-blue-700 hover:bg-blue-50"
                  >
                    <ArrowLeft className="h-4 w-4" /> Atrás
                  </Button>
                  {(validacion.resumen?.invalidas ?? 0) > 0 && (
                    <Button
                      variant="outline"
                      onClick={handleReset}
                      className="gap-2 border-blue-300 text-blue-700 hover:bg-blue-50"
                    >
                      <Upload className="h-4 w-4" /> Cargar otro archivo
                    </Button>
                  )}
                </div>
                <Button
                  onClick={handleCargar}
                  disabled={validas.length === 0 || cargando}
                  className="gap-2 bg-blue-600 font-bold text-white hover:bg-blue-700"
                >
                  {cargando && <Loader2 className="h-4 w-4 animate-spin" />}
                  Cargar {validas.length}{" "}
                  {validas.length === 1 ? "crédito" : "créditos"}
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Paso 3: resultado */}
      {step === 3 && carga && (
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-800">
            <strong>{carga.resumen.creados}</strong> creados ·{" "}
            <strong>{carga.resumen.fallidos}</strong> con error
          </div>
          <div className="max-h-80 overflow-auto rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50">
                <tr className="text-left text-gray-600">
                  <th className="p-2">#</th>
                  <th className="p-2">Cliente</th>
                  <th className="p-2">Resultado</th>
                </tr>
              </thead>
              <tbody>
                {carga.resultados.map((r) => (
                  <tr
                    key={r.fila}
                    className={`border-t text-gray-800 ${
                      r.success ? "" : "bg-red-50"
                    }`}
                  >
                    <td className="p-2">{r.fila}</td>
                    <td className="p-2">{r.cliente}</td>
                    <td className="p-2">
                      {r.success ? (
                        <span className="inline-flex items-center gap-1 text-green-700">
                          <CheckCircle2 className="h-4 w-4" /> {r.numero_credito_sifco}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-600">
                          <XCircle className="h-4 w-4" /> {r.error}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                handleReset();
                setCarga(null);
                setStep(1);
              }}
              className="border-blue-300 text-blue-700 hover:bg-blue-50"
            >
              Cargar otro lote
            </Button>
            <Button
              onClick={() => onFinish?.()}
              className="bg-blue-600 font-bold text-white hover:bg-blue-700"
            >
              Terminado
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
