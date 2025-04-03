"use client";

import { useState, useRef } from "react";
import type { ReactNode } from "react";
import { Star, MessageCircle, Check, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import LogoCashIn from "/public/logo_cashin_azul.svg";
import CarCouple from "@/assets/car_couple.jpg";
import { saveClientLead } from "./services/eden";
import AvatarPlaceholder from "@/assets/avatar_placeholder.svg";

// Define question interface types
interface BaseQuestion {
  id: string;
  label: string;
  type: string;
  value: string;
  required: boolean;
  condition?: () => boolean;
}

interface TextQuestion extends BaseQuestion {
  type: "text" | "tel" | "email";
}

interface RadioQuestion extends BaseQuestion {
  type: "radio";
  options: { value: string; label: string }[];
}

interface InfoQuestion extends BaseQuestion {
  type: "info";
  content: ReactNode;
  options: { value: string; label: string }[];
}

type Question = TextQuestion | RadioQuestion | InfoQuestion;

export default function LandingPage() {
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState({
    ready: "",
    firstName: "",
    lastName: "",
    phoneNumber: "",
    loanType: "",
    hasStatements: "",
    vehicleDetails: "",
    loanAmount: "",
    carLoanInfo: "",
    vehicleLoanInfo: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  const scrollToForm = () => {
    formRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const nextStep = () => {
    if (currentStep < getQuestions().length - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      handleSubmit();
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      const response = await saveClientLead(formData);
      console.log(response);
      setIsSubmitted(true);
    } catch (error: any) {
      console.error("Error submitting form:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getQuestions = (): Question[] => {
    const baseQuestions: Question[] = [
      {
        id: "ready",
        label: "¿Listo para empezar?",
        type: "radio",
        value: formData.ready,
        options: [
          { value: "si", label: "¡Sí, vamos!" },
          { value: "no", label: "No, tal vez después" },
        ],
        required: true,
      },
      {
        id: "firstName",
        label: "¿Cuál es tu primer nombre?",
        type: "text",
        value: formData.firstName,
        required: true,
      },
      {
        id: "lastName",
        label: "¿Cuál es tu apellido?",
        type: "text",
        value: formData.lastName,
        required: true,
      },
      {
        id: "phoneNumber",
        label: "Número de teléfono para contactarte por WhatsApp",
        type: "tel",
        value: formData.phoneNumber,
        required: true,
      },
      {
        id: "loanType",
        label: "Tipo de crédito que te interesa:",
        type: "radio",
        value: formData.loanType,
        options: [
          { value: "carLoan", label: "Préstamo para comprar un carro" },
          { value: "vehicleLoan", label: "Préstamo sobre tu vehículo" },
        ],
        required: true,
      },
    ];

    // Conditional questions based on loan type
    if (formData.loanType === "carLoan") {
      return [
        ...baseQuestions,
        {
          id: "carLoanInfo",
          label: "Información sobre préstamo para comprar un carro",
          type: "info",
          content: (
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
              <h3 className="font-bold text-blue-800 mb-2">
                Detalles del préstamo para comprar un carro:
              </h3>
              <ul className="list-disc pl-5 space-y-1 text-blue-700">
                <li>Tasas desde 12% anual</li>
                <li>Plazos de hasta 60 meses</li>
                <li>Financiamiento de hasta el 90% del valor del vehículo</li>
                <li>Aprobación rápida en 24 horas</li>
              </ul>
              <p className="mt-4 text-blue-600 font-medium">
                ¿Deseas continuar con tu solicitud?
              </p>
            </div>
          ),
          value: "continue",
          options: [
            { value: "continue", label: "Sí, continuar" },
            { value: "cancel", label: "No, cancelar" },
          ],
          required: true,
        },
        {
          id: "hasStatements",
          label:
            "¿Tú o alguien que va a aplicar contigo tienen sus últimos 3 estados de cuenta bancarios?",
          type: "radio",
          value: formData.hasStatements,
          options: [
            { value: "yes", label: "Sí, los tenemos" },
            { value: "no", label: "No, no los tenemos" },
          ],
          required: true,
          condition: () => formData.carLoanInfo !== "cancel",
        },
      ];
    } else if (formData.loanType === "vehicleLoan") {
      return [
        ...baseQuestions,
        {
          id: "vehicleLoanInfo",
          label: "Información sobre préstamo sobre tu vehículo",
          type: "info",
          content: (
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
              <h3 className="font-bold text-blue-800 mb-2">
                Detalles del préstamo sobre tu vehículo:
              </h3>
              <ul className="list-disc pl-5 space-y-1 text-blue-700">
                <li>Efectivo inmediato</li>
                <li>Sigues usando tu vehículo</li>
                <li>Tasas competitivas</li>
                <li>Plazos flexibles</li>
              </ul>
              <p className="mt-4 text-blue-600 font-medium">
                ¿Deseas continuar con tu solicitud?
              </p>
            </div>
          ),
          value: "continue",
          options: [
            { value: "continue", label: "Sí, continuar" },
            { value: "cancel", label: "No, cancelar" },
          ],
          required: true,
        },
        {
          id: "vehicleDetails",
          label: "¿Cuál es la marca, modelo y año de tu vehículo?",
          type: "text",
          value: formData.vehicleDetails,
          required: true,
          condition: () => formData.vehicleLoanInfo !== "cancel",
        },
        {
          id: "loanAmount",
          label:
            "¿Cuánto deseas solicitar? (Debe ser hasta el 50% del valor de tu vehículo)",
          type: "text",
          value: formData.loanAmount,
          required: true,
          condition: () => formData.vehicleLoanInfo !== "cancel",
        },
      ];
    }

    return baseQuestions;
  };

  const questions = getQuestions().filter((q) => !q.condition || q.condition());

  const isCurrentQuestionAnswered = () => {
    const currentQuestion = questions[currentStep];
    return !!currentQuestion.value;
  };

  const testimonials = [
    {
      name: "Eduardo López O.",
      text: "Excelente servicio, atención, muy amable nuestra asesora y sobre todo rapidez para la entrega de nuestro nuevo vehículo, súper encantados 🤝",
      rating: 5,
      avatar: AvatarPlaceholder,
    },
    {
      name: "Jose Ortiz",
      text: "Atención al 100, muy amables y atentos muy buena disposición de vehículos y gracias a mi asesor por el tiempo y la dedicación del caso",
      rating: 5,
      avatar: AvatarPlaceholder,
    },
    {
      name: "Carlos Morales",
      text: "Una atención increíble departe de todos en oficina, especialmente en la Srita. Gabriela Cabrera, ella me facilitó TODO el proceso, muy eficiente y cuando llegue a oficinas, todos muy amables e hicieron del trámite una bonita experiencia y porsupuesto muy contento de tener mi nuevo vehículo.. Muchas gracias por todo Club Cash In, de mi parte SUPER recomendados.",
      rating: 5,
      avatar: AvatarPlaceholder,
    },
    {
      name: "Fernando Torres",
      text: "Excelente empresa, me brindaron toda la ayuda para adquirir mi carro, y lo mejor en la cuota mensual va incluido todo. Gracias amigos. 👍",
      rating: 5,
      avatar: AvatarPlaceholder,
    },
  ];

  const features = [
    {
      icon: <Check className="h-6 w-6 text-blue-500" />,
      text: "Proceso 100% en línea",
    },
    {
      icon: <Check className="h-6 w-6 text-blue-500" />,
      text: "Respuesta en 24 horas",
    },
    {
      icon: <Check className="h-6 w-6 text-blue-500" />,
      text: "Sin comisiones ocultas",
    },
    {
      icon: <Check className="h-6 w-6 text-blue-500" />,
      text: "Cuotas que se adaptan a tu capacidad de pago",
    },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white py-4 px-6 shadow-sm sticky top-0 z-50">
        <div className="container mx-auto flex justify-between items-center">
          <div className="flex items-center">
            <img src={LogoCashIn} alt="Logo Cash·IN" className="h-10" />
          </div>
        </div>
      </header>

      {/* Hero Banner */}
      <section className="relative bg-gradient-to-tr from-blue-900 to-blue-600 text-white overflow-hidden">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute inset-0 bg-black opacity-40"></div>
          <img
            src={CarCouple}
            alt="Persona en un carro"
            className="w-full h-full object-cover object-[center_25%]"
          />
        </div>
        <div className="container mx-auto px-4 py-12 md:py-16 relative z-10">
          <div className="max-w-xl">
            <h1 className="text-4xl md:text-5xl font-bold mb-4">
              Tu próximo carro en pocos clics
            </h1>
            <div className="bg-gradient-to-tr from-blue-800 via-blue-800 via-60% to-transparent -ml-4 pl-4 inline-block pr-16 py-3 mb-6">
              <span className="text-xl md:text-2xl font-bold">
                FÁCIL Y RÁPIDO
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="bg-white py-8">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {features.map((feature, index) => (
              <div key={index} className="flex items-center gap-2">
                <div className="flex-shrink-0 w-6 min-w-6 h-6 flex items-center justify-center">
                  {feature.icon}
                </div>
                <span className="text-sm md:text-base font-medium">
                  {feature.text}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Form Wizard Section */}
      <section ref={formRef} className="py-12 bg-gray-50" id="form-section">
        <div className="container mx-auto px-4">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-8 text-blue-800">
            Solicita tu crédito en minutos
          </h2>

          <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-lg overflow-hidden">
            {!isSubmitted ? (
              <div className="p-6 md:p-8">
                {/* Chat-like header */}
                <div className="flex items-center gap-3 pb-4 mb-6 border-b">
                  <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center">
                    <MessageCircle className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <p className="font-medium text-blue-800">
                      Asistente CASH·IN
                    </p>
                    <p className="text-sm text-gray-500">
                      En línea | Respuesta inmediata
                    </p>
                  </div>
                </div>

                {/* Progress dots */}
                <div className="flex justify-center mb-8">
                  {questions.map((_, index) => (
                    <div
                      key={index}
                      className={cn(
                        "w-2 h-2 rounded-full mx-1 transition-all duration-300",
                        index === currentStep
                          ? "bg-blue-600 w-4"
                          : index < currentStep
                          ? "bg-blue-400"
                          : "bg-gray-300"
                      )}
                    ></div>
                  ))}
                </div>

                {/* Form Steps */}
                <div className="relative min-h-[500px]">
                  {questions.map((question, index) => (
                    <div
                      key={question.id}
                      className={cn(
                        "absolute top-0 left-0 w-full transition-all duration-500 ease-in-out",
                        currentStep === index
                          ? "opacity-100 translate-x-0"
                          : currentStep > index
                          ? "opacity-0 -translate-x-full"
                          : "opacity-0 translate-x-full"
                      )}
                    >
                      {/* Chat bubble for question */}
                      <div className="bg-blue-50 p-4 rounded-lg rounded-tl-none inline-block mb-6 max-w-[90%]">
                        <p className="text-blue-800 font-medium">
                          {question.label}
                        </p>
                      </div>

                      {/* Info content if present */}
                      {question.type === "info" && (
                        <div className="mb-4">{question.content}</div>
                      )}

                      {/* Input fields */}
                      <div
                        className={cn(
                          "bg-white p-2 rounded-lg shadow-sm border border-gray-200",
                          question.type === "info" && "w-full"
                        )}
                      >
                        {question.type === "text" || question.type === "tel" ? (
                          <Input
                            type={question.type}
                            value={question.value as string}
                            onChange={(e) =>
                              handleInputChange(question.id, e.target.value)
                            }
                            className="w-full p-3 text-lg border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:ring-blue-500"
                            placeholder={`Ingresa tu ${question.label.toLowerCase()}`}
                            required={question.required}
                          />
                        ) : question.type === "radio" ||
                          (question.type === "info" && question.options) ? (
                          <RadioGroup
                            value={question.value as string}
                            onValueChange={(value) =>
                              handleInputChange(question.id, value)
                            }
                            className="space-y-3 w-full"
                          >
                            {question.options?.map((option) => (
                              <div
                                key={option.value}
                                className="flex items-center space-x-2 bg-gray-50 p-3 rounded-lg hover:bg-gray-100 transition-colors w-full"
                              >
                                <RadioGroupItem
                                  id={`${question.id}-${option.value}`}
                                  value={option.value}
                                  className="h-5 w-5 border-2 text-blue-600"
                                />
                                <Label
                                  htmlFor={`${question.id}-${option.value}`}
                                  className="text-lg font-medium cursor-pointer w-full"
                                >
                                  {option.label}
                                </Label>
                              </div>
                            ))}
                          </RadioGroup>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Navigation Buttons */}
                <div className="flex justify-between mt-16 relative z-20">
                  <Button
                    type="button"
                    onClick={prevStep}
                    disabled={currentStep === 0}
                    variant="outline"
                    className="px-6 py-2 border-2 border-blue-600 text-blue-600 disabled:opacity-50"
                  >
                    Atrás
                  </Button>

                  <Button
                    type="button"
                    onClick={nextStep}
                    disabled={!isCurrentQuestionAnswered() || isSubmitting}
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 flex items-center gap-2"
                  >
                    {currentStep === questions.length - 1 ? (
                      isSubmitting ? (
                        "Enviando..."
                      ) : (
                        "Enviar"
                      )
                    ) : (
                      <>
                        Siguiente <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="p-8 text-center">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Check className="h-8 w-8 text-green-600" />
                </div>
                <h3 className="text-2xl font-bold text-blue-800 mb-4">
                  ¡Solicitud recibida!
                </h3>
                <p className="text-lg text-gray-700 mb-6">
                  Gracias {formData.firstName} por tu interés. Un asesor se
                  pondrá en contacto contigo pronto a través de WhatsApp al{" "}
                  {formData.phoneNumber}.
                </p>
                <Button
                  onClick={() => {
                    setIsSubmitted(false);
                    setCurrentStep(0);
                    setFormData({
                      ready: "",
                      firstName: "",
                      lastName: "",
                      phoneNumber: "",
                      loanType: "",
                      hasStatements: "",
                      vehicleDetails: "",
                      loanAmount: "",
                      carLoanInfo: "",
                      vehicleLoanInfo: "",
                    });
                  }}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  Iniciar nueva solicitud
                </Button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section className="py-12 bg-gradient-to-b from-blue-600 to-blue-800 text-white">
        <div className="container mx-auto px-4">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-12">
            Lo que dicen nuestros clientes
          </h2>

          <div className="grid md:grid-cols-3 gap-6">
            {testimonials.map((testimonial, index) => (
              <div
                key={index}
                className="bg-white/10 backdrop-blur-sm p-6 rounded-xl"
              >
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 rounded-full overflow-hidden bg-blue-200">
                    <img
                      src={testimonial.avatar || AvatarPlaceholder}
                      alt={testimonial.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div>
                    <p className="font-semibold">{testimonial.name}</p>
                    <div className="flex">
                      {[...Array(5)].map((_, i) => (
                        <Star
                          key={i}
                          className={cn(
                            "h-4 w-4",
                            i < testimonial.rating
                              ? "text-yellow-400 fill-yellow-400"
                              : "text-gray-400"
                          )}
                        />
                      ))}
                    </div>
                  </div>
                </div>
                <p className="text-white/90">"{testimonial.text}"</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-10 bg-white">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-2xl md:text-3xl font-bold text-blue-800 mb-6">
            CUOTAS QUE SE ADAPTAN A TU CAPACIDAD DE PAGO
          </h2>
          <Button
            onClick={scrollToForm}
            className="bg-blue-600 hover:bg-blue-700 text-white text-lg px-8 py-6 rounded-full"
          >
            ¡Solicita ahora!
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 bg-gray-900 text-white">
        <div className="container mx-auto px-4 text-center">
          <p className="mb-4">
            © {new Date().getFullYear()} CASH·IN. Todos los derechos reservados.
          </p>
          <p className="text-sm text-gray-400">
            Sujeto a aprobación de crédito. Aplican términos y condiciones.
          </p>
        </div>
      </footer>
    </div>
  );
}
