import { useState, useEffect, useCallback, useMemo } from "react";
import { useDebounce } from "@uidotdev/usehooks";
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

  // Obtener el día actual en formato numérico (01-31)
  const getCurrentDay = useCallback((): string => {
    const today = new Date();
    return today.getDate().toString().padStart(2, "0");
  }, []);

  // Función reutilizable para convertir números (1-99) a texto en español
  const numberToText = useCallback((num: number): string => {
    if (num < 1 || num > 99) return num.toString();

    // Números del 0 al 30
    const basicNumbers: Record<number, string> = {
      0: "cero",
      1: "uno",
      2: "dos",
      3: "tres",
      4: "cuatro",
      5: "cinco",
      6: "seis",
      7: "siete",
      8: "ocho",
      9: "nueve",
      10: "diez",
      11: "once",
      12: "doce",
      13: "trece",
      14: "catorce",
      15: "quince",
      16: "dieciséis",
      17: "diecisiete",
      18: "dieciocho",
      19: "diecinueve",
      20: "veinte",
      21: "veintiuno",
      22: "veintidós",
      23: "veintitrés",
      24: "veinticuatro",
      25: "veinticinco",
      26: "veintiséis",
      27: "veintisiete",
      28: "veintiocho",
      29: "veintinueve",
      30: "treinta",
    };

    // Si está en el mapeo básico, retornarlo
    if (basicNumbers[num]) {
      return basicNumbers[num];
    }

    // Para números entre 31-99
    if (num > 30) {
      const tens = Math.floor(num / 10);
      const units = num % 10;

      const tensText: Record<number, string> = {
        3: "treinta",
        4: "cuarenta",
        5: "cincuenta",
        6: "sesenta",
        7: "setenta",
        8: "ochenta",
        9: "noventa",
      };

      const unitsText: Record<number, string> = {
        1: "uno",
        2: "dos",
        3: "tres",
        4: "cuatro",
        5: "cinco",
        6: "seis",
        7: "siete",
        8: "ocho",
        9: "nueve",
      };

      if (units === 0) {
        return tensText[tens] || num.toString();
      }

      return `${tensText[tens]} y ${unitsText[units]}`;
    }

    return num.toString();
  }, []);

  // Obtener el día actual en formato texto (uno, dos, tres, etc.)
  const getCurrentDayText = useCallback((): string => {
    const day = parseInt(getCurrentDay());
    return numberToText(day);
  }, [getCurrentDay, numberToText]);

  // Obtener el mes actual en formato texto (enero, febrero, etc.)
  const getCurrentMonthText = useCallback((): string => {
    const today = new Date();
    const months = [
      "enero",
      "febrero",
      "marzo",
      "abril",
      "mayo",
      "junio",
      "julio",
      "agosto",
      "septiembre",
      "octubre",
      "noviembre",
      "diciembre",
    ];
    return months[today.getMonth()];
  }, []);

  // Obtener el año actual en formato numérico - solo últimos 2 dígitos (25)
  const getCurrentYear = useCallback((): string => {
    const today = new Date();
    const fullYear = today.getFullYear().toString();
    return fullYear.slice(-2); // Obtener solo los últimos 2 dígitos
  }, []);

  // Obtener el año actual en formato texto - solo últimos 2 dígitos (veinticinco)
  const getCurrentYearText = useCallback((): string => {
    const today = new Date();
    const fullYear = today.getFullYear();
    const lastTwoDigits = fullYear % 100; // Obtener últimos 2 dígitos (ej: 2025 -> 25)

    return numberToText(lastTwoDigits);
  }, [numberToText]);

  // Obtener fecha completa en formato: "02 de junio de 2025"
  const getFormattedContractDate = useCallback((): string => {
    const day = numberToText(Number(getCurrentDay()));
    const month = getCurrentMonthText();
    const year = numberToText(Number(getCurrentYear()));
    return `${day} de ${month} de dos mil ${year}`;
  }, [getCurrentDay, getCurrentMonthText, getCurrentYear, numberToText]);

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
  // Cambiado a useMemo para mejor rendimiento - solo recalcula cuando cambian fields o selectedDocuments
  const relevantFields = useMemo((): Field[] => {
    const filteredFields = fields.filter(
      (field) =>
        field.iddocuments.some((docId) =>
          selectedDocuments.includes(docId)
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
            // Remover corchetes del principio y final (ej: "[abc]" -> "abc")
            allowedChars += set.slice(1, -1);
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
    const fieldsToValidate = relevantFields;

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
  }, [fieldValues, relevantFields, validateField]);

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
        const fieldKeyLower = field.key?.toLowerCase();

        // Primero intentar mapear con datos del RENAP
        if (renapData) {
          switch (fieldKeyLower) {
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
                numberToText(calculateAge(renapData.birthDate))
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

        // Mapear campos de fecha (disponibles siempre, con o sin renapData)
        switch (fieldKeyLower) {
          case "dia":
          case "day":
            initialValues[field.key] = getCurrentDay();
            return;
          case "diatexto":
          case "dia_texto":
          case "daytext":
          case "day_text":
            initialValues[field.key] = getCurrentDayText();
            return;
          case "mes":
          case "mestexto":
          case "mes_texto":
          case "month":
          case "monthtext":
          case "month_text":
            initialValues[field.key] = getCurrentMonthText();
            return;
          case "año":
          case "ano":
          case "year":
            initialValues[field.key] = getCurrentYear();
            return;
          case "añotexto":
          case "año_texto":
          case "anotexto":
          case "ano_texto":
          case "yeartext":
          case "year_text":
            initialValues[field.key] = getCurrentYearText();
            return;
          case "fechainicio":
          case "fecha_inicio":
          case "fechainiciocontrato":
          case "fecha_inicio_contrato":
          case "contractstartdate":
          case "contract_start_date":
          case "startdate":
          case "start_date":
            initialValues[field.key] = getFormattedContractDate();
            return;
          default:
            break;
        }

        // Si no se mapeó con ninguno de los anteriores, usar el valor por defecto del campo
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
    getCurrentDay,
    getCurrentDayText,
    getCurrentMonthText,
    getCurrentYear,
    getCurrentYearText,
    getFormattedContractDate,
    numberToText,
  ]);

  // Función para validar sin mostrar errores
  const validateWithoutErrors = useCallback((): boolean => {
    let isValid = true;

    relevantFields.forEach((field) => {
      const value = fieldValues[field.key] || "";
      const error = validateField(field, value);
      if (error) {
        isValid = false;
      }
    });

    return isValid && relevantFields.length > 0;
  }, [fieldValues, relevantFields, validateField]);

  // Debounced validation - espera 300ms después del último cambio antes de validar
  const debouncedFieldValues = useDebounce(fieldValues, 300);

  // Efecto para notificar cambios de validación al componente padre (con debouncing)
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
    debouncedFieldValues, // Usar valores debounced en lugar de fieldValues directos
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

  // Función para auto-llenar campos con datos fake (DEV MODE)
  const autoFillWithFakeData = useCallback(() => {
    const fakeValues: Record<string, string> = {};

    relevantFields.forEach((field) => {
      const fieldKeyLower = field.key?.toLowerCase();

      // Datos fake específicos por campo - valores fijos que cumplen con regex
      const specificFakes: Record<string, string> = {
        // Fechas - números y texto
        dia: '20',
        diatexto: 'veinte',
        dia_texto: 'veinte',
        mestexto: 'octubre',
        mes_texto: 'octubre',
        ano: '25',
        año: '25',
        añotexto: 'veinticinco',
        anotexto: 'veinticinco',
        ano_texto: 'veinticinco',
        año_texto: 'veinticinco',
        fechainicio: 'veinte de octubre de dos mil veinticinco',
        fecha_inicio: 'veinte de octubre de dos mil veinticinco',
        fechainiciocontrato: 'veinte de octubre de dos mil veinticinco',

        // Fechas vencimiento
        diatextovencimiento: 'quince',
        dia_texto_vencimiento: 'quince',
        diavencimientotexto: 'quince',
        mestextovencimiento: 'enero',
        mes_texto_vencimiento: 'enero',
        mesvencimientotexto: 'enero',
        anotextovencimiento: 'veintiséis',
        ano_texto_vencimiento: 'veintiséis',
        anovencimientotexto: 'veintiséis',
        diavencimiento: '15',
        mesvencimiento: '01',
        anovencimiento: '26',
        diapago: 'día quince',
        diapagotexto: 'día quince',

        // Nombres y personas
        nombrecompleto: 'JUAN CARLOS PEREZ LOPEZ',
        nombre_completo: 'JUAN CARLOS PEREZ LOPEZ',
        fullname: 'JUAN CARLOS PEREZ LOPEZ',
        nombrevendedor: 'MARIA RODRIGUEZ GARCIA',
        nombre_vendedor: 'MARIA RODRIGUEZ GARCIA',
        nombreandres: 'ANDRES LOPEZ MARTINEZ',
        nombre_andres: 'ANDRES LOPEZ MARTINEZ',

        // Documentos
        dpi: '2584756981234',
        cui: '2584756981234',
        dpiandres: 'dos mil quinientos ochenta y cuatro millones setecientos cincuenta y seis mil novecientos ochenta y uno mil doscientos treinta y cuatro',
        dpi_andres: 'dos mil quinientos ochenta y cuatro millones setecientos cincuenta y seis mil novecientos ochenta y uno mil doscientos treinta y cuatro',
        dpitexto: 'dos mil quinientos ochenta y cuatro millones setecientos cincuenta y seis mil novecientos ochenta y uno mil doscientos treinta y cuatro (2584756981234)',
        dpi_texto: 'dos mil quinientos ochenta y cuatro millones setecientos cincuenta y seis mil novecientos ochenta y uno mil doscientos treinta y cuatro (2584756981234)',
        dpitextovendedor: 'dos mil quinientos ochenta y cuatro millones setecientos cincuenta y seis mil novecientos ochenta y uno mil doscientos treinta y cuatro (2584756981234)',
        dpi_texto_vendedor: 'dos mil quinientos ochenta y cuatro millones setecientos cincuenta y seis mil novecientos ochenta y uno mil doscientos treinta y cuatro (2584756981234)',
        dpivendedor: '2584756981234',
        dpi_vendedor: '2584756981234',

        // Ubicación
        direccion: 'ZONA 10, 5TA AVENIDA 12-45',
        ciudad: 'guatemala',
        municipio: 'guatemala',
        departamento: 'guatemala',

        // Vehículos - todo en mayúsculas
        marca: 'TOYOTA',
        marcavehiculo: 'TOYOTA',
        marca_vehiculo: 'TOYOTA',
        vehicle_brand: 'TOYOTA',
        linea: 'COROLLA',
        lineavehiculo: 'COROLLA',
        linea_vehiculo: 'COROLLA',
        vehicle_line: 'COROLLA',
        modelo: '2024',
        modelovehiculo: '2024',
        modelo_vehiculo: '2024',
        vehicle_model: '2024',
        year: '2024',
        placa: 'P123ABC',
        placavehiculo: 'P123ABC',
        placa_vehiculo: 'P123ABC',
        vehicle_plate: 'P123ABC',
        plate: 'P123ABC',
        color: 'BLANCO',
        colorvehiculo: 'BLANCO',
        color_vehiculo: 'BLANCO',
        vehicle_color: 'BLANCO',
        chasis: 'JT2AE92E5G0012345',
        chasisvehiculo: 'JT2AE92E5G0012345',
        chasis_vehiculo: 'JT2AE92E5G0012345',
        vehicle_chasis: 'JT2AE92E5G0012345',
        vin: 'JT2AE92E5G0012345',
        motor: 'Z1234567890',
        motorvehiculo: 'Z1234567890',
        motor_vehiculo: 'Z1234567890',
        vehicle_motor: 'Z1234567890',
        tipo: 'SEDAN',
        tipovehiculo: 'SEDAN',
        tipo_vehiculo: 'SEDAN',
        vehicle_type: 'SEDAN',
        uso: 'PARTICULAR',
        usovehiculo: 'PARTICULAR',
        uso_vehiculo: 'PARTICULAR',
        combustible: 'GASOLINA',
        combustiblevehiculo: 'GASOLINA',
        combustible_vehiculo: 'GASOLINA',
        serie: 'ABC123456',
        serievehiculo: 'ABC123456',
        serie_vehiculo: 'ABC123456',
        cm3: '1800',
        cm3vehiculo: '1800',
        cm3_vehiculo: '1800',
        asientos: '5',
        asientosvehiculo: '5',
        asientos_vehiculo: '5',
        cilindros: '4',
        cilindrosvehiculo: '4',
        cilindros_vehiculo: '4',
        iscv: '12345',
        iscvvehiculo: '12345',
        iscv_vehiculo: '12345',

        // Contacto
        telefono: '55551234',
        phone: '55551234',
        celular: '41234567',
        cellphone: '41234567',
        email: 'juan.perez@example.com',
        correo: 'juan.perez@example.com',

        // Financiero - con formato de texto
        monto: 'CIENTO CINCUENTA MIL QUETZALES (Q150,000.00)',
        montotexto: 'CIENTO CINCUENTA MIL QUETZALES (Q150,000.00)',
        monto_texto: 'CIENTO CINCUENTA MIL QUETZALES (Q150,000.00)',
        amount: 'CIENTO CINCUENTA MIL QUETZALES (Q150,000.00)',
        precio: 'CIENTO CINCUENTA MIL QUETZALES (Q150,000.00)',
        price: 'CIENTO CINCUENTA MIL QUETZALES (Q150,000.00)',
        cuota: 'CINCO MIL QUETZALES (Q5,000.00)',
        cuotamensual: 'CINCO MIL QUETZALES (Q5,000.00)',
        cuota_mensual: 'CINCO MIL QUETZALES (Q5,000.00)',
        payment: 'CINCO MIL QUETZALES (Q5,000.00)',
        plazo: 'TREINTA MESES (30)',
        plazotexto: 'TREINTA MESES (30)',
        plazo_texto: 'TREINTA MESES (30)',
        totalapagar: '150000',
        total_apagar: '150000',
        cantidadcuotas: '30',
        cantidad_cuotas: '30',
        cantidadcuotastexto: 'treinta',
        cantidad_cuotas_texto: 'treinta',

        // Otros datos en letras
        ocupacion: 'comerciante',
        occupation: 'comerciante',
        profesion: 'comerciante',
        edad: 'treinta y cinco',
        age: 'treinta y cinco',
        edadandres: 'cuarenta',
        edad_andres: 'cuarenta',
        edadrichard: 'treinta y dos',
        edad_richard: 'treinta y dos',
        nacionalidad: 'guatemalteco',
        nationality: 'guatemalteco',
        estadocivil: 'casado',
        civil_status: 'casado',

        // Empresa y entidades
        empresa: 'CASH IN S.A.',
        entidad: 'Banco Industrial',
        tipoentidad: 'Banco',
        tipo_entidad: 'Banco',

        // Financiero - montos con formato texto y número
        capitaladeudado: 'CIENTO CINCUENTA MIL QUETZALES (Q150,000.00)',
        capital_adeudado: 'CIENTO CINCUENTA MIL QUETZALES (Q150,000.00)',
        mesesprestamo: 'TREINTA MESES (30)',
        meses_prestamo: 'TREINTA MESES (30)',
        cuotasmensuales: 'CINCO MIL QUETZALES (Q5,000.00)',
        cuotas_mensuales: 'CINCO MIL QUETZALES (Q5,000.00)',
        porcentajedeudanumero: '15',
        porcentaje_deuda_numero: '15',
        porcentajemoranumero: '20',
        porcentaje_mora_numero: '20',
        cantidad: '150,000',
        valor: '75,000',
        valor2: '75,000',
        plazo: '30',
        plazo_texto: 'treinta',

        // Inversionista y cuentas
        inversionista: 'Juan Perez Lopez',
        nombrebeneficiario: 'Maria Rodriguez',
        nombre_beneficiario: 'Maria Rodriguez',
        cuenta: '1234567890',
        cuenta2: '0987654321',
        montocuenta: '75000',
        monto_cuenta: '75000',
        montocuenta2: '75000',
        monto_cuenta2: '75000',
      };

      // Intentar usar valor específico
      if (specificFakes[fieldKeyLower]) {
        fakeValues[field.key] = specificFakes[fieldKeyLower];
        return;
      }

      // Fallback: valor genérico basado en descripción o nombre del campo
      if (fieldKeyLower.includes('nombre')) {
        fakeValues[field.key] = 'JUAN PEREZ LOPEZ';
      } else if (fieldKeyLower.includes('direccion') || fieldKeyLower.includes('address')) {
        fakeValues[field.key] = 'ZONA 10, 5TA AVENIDA 12-45';
      } else if (fieldKeyLower.includes('monto') || fieldKeyLower.includes('precio') || fieldKeyLower.includes('amount')) {
        fakeValues[field.key] = 'CIEN MIL QUETZALES (Q100,000.00)';
      } else if (fieldKeyLower.includes('fecha') || fieldKeyLower.includes('date')) {
        fakeValues[field.key] = 'veinte de octubre de dos mil veinticinco';
      } else if (fieldKeyLower.includes('dpi') || fieldKeyLower.includes('cui')) {
        fakeValues[field.key] = '2584756981234';
      } else {
        // Fallback final: texto genérico en minúsculas
        fakeValues[field.key] = 'valor de prueba';
      }
    });

    setFieldValues(fakeValues);
    onChange("fieldValues", fakeValues);
    console.log('🎲 Campos auto-llenados con datos fake:', fakeValues);
  }, [relevantFields, onChange]);

  return {
    fieldValues,
    fieldErrors,
    selectedDocuments,
    hasSubmitted,
    relevantFields, // Ya no es una función, es el valor memoizado
    handleFieldChange,
    handleSubmit,
    setSelectedDocuments,
    numberToText, // Función utilitaria para convertir números a texto
    autoFillWithFakeData, // Nueva función para dev mode
  };
}
