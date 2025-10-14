import { useState, useEffect, useCallback } from "react";
import { type Document, type Field, type RenapData } from "./useStep2";

// Campos que no se deben mostrar en el formulario
const HIDDEN_FIELDS = ["firma", "firmacashin", "signature", "sign"];

interface UseStep3Props {
  documents: Document[];
  fields: Field[];
  renapData?: RenapData;
  initialFieldValues?: Record<string, string>;
  onChange: (field: string, value: Record<string, string>) => void;
  onValidationChange?: (isValid: boolean) => void;
  shouldValidate?: boolean;
}

export function useStep3({
  documents,
  fields,
  renapData,
  initialFieldValues = {},
  onChange,
  onValidationChange,
  shouldValidate = false,
}: UseStep3Props) {
  const [fieldValues, setFieldValues] =
    useState<Record<string, string>>(initialFieldValues);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [selectedDocuments, setSelectedDocuments] = useState<number[]>([]);
  const [hasSubmitted, setHasSubmitted] = useState(false);

  // Inicializar documentos seleccionados (todos por defecto)
  useEffect(() => {
    if (documents.length > 0 && selectedDocuments.length === 0) {
      setSelectedDocuments(documents.map((doc) => doc.id));
    }
  }, [documents, selectedDocuments.length]);

  const getCivilStatusLabel = useCallback((status: string, gender: string) => {
    const isFemale = gender === "F";
    const statusMap: Record<string, { male: string; female: string }> = {
      S: { male: "soltero", female: "soltera" },
      C: { male: "casado", female: "casada" },
      D: { male: "divorciado", female: "divorciada" },
      V: { male: "viudo", female: "viuda" },
      U: { male: "unido", female: "unida" },
    };
    const statusObj = statusMap[status];
    if (statusObj) {
      return isFemale ? statusObj.female : statusObj.male;
    }
    return "no especificado";
  }, []);

  const getNationalityLabel = useCallback(
    (nationality: string, gender: string) => {
      const isFemale = gender === "F";

      // Mapa de nacionalidades con sus gentilicios
      const nationalityMap: Record<string, { male: string; female: string }> = {
        guatemalteco: { male: "guatemalteco", female: "guatemalteca" },
        guatemala: { male: "guatemalteco", female: "guatemalteca" },
        mexicano: { male: "mexicano", female: "mexicana" },
        mexico: { male: "mexicano", female: "mexicana" },
        salvadoreño: { male: "salvadoreño", female: "salvadoreña" },
        "el salvador": { male: "salvadoreño", female: "salvadoreña" },
        hondureño: { male: "hondureño", female: "hondureña" },
        honduras: { male: "hondureño", female: "hondureña" },
        nicaragüense: { male: "nicaragüense", female: "nicaragüense" },
        nicaragua: { male: "nicaragüense", female: "nicaragüense" },
        costarricense: { male: "costarricense", female: "costarricense" },
        "costa rica": { male: "costarricense", female: "costarricense" },
        panameño: { male: "panameño", female: "panameña" },
        panama: { male: "panameño", female: "panameña" },
        estadounidense: { male: "estadounidense", female: "estadounidense" },
        "estados unidos": { male: "estadounidense", female: "estadounidense" },
        español: { male: "español", female: "española" },
        españa: { male: "español", female: "española" },
      };

      const normalizedNationality = nationality?.toLowerCase().trim() || "";
      const nationalityObj = nationalityMap[normalizedNationality];

      if (nationalityObj) {
        return isFemale ? nationalityObj.female : nationalityObj.male;
      }

      // Si no está en el mapa, devolver el valor original
      return nationality || "";
    },
    []
  );

  const calculateAge = useCallback((birthDate: string): number => {
    // Asumiendo formato DD/MM/YYYY
    const parts = birthDate.split("/");
    if (parts.length !== 3) return 0;

    const day = parseInt(parts[0]);
    const month = parseInt(parts[1]) - 1; // Los meses en JS son 0-11
    const year = parseInt(parts[2]);

    const birth = new Date(year, month, day);
    const today = new Date();

    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();

    // Si aún no ha cumplido años este año, restar 1
    if (
      monthDiff < 0 ||
      (monthDiff === 0 && today.getDate() < birth.getDate())
    ) {
      age--;
    }

    return age;
  }, []);

  // Validar un campo específico
  const validateField = useCallback((field: Field, value: string): string => {
    const strValue = typeof value === "string" ? value : String(value || "");

    // Validar campo requerido
    if (field.required && !strValue.trim()) {
      return "Este campo es obligatorio";
    }

    // Validar regex si hay valor y regex definida
    if (strValue.trim() && field.regex) {
      try {
        const regex = new RegExp(field.regex);
        if (!regex.test(strValue)) {
          return "El formato del campo no es válido";
        }
      } catch {
        console.warn(`Regex inválida para el campo ${field.key}:`, field.regex);
      }
    }

    return "";
  }, []);

  // Obtener campos únicos que pertenecen a documentos seleccionados
  const getRelevantFields = useCallback((): Field[] => {
    const filteredFields = fields.filter(
      (field) =>
        field.iddocuments.some((docId) =>
          selectedDocuments.includes(parseInt(docId))
        ) && !HIDDEN_FIELDS.includes(field.key?.toLowerCase())
    );

    // Ordenar por el campo relation (convertir a número para ordenar correctamente)
    return filteredFields.sort((a, b) => {
      const relationA = parseFloat(a.relation) || 0;
      const relationB = parseFloat(b.relation) || 0;
      return relationA - relationB;
    });
  }, [fields, selectedDocuments]);

  const validateInputOnType = useCallback(
    (regex: string, value: string): string => {
      if (!regex || !value) return value;

      try {
        // Remover los anchors ^ y $ para validación en tiempo real
        const cleanPattern = regex.replace(/^\^|\$$/g, "");

        // Extraer información del cuantificador y el tipo de carácter
        const quantifierMatch = cleanPattern.match(
          /^(.+?)\{(\d+)(?:,(\d+))?\}$/
        );

        if (quantifierMatch) {
          const [, charPattern, min, max] = quantifierMatch;
          const maxLength = parseInt(max || min); // Si no hay max, usar min como max

          // Construir conjunto de caracteres permitidos
          let allowedChars = "";

          if (charPattern.includes("\\d")) allowedChars += "0-9";
          if (charPattern.includes("\\w")) allowedChars += "a-zA-Z0-9_";
          if (charPattern.includes("\\s")) allowedChars += " \\t\\n\\r";

          // Manejar conjuntos de caracteres [...]
          const charSetMatch = charPattern.match(/\[([^\]]+)\]/);
          if (charSetMatch) {
            allowedChars += charSetMatch[1];
          }

          // Caracteres literales
          if (charPattern.includes("\\.")) allowedChars += ".";
          if (charPattern.includes("-") && !charPattern.includes("["))
            allowedChars += "-";
          if (charPattern.includes(",")) allowedChars += ",";

          if (allowedChars) {
            // Filtrar caracteres no permitidos
            const inverseRegex = new RegExp(`[^${allowedChars}]`, "g");
            const filtered = value.replace(inverseRegex, "");

            // Limitar a la longitud máxima
            return filtered.slice(0, maxLength);
          }
        }

        // Fallback: extraer caracteres permitidos sin límite estricto
        const charSetMatch = cleanPattern.match(/\[([^\]]+)\]/g);

        if (charSetMatch) {
          let allowedChars = "";
          charSetMatch.forEach((set) => {
            // eslint-disable-next-line
            allowedChars += set.replace(/[\[\]]/g, "");
          });

          if (cleanPattern.includes("\\d")) allowedChars += "0-9";
          if (cleanPattern.includes("\\s")) allowedChars += " \\s";
          if (cleanPattern.includes("(") && cleanPattern.includes(")"))
            allowedChars += "()";
          if (cleanPattern.includes("\\.")) allowedChars += ".";
          if (cleanPattern.includes(",")) allowedChars += ",";

          const inverseRegex = new RegExp(`[^${allowedChars}]`, "g");
          return value.replace(inverseRegex, "");
        }

        return value;
      } catch (error) {
        console.warn("Error procesando regex:", error);
        return value;
      }
    },
    []
  );

  // Validar todos los campos
  const validateAllFields = useCallback((): boolean => {
    const errors: Record<string, string> = {};
    let isValid = true;

    // Solo validar campos que pertenecen a documentos seleccionados
    const fieldsToValidate = getRelevantFields();

    console.log("🔍 Validando campos:", fieldsToValidate.length);

    fieldsToValidate.forEach((field) => {
      const value = fieldValues[field.key] || "";
      const error = validateField(field, value);

      console.log(`Campo ${field.key}:`, {
        value: value,
        required: field.required,
        error: error,
        isValid: !error,
      });

      if (error) {
        errors[field.key] = error;
        isValid = false;
      }
    });

    console.log("📊 Resultado validación:", {
      isValid,
      errorsCount: Object.keys(errors).length,
    });

    setFieldErrors(errors);
    return isValid;
  }, [fieldValues, getRelevantFields, validateField]);

  // Manejar cambio en un campo
  const handleFieldChange = useCallback(
    (fieldKey: string, inputValue: string) => {
      // Encontrar el campo para obtener su regex
      const field = fields.find((f) => f.key === fieldKey);

      // Aplicar validación en tiempo real si el campo tiene regex
      const processedValue =
        field && field.regex
          ? validateInputOnType(field.regex, inputValue)
          : inputValue;

      // Log para debug de validación en tiempo real
      if (field && field.regex && inputValue !== processedValue) {
        console.log(
          `⚡ Validación en tiempo real - Campo: ${field.key}, Regex: ${field.regex}, Input: "${inputValue}", Procesado: "${processedValue}"`
        );
      }

      const newFieldValues = {
        ...fieldValues,
        [fieldKey]: processedValue,
      };

      setFieldValues(newFieldValues);
      onChange("fieldValues", newFieldValues);

      // Solo validar si ya se ha intentado hacer submit o si shouldValidate es true
      if (hasSubmitted || shouldValidate) {
        if (field) {
          const error = validateField(field, processedValue);
          setFieldErrors((prev) => ({
            ...prev,
            [fieldKey]: error,
          }));
        }
      }
    },
    [
      fieldValues,
      onChange,
      hasSubmitted,
      shouldValidate,
      fields,
      validateField,
      validateInputOnType,
    ]
  );

  // Manejar submit (activar validación)
  const handleSubmit = useCallback(() => {
    setHasSubmitted(true);
    return validateAllFields();
  }, [validateAllFields]);

  // Activar validación cuando shouldValidate cambie
  useEffect(() => {
    if (shouldValidate && !hasSubmitted) {
      setHasSubmitted(true);
    }
  }, [shouldValidate, hasSubmitted]);

  // Pre-llenar algunos campos con datos del RENAP y valores por defecto
  useEffect(() => {
    if (fields.length > 0 && Object.keys(fieldValues).length === 0) {
      const initialValues: Record<string, string> = {};

      console.log(
        "📋 Campos recibidos:",
        fields.map((f) => ({
          key: f.key,
          name: f.name,
          regex: f.regex,
          required: f.required,
          description: f.description,
          default: f.default,
        }))
      );

      fields.forEach((field) => {
        // Primero intentar mapear con datos del RENAP
        if (renapData) {
          switch (field.key?.toLowerCase()) {
            case "nombrecompleto":
            case "nombre_completo":
            case "fullname":
              initialValues[field.key] =
                `${renapData.firstName} ${renapData.secondName} ${renapData.firstLastName} ${renapData.secondLastName}`.trim();
              return;
            case "dpi":
            case "cui":
              initialValues[field.key] = renapData.dpi;
              return;
            case "edad":
            case "age":
              initialValues[field.key] = String(
                calculateAge(renapData.birthDate)
              );
              return;
            case "ocupacion":
            case "occupation":
            case "profesion":
              initialValues[field.key] =
                renapData.ocupation?.toLowerCase() || "";
              return;
            case "nacionalidad":
            case "nationality":
            case "gentilicio":
              initialValues[field.key] = getNationalityLabel(
                renapData.nationality,
                renapData.gender
              );
              return;
            case "estadocivil":
            case "civil_status":
            case "marital_status":
              initialValues[field.key] = getCivilStatusLabel(
                renapData.civil_status,
                renapData.gender
              );
              return;
            default:
              break;
          }
        }

        // Si no se mapeó con RENAP, usar el valor por defecto del campo
        if (field.default && field.default.trim()) {
          initialValues[field.key] = field.default;
        } else {
          // Valor vacío por defecto
          initialValues[field.key] = "";
        }
      });

      if (Object.keys(initialValues).length > 0) {
        setFieldValues(initialValues);
        onChange("fieldValues", initialValues);
      }
    }
  }, [
    renapData,
    fields,
    fieldValues,
    onChange,
    getCivilStatusLabel,
    getNationalityLabel,
    calculateAge,
  ]);

  // Función para validar sin mostrar errores
  const validateWithoutErrors = useCallback((): boolean => {
    const relevantFields = getRelevantFields();
    let isValid = true;

    relevantFields.forEach((field) => {
      const value = fieldValues[field.key] || "";
      const error = validateField(field, value);
      if (error) {
        isValid = false;
      }
    });

    return isValid && relevantFields.length > 0;
  }, [fieldValues, getRelevantFields, validateField]);

  // Efecto para notificar cambios de validación al componente padre
  useEffect(() => {
    if (hasSubmitted || shouldValidate) {
      // Si ya se intentó hacer submit o se debe validar, usar validación completa
      const isValid = validateAllFields();
      console.log("🔍 Validación completa Step3:", { isValid });
      if (onValidationChange) {
        onValidationChange(isValid);
      }
    } else {
      // Antes del submit, validar pero no mostrar errores
      const isValid = validateWithoutErrors();
      console.log("🔍 Validación silenciosa Step3:", { isValid });
      if (onValidationChange) {
        onValidationChange(isValid);
      }
    }
  }, [
    fieldValues,
    selectedDocuments,
    hasSubmitted,
    shouldValidate,
    validateAllFields,
    validateWithoutErrors,
    onValidationChange,
  ]);

  // Efecto para validación inicial cuando se tienen campos y documentos
  useEffect(() => {
    if (documents.length > 0 && fields.length > 0) {
      // Ejecutar validación después de un pequeño delay para asegurar que todo esté inicializado
      const timer = setTimeout(() => {
        const isValid = validateWithoutErrors();
        console.log("🚀 Validación inicial Step3:", {
          documentsCount: documents.length,
          fieldsCount: fields.length,
          isValid,
        });
        if (onValidationChange) {
          onValidationChange(isValid);
        }
      }, 100);

      return () => clearTimeout(timer);
    }
  }, [
    documents.length,
    fields.length,
    validateWithoutErrors,
    onValidationChange,
  ]);

  return {
    fieldValues,
    fieldErrors,
    selectedDocuments,
    hasSubmitted,
    relevantFields: getRelevantFields(),
    handleFieldChange,
    handleSubmit,
    setSelectedDocuments,
  };
}
