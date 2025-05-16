import { useState, useRef, useEffect } from "react";
import {
  Send,
  Mic,
  ImageIcon,
  ChevronLeft,
  MoreVertical,
  Phone,
  Video,
  ThumbsUp,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  createLead,
  createCreditScore,
  createCreditProfile,
  type FillLeadBody,
  type CreateCreditProfileBody,
} from "@/services/simpletech";
import CCIAvatar from "../../../../assets/chat/avatar.svg";

type MessageType = "text" | "image" | "survey";

interface SurveyOption {
  id: string;
  text: string;
}

interface SurveyData {
  question: string;
  options: SurveyOption[];
  subtitle?: string;
  link?: {
    text: string;
    url: string;
  };
}

interface Message {
  id: string;
  content: string;
  type: MessageType;
  sender: "user" | "contact" | "system";
  timestamp: Date;
  read: boolean;
  imageUrl?: string;
  survey?: SurveyData;
  quotedMessage?: {
    sender: string;
    content: string;
  };
}

interface WhatsAppChatProps {
  contactName: string;
  contactSubtitle?: string;
  contactAvatar?: string;
  initialMessages?: Message[];
}

export default function WhatsAppChat({
  contactName,
  contactSubtitle = "online",
  contactAvatar = CCIAvatar,
  initialMessages = [],
}: WhatsAppChatProps) {
  const [messages, setMessages] = useState<Message[]>(
    initialMessages.length > 0
      ? initialMessages
      : [
          {
            id: "1",
            content:
              "Messages to this chat and calls are now secured with end-to-end encryption. Tap for more info.",
            type: "text",
            sender: "system",
            timestamp: new Date(new Date().setHours(new Date().getHours() - 1)),
            read: true,
          } as Message,
        ]
  );

  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // New state variables for chatbot flow
  const [leadId, setLeadId] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<string>("awaiting_greeting");
  const [userData, setUserData] = useState<
    Partial<FillLeadBody> & { phone?: string }
  >({});
  const [dataCollectionStage, setDataCollectionStage] = useState<
    keyof FillLeadBody | "phoneNumber" | null
  >(null);
  const [selectedSurvey, setSelectedSurvey] = useState<string | null>(null);
  const [documentUploadStep, setDocumentUploadStep] = useState<number>(0);
  const [uploadedDocumentUrls, setUploadedDocumentUrls] = useState<string[]>(
    []
  );

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const addBotMessageWithDelay = (content: string, delayMs: number = 500) => {
    setTimeout(() => {
      const botMessage: Message = {
        id: Date.now().toString(),
        content,
        type: "text",
        sender: "contact",
        timestamp: new Date(),
        read: true,
      };
      setMessages((prev) => [...prev, botMessage]);
    }, delayMs);
  };

  const dataCollectionFields: (keyof FillLeadBody)[] = [
    "name",
    "age",
    "civilStatus",
    "documentNumber",
    "economicDependents",
    "monthlyIncome",
    "amountToFinance",
    "ocupation",
    "timeEmployed",
    "hasCreditCard",
    "hasVehicle",
    "moneyPurpose",
    "ownsHouse",
  ];

  const getNextDataCollectionStage = (
    currentField: keyof FillLeadBody | null
  ): keyof FillLeadBody | null => {
    if (!currentField) return dataCollectionFields[0];
    const currentIndex = dataCollectionFields.indexOf(currentField);
    if (
      currentIndex === -1 ||
      currentIndex === dataCollectionFields.length - 1
    ) {
      return null; // All data collected
    }
    return dataCollectionFields[currentIndex + 1];
  };

  const translateFieldNameForPrompt = (
    fieldName: keyof FillLeadBody,
    type: "question" | "prompt" = "prompt"
  ): string => {
    const translations: Record<
      keyof FillLeadBody,
      { question: string; prompt_options?: string }
    > = {
      name: { question: "nombre completo" },
      age: { question: "edad" },
      civilStatus: {
        question: "Estado civil",
        prompt_options: "(SOLTERO, CASADO, DIVORCIADO, VIUDO)",
      },
      documentNumber: { question: "Número de documento" },
      economicDependents: { question: "Número de dependientes económicos" },
      monthlyIncome: { question: "Ingreso mensual" },
      amountToFinance: { question: "Monto a financiar" },
      ocupation: { question: "Ocupación", prompt_options: "(DUEÑO, EMPLEADO)" },
      timeEmployed: {
        question: "Tiempo empleado",
        prompt_options: "(1A5, 5A10, MAS10 años)",
      },
      hasCreditCard: { question: "¿Tiene tarjeta de crédito?" },
      hasVehicle: { question: "¿Tiene vehículo propio?" },
      moneyPurpose: {
        question: "Propósito del dinero",
        prompt_options: "(PERSONAL, NEGOCIO)",
      },
      ownsHouse: { question: "¿Es dueño de casa propia?" },
      ownsVehicle: { question: "¿Es dueño de vehículo propio? (Backend Req)" },
      leadId: { question: "" },
    };
    const fieldTranslation = translations[fieldName];
    if (!fieldTranslation) return fieldName;

    if (type === "question") return fieldTranslation.question;
    return fieldTranslation.prompt_options
      ? `${fieldTranslation.question} ${fieldTranslation.prompt_options}`
      : fieldTranslation.question;
  };

  const mapSurveyResponseToApiValue = (
    fieldName: keyof FillLeadBody,
    spanishValue: string
  ): string => {
    switch (fieldName) {
      case "civilStatus":
        return (
          {
            // Map Spanish display/ID to English API value
            SOLTERO: "SINGLE",
            CASADO: "MARRIED",
            DIVORCIADO: "DIVORCED",
            VIUDO: "WIDOWER",
          }[spanishValue.toUpperCase()] || spanishValue
        ); // Fallback to original if no map (should not happen for valid options)
      case "ocupation":
        return (
          {
            DUEÑO: "OWNER",
            EMPLEADO: "EMPLOYEE",
          }[spanishValue.toUpperCase()] || spanishValue
        );
      case "timeEmployed": // Assuming API expects e.g., 1TO5 from 1A5
        return (
          {
            "1A5": "1TO5",
            "5A10": "5TO10",
            MAS10: "10PLUS",
          }[spanishValue.toUpperCase()] || spanishValue
        );
      case "moneyPurpose":
        return (
          {
            PERSONAL: "PERSONAL",
            NEGOCIO: "BUSINESS",
          }[spanishValue.toUpperCase()] || spanishValue
        );
      default:
        return spanishValue; // For fields not needing mapping or already correct
    }
  };

  const multipleChoiceFields: (keyof FillLeadBody)[] = [
    "civilStatus",
    "ocupation",
    "timeEmployed",
    "moneyPurpose",
  ];
  const booleanFields: (keyof FillLeadBody)[] = [
    "hasCreditCard",
    "hasVehicle",
    "ownsHouse",
  ];
  const surveyBasedFields: (keyof FillLeadBody)[] = [
    ...multipleChoiceFields,
    ...booleanFields,
  ];

  const getFieldOptions = (fieldName: keyof FillLeadBody): SurveyOption[] => {
    switch (fieldName) {
      case "civilStatus":
        return [
          { id: "SOLTERO", text: "Soltero(a)" },
          { id: "CASADO", text: "Casado(a)" },
          { id: "DIVORCIADO", text: "Divorciado(a)" },
          { id: "VIUDO", text: "Viudo(a)" },
        ];
      case "ocupation":
        return [
          { id: "DUEÑO", text: "Dueño(a)" },
          { id: "EMPLEADO", text: "Empleado(a)" },
        ];
      case "timeEmployed":
        return [
          { id: "1A5", text: "1 a 5 años" },
          { id: "5A10", text: "5 a 10 años" },
          { id: "MAS10", text: "Más de 10 años" },
        ];
      case "moneyPurpose":
        return [
          { id: "PERSONAL", text: "Personal" },
          { id: "NEGOCIO", text: "Negocio" },
        ];
      case "hasCreditCard":
      case "hasVehicle":
      case "ownsHouse":
        return [
          { id: "true", text: "Sí" },
          { id: "false", text: "No" },
        ];
      default:
        return [];
    }
  };

  const handleSendMessage = async () => {
    if (inputValue.trim() === "") return;

    const currentInput = inputValue;
    const userMessage: Message = {
      id: Date.now().toString(),
      content: currentInput,
      type: "text",
      sender: "user",
      timestamp: new Date(),
      read: false,
    };
    setMessages((prevMessages) => [...prevMessages, userMessage]);
    setInputValue("");

    try {
      if (currentStep === "awaiting_greeting") {
        addBotMessageWithDelay(
          "Bienvenido a nuestro bot de solicitud de crédito. Para comenzar, por favor envía tu número de teléfono."
        );
        setCurrentStep("collecting_phone_number");
        setDataCollectionStage("phoneNumber");
      } else if (currentStep === "collecting_phone_number") {
        if (dataCollectionStage === "phoneNumber") {
          const phone = currentInput.trim();
          // Basic phone validation (example)
          if (!phone || !/^[\+?[0-9\s-]{7,15}$/.test(phone)) {
            addBotMessageWithDelay(
              "Por favor, ingresa un número de teléfono válido."
            );
            return;
          }
          try {
            addBotMessageWithDelay("Validando número y creando lead..."); // Inform user
            const createdLeadId = await createLead(phone);
            if (!createdLeadId) {
              addBotMessageWithDelay(
                "Lo sentimos, no pudimos registrar tu número en este momento. Por favor, inténtalo de nuevo más tarde."
              );
              return;
            }
            setLeadId(createdLeadId); // Save the leadId
            setUserData((prev) => ({ ...prev, phone, leadId: createdLeadId }));
            addBotMessageWithDelay(
              "¡Gracias! Hemos registrado tu número. Ahora, ¿cuál es tu nombre completo?"
            );
            setDataCollectionStage("name");
            setCurrentStep("collecting_basic_data");
          } catch (apiError) {
            console.error("API Error creating lead:", apiError);
            addBotMessageWithDelay(
              "Hubo un problema al registrar tu número. Por favor, inténtalo de nuevo."
            );
          }
        }
      } else if (
        currentStep === "collecting_basic_data" &&
        dataCollectionStage &&
        dataCollectionStage !== "phoneNumber" &&
        !surveyBasedFields.includes(dataCollectionStage as keyof FillLeadBody)
      ) {
        const currentField = dataCollectionStage as keyof FillLeadBody;
        let parsedValue: any = currentInput;

        if (
          currentField === "age" ||
          currentField === "economicDependents" ||
          currentField === "monthlyIncome" ||
          currentField === "amountToFinance"
        ) {
          parsedValue = parseInt(currentInput, 10);
          if (isNaN(parsedValue)) {
            addBotMessageWithDelay(
              `Por favor, ingresa un número válido para ${translateFieldNameForPrompt(currentField, "question")}.`
            );
            return;
          }
        }

        setUserData((prev) => ({ ...prev, [currentField]: parsedValue }));
        const nextStage = getNextDataCollectionStage(currentField);
        setDataCollectionStage(nextStage);

        if (nextStage) {
          if (surveyBasedFields.includes(nextStage)) {
            const surveyMessage: Message = {
              id: Date.now().toString(),
              content: `Continuemos. ${translateFieldNameForPrompt(nextStage, "question")}`,
              type: "survey",
              sender: "contact",
              timestamp: new Date(),
              read: true,
              survey: {
                question: translateFieldNameForPrompt(nextStage, "question"),
                options: getFieldOptions(nextStage),
                subtitle: "Elige una opción:",
              },
            };
            setMessages((prev) => [...prev, surveyMessage]);
          } else {
            addBotMessageWithDelay(
              `Entendido. ¿Cuál es tu ${translateFieldNameForPrompt(nextStage, "question")}?`
            );
          }
        } else {
          const finalUserDataForApi = {
            ...userData,
            [currentField]: parsedValue,
            leadId: leadId ?? undefined,
          };
          await processDataAndCreateScore(finalUserDataForApi);
        }
      } else if (currentStep === "awaiting_documents") {
        if (
          documentUploadStep === 0 &&
          currentInput.toLowerCase() === "subido"
        ) {
          addBotMessageWithDelay(
            "Excelente. Por favor, adjunta tu primer estado de cuenta."
          );
          setDocumentUploadStep(1);
          setTimeout(() => fileInputRef.current?.click(), 800);
        } else if (
          documentUploadStep === 0 &&
          currentInput.toLowerCase() !== "subido"
        ) {
          addBotMessageWithDelay(
            "Por favor, escribe 'subido' para comenzar el proceso de carga de los 3 estados de cuenta."
          );
        } else if (documentUploadStep > 0) {
          addBotMessageWithDelay(
            `Por favor, utiliza el diálogo de carga de archivos para adjuntar el estado de cuenta ${documentUploadStep}.`
          );
        }
      } else if (currentStep === "rejected_score") {
        addBotMessageWithDelay(
          "Gracias por tu interés. Basado en tu puntaje crediticio actual, no tenemos una oferta disponible para ti en este momento. Puedes intentarlo nuevamente en el futuro."
        );
      } else if (currentStep === "completed") {
        addBotMessageWithDelay(
          "¡Tu solicitud ya está completada! Nos pondremos en contacto contigo pronto."
        );
      } else if (currentStep === "creating_profile") {
        addBotMessageWithDelay(
          "Estoy procesando la creación de tu perfil, por favor espera un momento."
        );
      } else if (currentStep === "profile_creation_error") {
        addBotMessageWithDelay(
          "Hubo un problema con la creación de tu perfil. Si el problema persiste, por favor contacta a soporte. Para intentar de nuevo todo el proceso, puedes enviar tu número de teléfono."
        );
      }
    } catch (error) {
      console.error("Error processing message:", error);
      let errorMessage =
        "Ocurrió un error inesperado. Por favor, inténtalo de nuevo.";
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      addBotMessageWithDelay(`Lo sentimos, ocurrió un error: ${errorMessage}`);
      setCurrentStep("awaiting_greeting");
      setDataCollectionStage(null);
      setUserData({});
      setLeadId(null);
      addBotMessageWithDelay(
        "Comencemos de nuevo. Por favor, proporciona tu número de teléfono."
      );
    }
  };

  const handleDataCollectionSurveyResponse = async (
    messageId: string,
    optionId: string,
    optionText: string
  ) => {
    if (
      !dataCollectionStage ||
      !surveyBasedFields.includes(dataCollectionStage as keyof FillLeadBody)
    ) {
      return;
    }

    const currentField = dataCollectionStage as keyof FillLeadBody;
    setSelectedSurvey(messageId);

    const userResponseMessage: Message = {
      id: Date.now().toString(),
      content: optionText,
      type: "text",
      sender: "user",
      timestamp: new Date(),
      read: false,
    };
    setMessages((prev) => [...prev, userResponseMessage]);

    let valueToStore: string | boolean = optionId;
    if (booleanFields.includes(currentField)) {
      valueToStore = optionId === "true";
    }
    const updatedUserData = {
      ...userData,
      [currentField]: valueToStore,
      leadId: leadId ?? undefined,
    };
    setUserData(updatedUserData);

    const nextStage = getNextDataCollectionStage(currentField);
    setDataCollectionStage(nextStage);

    setTimeout(async () => {
      if (nextStage) {
        if (surveyBasedFields.includes(nextStage)) {
          const surveyMessage: Message = {
            id: (Date.now() + 1).toString(),
            content: `Gracias. Ahora, ${translateFieldNameForPrompt(nextStage, "question")}`,
            type: "survey",
            sender: "contact",
            timestamp: new Date(),
            read: true,
            survey: {
              question: translateFieldNameForPrompt(nextStage, "question"),
              options: getFieldOptions(nextStage),
              subtitle: "Elige una opción:",
            },
          };
          setMessages((prev) => [...prev, surveyMessage]);
        } else {
          addBotMessageWithDelay(
            `Gracias. ¿Cuál es tu ${translateFieldNameForPrompt(nextStage, "question")}?`,
            0
          );
        }
      } else {
        await processDataAndCreateScore(updatedUserData);
      }
    }, 300);
  };

  const processDataAndCreateScore = async (
    currentUserData: Partial<FillLeadBody> & { phone?: string; leadId?: string }
  ) => {
    addBotMessageWithDelay(
      "Gracias por proporcionar toda tu información. Procesando..."
    );

    if (!currentUserData.leadId) {
      addBotMessageWithDelay(
        "Error: No se encontró el ID de lead. Por favor, comienza de nuevo."
      );
      setCurrentStep("awaiting_greeting");
      setDataCollectionStage(null);
      setUserData({});
      return;
    }

    const dataForCreditScoreApi = { ...currentUserData };
    delete dataForCreditScoreApi.phone;

    if (typeof dataForCreditScoreApi.hasVehicle === "boolean") {
      dataForCreditScoreApi.ownsVehicle = dataForCreditScoreApi.hasVehicle;
    } else {
      addBotMessageWithDelay(
        "Advertencia: No se pudo determinar la información del vehículo. Usando un valor predeterminado."
      );
      dataForCreditScoreApi.ownsVehicle = false;
    }

    const allApiFillLeadBodyKeys: (keyof Omit<
      FillLeadBody,
      "phone" | "leadId"
    >)[] = [
      "name",
      "age",
      "civilStatus",
      "documentNumber",
      "economicDependents",
      "monthlyIncome",
      "amountToFinance",
      "ocupation",
      "timeEmployed",
      "hasCreditCard",
      "hasVehicle",
      "moneyPurpose",
      "ownsHouse",
      "ownsVehicle",
    ];

    const missingFields = allApiFillLeadBodyKeys.filter(
      (f) =>
        !(f in dataForCreditScoreApi) ||
        dataForCreditScoreApi[f] === undefined ||
        dataForCreditScoreApi[f] === null ||
        (typeof dataForCreditScoreApi[f] === "string" &&
          (dataForCreditScoreApi[f] as string).trim() === "")
    );

    if (missingFields.length > 0) {
      const missingFieldNames = missingFields
        .map((f) =>
          translateFieldNameForPrompt(f as keyof FillLeadBody, "question")
        )
        .join(", ");
      addBotMessageWithDelay(
        `Faltan datos para la API: ${missingFieldNames}. Por favor, revisa tus respuestas.`
      );
      addBotMessageWithDelay(
        "Por favor, intenta comenzar el proceso de nuevo para asegurar que todos los datos se capturen correctamente."
      );
      setCurrentStep("collecting_phone_number");
      setDataCollectionStage("phoneNumber");
      return;
    }

    // If missingFields.length is 0, all required fields are present and validated.
    // Construct the payload in a way TypeScript can verify as FillLeadBody.
    const payloadForApi: FillLeadBody = {
      leadId: dataForCreditScoreApi.leadId!,
      name: dataForCreditScoreApi.name!,
      age: dataForCreditScoreApi.age!,
      civilStatus: mapSurveyResponseToApiValue(
        "civilStatus",
        dataForCreditScoreApi.civilStatus!
      ) as FillLeadBody["civilStatus"],
      documentNumber: dataForCreditScoreApi.documentNumber!,
      economicDependents: dataForCreditScoreApi.economicDependents!,
      monthlyIncome: dataForCreditScoreApi.monthlyIncome!,
      amountToFinance: dataForCreditScoreApi.amountToFinance!,
      ocupation: mapSurveyResponseToApiValue(
        "ocupation",
        dataForCreditScoreApi.ocupation!
      ) as FillLeadBody["ocupation"],
      timeEmployed: mapSurveyResponseToApiValue(
        "timeEmployed",
        dataForCreditScoreApi.timeEmployed!
      ) as FillLeadBody["timeEmployed"],
      hasCreditCard: dataForCreditScoreApi.hasCreditCard!,
      hasVehicle: dataForCreditScoreApi.hasVehicle!,
      moneyPurpose: mapSurveyResponseToApiValue(
        "moneyPurpose",
        dataForCreditScoreApi.moneyPurpose!
      ) as FillLeadBody["moneyPurpose"],
      ownsHouse: dataForCreditScoreApi.ownsHouse!,
      ownsVehicle: dataForCreditScoreApi.ownsVehicle!,
    };

    try {
      addBotMessageWithDelay(
        "Calculando tu puntaje crediticio, un momento por favor...",
        1000
      );
      const probability = await createCreditScore(payloadForApi);

      if (typeof probability !== "number") {
        addBotMessageWithDelay(
          "No pudimos obtener un puntaje crediticio válido. Por favor, contacta a soporte o intenta más tarde."
        );
        return;
      }

      addBotMessageWithDelay(
        `Tu probabilidad crediticia calculada es: ${(probability * 100).toFixed(0)}%.`
      );

      if (probability > 0.6) {
        addBotMessageWithDelay(
          "¡Buenas noticias! Basado en tu puntaje, tenemos una oferta pre-aprobada para ti. Continuemos con el siguiente paso."
        );
        addBotMessageWithDelay(
          "Ahora necesitamos tus últimos 3 estados de cuenta bancarios. Por favor, escribe 'subido' cuando los hayas enviado."
        );
        setCurrentStep("awaiting_documents");
      } else {
        addBotMessageWithDelay(
          "Gracias por tu interés. Basado en tu puntaje crediticio actual, no tenemos una oferta disponible para ti en este momento."
        );
        setCurrentStep("rejected_score");
      }
    } catch (apiError) {
      console.error("API Error creating credit score:", apiError);
      addBotMessageWithDelay(
        "Hubo un problema al procesar tu puntaje crediticio. Por favor, contacta a soporte."
      );
    }
  };

  // Renamed and repurposed for general file (PDF) uploads in the doc step
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (documentUploadStep > 0 && documentUploadStep <= 3) {
      addBotMessageWithDelay(
        `Archivo "${file.name}" seleccionado para Estado de Cuenta ${documentUploadStep}. Procesando...`
      );

      // Simulate processing and store mock URL
      const mockStatementUrls = [
        "https://cci-storage-test.s3.us-east-1.amazonaws.com/0147516826_OCTUBRE2024.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAWPPO6RIV5CTGNHUS%2F20250516%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20250516T000446Z&X-Amz-Expires=604800&X-Amz-SignedHeaders=host&X-Amz-Signature=c6f4e1f4fe41a545f914f78683bcd7112e2666cf3063adf757bd22e803d2ffed",
        "https://cci-storage-test.s3.us-east-1.amazonaws.com/0147516826_NOVIEMBRE2024.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAWPPO6RIV5CTGNHUS%2F20250516%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20250516T000429Z&X-Amz-Expires=604800&X-Amz-SignedHeaders=host&X-Amz-Signature=c5b785d45510b2049176d3c8ac49549b135dd42b96e2d22ca5803f906a7b7a72",
        "https://cci-storage-test.s3.us-east-1.amazonaws.com/0147516826_DICIEMBRE2024.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAWPPO6RIV5CTGNHUS%2F20250516%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20250516T000413Z&X-Amz-Expires=604800&X-Amz-SignedHeaders=host&X-Amz-Signature=ad65b9c5c55d8fe8454fc3d8844f38d8a3738c3dea9cc6194dbda7e32b131408",
      ];
      const newUrls = [
        ...uploadedDocumentUrls,
        mockStatementUrls[documentUploadStep - 1],
      ];
      setUploadedDocumentUrls(newUrls);

      if (documentUploadStep < 3) {
        const nextStep = documentUploadStep + 1;
        setDocumentUploadStep(nextStep);
        addBotMessageWithDelay(
          `Excelente. Ahora, por favor adjunta tu estado de cuenta ${nextStep}.`,
          800
        );
        // Automatically trigger file input for the next document after a short delay
        setTimeout(() => fileInputRef.current?.click(), 1200);
      } else {
        addBotMessageWithDelay(
          'Gracias. Hemos "recibido" todos tus estados de cuenta. Creando tu perfil crediticio...',
          800
        );
        if (!leadId) {
          addBotMessageWithDelay(
            "Error crítico: Falta el ID de lead para crear el perfil. Por favor, contacta a soporte."
          );
          setCurrentStep("awaiting_greeting");
          setDocumentUploadStep(0);
          setUploadedDocumentUrls([]);
          return;
        }
        setCurrentStep("creating_profile"); // Set step before async operation

        const creditProfileBody: CreateCreditProfileBody = {
          leadId,
          firstStatement: newUrls[0],
          secondStatement: newUrls[1],
          thirdStatement: newUrls[2],
        };
        try {
          const profileLeadId = await createCreditProfile(creditProfileBody);
          if (profileLeadId) {
            addBotMessageWithDelay(
              `¡Tu perfil crediticio ha sido creado (ID: ${profileLeadId})! Tu solicitud está pre-aprobada. Nos pondremos en contacto contigo en breve con los detalles finales.`,
              1000
            );
            setCurrentStep("completed");
          } else {
            addBotMessageWithDelay(
              "Lo sentimos, no pudimos finalizar tu perfil crediticio en este momento. Por favor, inténtalo más tarde o contacta a soporte."
            );
            setCurrentStep("profile_creation_error");
          }
        } catch (apiError) {
          console.error("API Error creating credit profile:", apiError);
          addBotMessageWithDelay(
            "Hubo un problema al crear tu perfil crediticio. Por favor, contacta a soporte."
          );
          setCurrentStep("profile_creation_error");
        }
        setDocumentUploadStep(0);
        setUploadedDocumentUrls([]);
      }
    }
    // Reset file input to allow selecting the same file again if needed
    if (e.target) {
      e.target.value = "";
    }
  };

  const handleInitiateDocumentUpload = () => {
    if (currentStep === "awaiting_documents" && documentUploadStep === 0) {
      // Add the user action as a message, as if they typed "subido"
      const userMessage: Message = {
        id: Date.now().toString(),
        content: "Adjuntar documentos (clic en icono)", // Representing the button click
        type: "text",
        sender: "user",
        timestamp: new Date(),
        read: false,
      };
      setMessages((prevMessages) => [...prevMessages, userMessage]);

      // Proceed with the document upload flow
      addBotMessageWithDelay(
        "Excelente. Por favor, adjunta tu primer estado de cuenta."
      );
      setDocumentUploadStep(1);
      setTimeout(() => fileInputRef.current?.click(), 800);
    }
    // If not in the correct step, the button click does nothing or could show a message
  };

  return (
    <div className="flex flex-col h-[600px] rounded-md overflow-hidden border border-gray-200 shadow-lg">
      {/* Header */}
      <div className="flex items-center p-3 bg-emerald-600 text-white">
        <Button variant="ghost" size="icon" className="text-white mr-2">
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <Avatar className="h-10 w-10 mr-3 overflow-hidden">
          <AvatarImage src={contactAvatar} />
          <AvatarFallback>CI</AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <h3 className="font-semibold">{contactName}</h3>
          <p className="text-xs opacity-90">{contactSubtitle}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" className="text-white">
            <Video className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" className="text-white">
            <Phone className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" className="text-white">
            <MoreVertical className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Chat area */}
      <div
        className="flex-1 p-4 overflow-y-auto bg-[#e5ddd5] bg-opacity-90"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='100' height='100' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M11 18c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7zm48 25c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7zm-43-7c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm63 31c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zM34 90c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm56-76c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zM12 86c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm28-65c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm23-11c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm-6 60c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm29 22c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zM32 63c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm57-13c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm-9-21c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zM60 91c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zM35 41c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zM12 60c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2z' fill='%23999' fillOpacity='0.1' fillRule='evenodd'/%3E%3C/svg%3E")`,
          backgroundSize: "300px",
        }}
      >
        {messages.map((message) => {
          if (message.sender === "system") {
            return (
              <div key={message.id} className="flex justify-center my-4">
                <div className="bg-yellow-100 rounded-lg p-3 max-w-[80%] text-center text-sm">
                  {message.content}
                </div>
              </div>
            );
          }

          const isUser = message.sender === "user";

          return (
            <div
              key={message.id}
              className={cn(
                "flex mb-4",
                isUser ? "justify-end" : "justify-start"
              )}
            >
              <div
                className={cn(
                  "rounded-lg p-3 max-w-[70%] relative",
                  isUser ? "bg-[#dcf8c6]" : "bg-white"
                )}
              >
                {message.type === "text" && (
                  <div className="text-sm">{message.content}</div>
                )}

                {message.type === "image" && message.imageUrl && (
                  <div className="mb-1">
                    {message.imageUrl.includes("thumbs-up") ? (
                      <div className="flex justify-center">
                        <ThumbsUp
                          className="h-12 w-12 text-yellow-400"
                          fill="currentColor"
                        />
                      </div>
                    ) : (
                      <img
                        src={message.imageUrl || "/placeholder.svg"}
                        alt="Shared image"
                        className="max-w-full rounded-md"
                        style={{ maxHeight: "200px" }}
                      />
                    )}
                    {message.content && (
                      <div className="mt-1 text-sm">{message.content}</div>
                    )}
                  </div>
                )}

                {message.type === "survey" && message.survey && (
                  <div>
                    <div className="font-medium mb-1">
                      {message.survey.question}
                    </div>
                    {message.survey.subtitle && (
                      <div className="text-sm text-gray-600 mt-1 mb-2">
                        {message.survey.subtitle}
                      </div>
                    )}
                    <div className="mt-1 space-y-2">
                      {message.survey.options.map((option) => (
                        <Button
                          key={option.id}
                          variant="outline"
                          className={cn(
                            "w-full justify-center bg-white hover:bg-gray-100 text-blue-600 border-blue-500",
                            selectedSurvey === message.id &&
                              "opacity-50 pointer-events-none bg-gray-200"
                          )}
                          onClick={() =>
                            handleDataCollectionSurveyResponse(
                              message.id,
                              option.id,
                              option.text
                            )
                          }
                          disabled={selectedSurvey === message.id}
                        >
                          {option.text}
                        </Button>
                      ))}
                    </div>
                    {message.survey.link && (
                      <div className="mt-3">
                        <Button
                          variant="link"
                          className="p-0 h-auto text-blue-500"
                          onClick={() =>
                            window.open(message.survey?.link?.url, "_blank")
                          }
                        >
                          {message.survey.link.text}
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                <div className="text-[10px] text-gray-500 text-right mt-1">
                  {formatTime(message.timestamp)}
                  {isUser && (
                    <span className="ml-1 inline-flex">
                      <Check
                        className={cn(
                          "h-3 w-3",
                          message.read ? "text-blue-500" : "text-gray-400"
                        )}
                      />
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="p-2 bg-[#f0f0f0] flex items-center gap-2">
        <div className="flex-1 flex bg-white rounded-full px-3 py-1">
          <Input
            type="text"
            placeholder="Escribe un mensaje"
            className="flex-1 border-none focus-visible:ring-0 focus-visible:ring-offset-0 bg-transparent"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleSendMessage();
              }
            }}
          />
        </div>
        <input
          type="file"
          accept=".pdf"
          className="hidden"
          ref={fileInputRef}
          onChange={handleFileUpload}
        />
        <Button
          variant="ghost"
          size="icon"
          className="text-gray-500"
          onClick={handleInitiateDocumentUpload}
        >
          <ImageIcon className="h-5 w-5" />
        </Button>
        {inputValue ? (
          <Button
            variant="ghost"
            size="icon"
            className="bg-emerald-500 text-white hover:bg-emerald-600 hover:text-white"
            onClick={handleSendMessage}
          >
            <Send className="h-5 w-5" />
          </Button>
        ) : (
          <Button variant="ghost" size="icon" className="text-gray-500">
            <Mic className="h-5 w-5" />
          </Button>
        )}
      </div>
    </div>
  );
}
