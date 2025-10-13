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

  const getCivilStatusLabel = (status: string) => {
    const statusMap: Record<string, string> = {
      S: "Soltero",
      C: "Casado",
      D: "Divorciado",
      V: "Viudo",
      U: "Unido",
    };
    return statusMap[status] || "No especificado";
  };

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
    return fields.filter(
      (field) =>
        field.iddocuments.some((docId) =>
          selectedDocuments.includes(parseInt(docId))
        ) && !HIDDEN_FIELDS.includes(field.key.toLowerCase())
    );
  }, [fields, selectedDocuments]);

  // Validar todos los campos
  const validateAllFields = useCallback((): boolean => {
    const errors: Record<string, string> = {};
    let isValid = true;

    // Solo validar campos que pertenecen a documentos seleccionados
    const fieldsToValidate = getRelevantFields();

    console.log('🔍 Validando campos:', fieldsToValidate.length);
    
    fieldsToValidate.forEach((field) => {
      const value = fieldValues[field.key] || "";
      const error = validateField(field, value);
      
      console.log(`Campo ${field.key}:`, {
        value: value,
        required: field.required,
        error: error,
        isValid: !error
      });
      
      if (error) {
        errors[field.key] = error;
        isValid = false;
      }
    });

    console.log('📊 Resultado validación:', { isValid, errorsCount: Object.keys(errors).length });
    
    setFieldErrors(errors);
    return isValid;
  }, [fieldValues, getRelevantFields, validateField]);

  // Manejar cambio en un campo
  const handleFieldChange = useCallback(
    (fieldKey: string, value: string) => {
      const newFieldValues = {
        ...fieldValues,
        [fieldKey]: value,
      };

      setFieldValues(newFieldValues);
      onChange("fieldValues", newFieldValues);

      // Solo validar si ya se ha intentado hacer submit o si shouldValidate es true
      if (hasSubmitted || shouldValidate) {
        const field = fields.find((f) => f.key === fieldKey);
        if (field) {
          const error = validateField(field, value);
          setFieldErrors((prev) => ({
            ...prev,
            [fieldKey]: error,
          }));
        }
      }
    },
    [fieldValues, onChange, hasSubmitted, shouldValidate, fields, validateField]
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

  // Pre-llenar algunos campos con datos del RENAP
  useEffect(() => {
    if (renapData && Object.keys(fieldValues).length === 0) {
      const initialValues: Record<string, string> = {};

      // Mapear campos comunes
      fields.forEach((field) => {
        switch (field.key.toLowerCase()) {
          case "nombrecompleto":
          case "nombre_completo":
          case "fullname":
            initialValues[field.key] =
              `${renapData.firstName} ${renapData.secondName} ${renapData.firstLastName} ${renapData.secondLastName}`.trim();
            break;
          case "dpi":
          case "cui":
            initialValues[field.key] = renapData.dpi;
            break;
          case "edad":
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            initialValues[field.key] = new Date().getFullYear() - renapData.birthDate.split("/")[2];
            break;
          case "ocupacion":
          case "occupation":
          case "profesion":
            initialValues[field.key] = renapData.ocupation || "";
            break;
          case "nacionalidad":
          case "nationality":
            initialValues[field.key] = renapData.nationality;
            break;
          case "estadocivil":
            initialValues[field.key] = getCivilStatusLabel(
              renapData.civil_status
            );
            break;
        }
      });

      if (Object.keys(initialValues).length > 0) {
        setFieldValues(initialValues);
        onChange("fieldValues", initialValues);
      }
    }
  }, [renapData, fields, fieldValues, onChange]);

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
      console.log('🔍 Validación completa Step3:', { isValid });
      if (onValidationChange) {
        onValidationChange(isValid);
      }
    } else {
      // Antes del submit, validar pero no mostrar errores
      const isValid = validateWithoutErrors();
      console.log('🔍 Validación silenciosa Step3:', { isValid });
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
        console.log('🚀 Validación inicial Step3:', { 
          documentsCount: documents.length,
          fieldsCount: fields.length,
          isValid 
        });
        if (onValidationChange) {
          onValidationChange(isValid);
        }
      }, 100);

      return () => clearTimeout(timer);
    }
  }, [documents.length, fields.length, validateWithoutErrors, onValidationChange]);

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
