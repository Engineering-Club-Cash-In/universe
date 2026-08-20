import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  AlertCircle,
  User,
  UserX,
  CheckCircle,
  Calendar,
  MapPin,
  Briefcase,
  TriangleAlert,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useStep2,
  type Document,
  type Field,
  type RenapData,
} from "../hooks/useStep2";

interface Step2Props {
  readonly data: {
    dpi?: string;
    renapData?: RenapData;
    documents?: Document[];
    fields?: Field[];
    manualGender?: "M" | "F";
  };
  readonly onChange: (
    field: string,
    value: string | RenapData | Document[] | Field[] | null
  ) => void;
}

// API Service

export function Step2({ data, onChange }: Step2Props) {
  const {
    handleSubmitDpi,
    dpiMutation,
    getGenderLabel,
    getCivilStatusLabel,
    setDpiInput,
    dpiInput,
    handleDpiChange,
    documents,
    fields,
    generoManual,
    setGeneroManual,
    renapUnavailable,
    handleContinueWithoutRenap,
  } = useStep2({ data, onChange });

  const resetConsulta = () => {
    onChange("dpi", "");
    onChange("renapData", null);
    onChange("manualGender", null);
    onChange("documents", []);
    onChange("fields", []);
    setDpiInput("");
    setGeneroManual("");
    dpiMutation.reset();
  };

  // Si ya hay datos de RENAP, mostrar la información
  if (data.renapData) {
    const { renapData } = data;
    const fullName =
      [renapData.firstName, renapData.secondName, renapData.thirdName]
        .filter(Boolean)
        .join(" ") +
      " " +
      [
        renapData.firstLastName,
        renapData.secondLastName,
        renapData.marriedLastName,
      ]
        .filter(Boolean)
        .join(" ");

    return (
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <CheckCircle className="h-12 w-12 mx-auto text-green-500" />
          <h2 className="text-2xl font-bold">Información Verificada</h2>
          <p className="text-muted-foreground">
            Los datos han sido obtenidos exitosamente del RENAP
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Información Personal */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Información Personal
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center space-x-4">
                <img
                  src={renapData.picture}
                  alt="Foto DPI"
                  className="w-20 h-20 rounded-lg object-cover border-2 border-muted"
                  onError={(e) => {
                    e.currentTarget.src = "/placeholder-avatar.png";
                  }}
                />
                <div>
                  <h3 className="font-semibold text-lg">{fullName}</h3>
                  <Badge variant="outline">DPI: {renapData.dpi}</Badge>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <Label className="text-muted-foreground">Género</Label>
                  <p className="font-medium">
                    {getGenderLabel(renapData.gender)}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Estado Civil</Label>
                  <p className="font-medium">
                    {getCivilStatusLabel(renapData.civil_status)}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Nacionalidad</Label>
                  <p className="font-medium">{renapData.nationality}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">
                    Fecha de Nacimiento
                  </Label>
                  <p className="font-medium">{renapData.birthDate}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Información Adicional */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                Información Adicional
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3 text-sm">
                <div>
                  <Label className="text-muted-foreground flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    Lugar de Nacimiento
                  </Label>
                  <p className="font-medium">
                    {renapData.municipality_borned_in},{" "}
                    {renapData.department_borned_in}
                  </p>
                </div>

                <div>
                  <Label className="text-muted-foreground flex items-center gap-1">
                    <Briefcase className="h-3 w-3" />
                    Ocupación
                  </Label>
                  <p className="font-medium">
                    {renapData.ocupation || "No especificada"}
                  </p>
                </div>

                <div>
                  <Label className="text-muted-foreground flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    Vencimiento DPI
                  </Label>
                  <p className="font-medium">{renapData.dpi_expiracy_date}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="bg-green-50 border border-green-200 p-4 rounded-lg">
          <div className="flex items-center space-x-2 mb-2">
            <CheckCircle className="h-5 w-5 text-green-600" />
            <h3 className="font-medium text-green-800">Datos Verificados</h3>
          </div>
          <p className="text-sm text-green-700">
            La información ha sido verificada exitosamente con el RENAP. Estos
            datos serán utilizados para generar los documentos legales.
          </p>
          {documents && documents.length > 0 && (
            <p className="text-sm text-green-700 mt-2">
              Se encontraron <strong>{documents.length}</strong> documentos
              disponibles con <strong>{fields?.length || 0}</strong> campos
              configurados.
            </p>
          )}
        </div>

        <div className="flex justify-center">
          <Button variant="outline" onClick={resetConsulta}>
            Consultar otro DPI
          </Button>
        </div>
      </div>
    );
  }

  // RENAP no tuvo el DPI: se siguio con el genero elegido a mano y los datos
  // del firmante se llenan en el paso siguiente.
  if (data.manualGender && documents && documents.length > 0) {
    return (
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <TriangleAlert className="h-12 w-12 mx-auto text-amber-500" />
          <h2 className="text-2xl font-bold">Sin datos de RENAP</h2>
          <p className="text-muted-foreground">
            Continuaste con el género seleccionado a mano
          </p>
        </div>

        <Card className="max-w-2xl mx-auto border-amber-300 bg-amber-50/70">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-amber-900">
              <UserX className="h-5 w-5 shrink-0" />
              Información del Firmante
              <Badge
                variant="outline"
                className="border-amber-400 bg-amber-100 text-amber-900"
              >
                Revisar
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <Label className="text-muted-foreground">DPI</Label>
                <p className="font-medium">{data.dpi}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Género</Label>
                <p className="font-medium">
                  {getGenderLabel(data.manualGender)}
                </p>
              </div>
            </div>

            <p className="text-sm text-amber-800">
              <strong>
                No se encontró este DPI en RENAP, así que no hay foto ni datos
                oficiales que mostrar.
              </strong>{" "}
              Nombre, edad, nacionalidad y estado civil no se pre-llenan: hay
              que escribirlos a mano en el siguiente paso y revisarlos antes de
              generar los documentos.
            </p>

            {documents.length > 0 && (
              <p className="text-sm text-amber-800">
                Se encontraron <strong>{documents.length}</strong> documentos
                disponibles con <strong>{fields?.length || 0}</strong> campos
                configurados.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-center">
          <Button variant="outline" onClick={resetConsulta}>
            Consultar otro DPI
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="max-w-md mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Consulta de DPI
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmitDpi} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="dpi">Número de DPI *</Label>
              <Input
                id="dpi"
                value={dpiInput}
                onChange={handleDpiChange}
                placeholder="1234567890123"
                maxLength={13}
                disabled={dpiMutation.isPending}
              />
              <p className="text-xs text-muted-foreground">
                Ingresa los 13 dígitos del DPI sin espacios ni guiones
              </p>
            </div>

            {dpiMutation.isError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {dpiMutation.error?.message ||
                    "Error al consultar el DPI. Verifica que sea correcto."}
                </AlertDescription>
              </Alert>
            )}

            {/* RENAP no encontro el DPI: pasa con DPI validos, asi que en vez
                de dejar el flujo muerto se pide el genero para continuar. */}
            {renapUnavailable && (
              <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50/70 p-4">
                <div className="flex items-start gap-2">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <p className="text-sm text-amber-800">
                    Podés continuar sin RENAP: indicá el género del firmante
                    para elegir la versión correcta de los documentos. Los demás
                    datos los vas a escribir a mano en el siguiente paso.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="genero-manual">Género del firmante *</Label>
                  <Select
                    value={generoManual}
                    onValueChange={(value) =>
                      setGeneroManual(value as "hombre" | "mujer")
                    }
                  >
                    <SelectTrigger id="genero-manual" className="w-full">
                      <SelectValue placeholder="Seleccioná el género" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hombre">Masculino</SelectItem>
                      <SelectItem value="mujer">Femenino</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  className="w-full border-amber-400 text-amber-900 hover:bg-amber-100"
                  disabled={!generoManual || dpiMutation.isPending}
                  onClick={handleContinueWithoutRenap}
                >
                  {dpiMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Cargando documentos...
                    </>
                  ) : (
                    "Continuar sin RENAP"
                  )}
                </Button>
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={dpiInput.length !== 13 || dpiMutation.isPending}
            >
              {dpiMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Consultando...
                </>
              ) : (
                "Consultar DPI"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="bg-muted/50 p-4 rounded-lg max-w-2xl mx-auto">
        <p className="text-sm text-muted-foreground">
          <strong>Información importante:</strong> Los datos se obtendrán del
          Registro Nacional de las Personas (RENAP) para garantizar la
          autenticidad de la información del firmante.
        </p>
      </div>
    </div>
  );
}
