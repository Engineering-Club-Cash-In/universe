"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Star, Award, Users, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import HeroMan from "/public/hero_man.png";
import LogoCashIn from "/public/logo_cashin_blanco.svg";

export default function App() {
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState({
    fullName: "",
    phoneNumber: "",
    email: "",
    hasInvested: "",
    hasBankAccount: "",
    investmentRange: "",
    contactMethod: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  const reviewsRef = useRef<HTMLDivElement>(null);

  // Set smooth scrolling globally and custom CSS properties
  useEffect(() => {
    document.documentElement.style.scrollBehavior = "smooth";

    // Function to set the CSS variable for viewport height
    const setViewportHeight = () => {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty("--vh", `${vh}px`);
    };

    // Set the initial value
    setViewportHeight();

    // Update the value when the window is resized
    window.addEventListener("resize", setViewportHeight);

    return () => {
      document.documentElement.style.scrollBehavior = "";
      window.removeEventListener("resize", setViewportHeight);
    };
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const scrollToForm = () => {
    formRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const scrollToReviews = () => {
    reviewsRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const nextStep = () => {
    if (currentStep < questions.length - 1) {
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

  const handleSubmit = () => {
    setIsSubmitting(true);
    // Simulate form submission
    setTimeout(() => {
      setIsSubmitting(false);
      setIsSubmitted(true);
      console.log("Form submitted:", formData);
    }, 1500);
  };

  const questions = [
    {
      id: "fullName",
      label: "Nombre Completo",
      type: "text",
      value: formData.fullName,
      required: true,
    },
    {
      id: "phoneNumber",
      label: "Número de teléfono",
      type: "tel",
      value: formData.phoneNumber,
      required: true,
    },
    {
      id: "email",
      label: "Correo electrónico",
      type: "email",
      value: formData.email,
      required: true,
    },
    {
      id: "hasInvested",
      label: "¿Has invertido antes en productos financieros?",
      type: "radio",
      value: formData.hasInvested,
      options: [
        { value: "si", label: "Sí" },
        { value: "no", label: "No" },
      ],
      required: true,
    },
    {
      id: "hasBankAccount",
      label: "¿Tienes una cuenta de banco activa?",
      type: "radio",
      value: formData.hasBankAccount,
      options: [
        { value: "si", label: "Sí" },
        { value: "no", label: "No" },
      ],
      required: true,
    },
    {
      id: "investmentRange",
      label: "¿Cuánto deseas invertir?",
      type: "radio",
      value: formData.investmentRange,
      options: [
        { value: "10000-25000", label: "Q10,000 - Q25,000" },
        { value: "25001-50000", label: "Q25,001 - Q50,000" },
        { value: "50001-100000", label: "Q50,001 - Q100,000" },
        { value: "100001+", label: "Más de Q100,000" },
      ],
      required: true,
    },
    {
      id: "contactMethod",
      label: "¿Por que medio deseas ser contactado?",
      type: "radio",
      value: formData.contactMethod,
      options: [
        { value: "whatsapp", label: "WhatsApp" },
        { value: "llamada", label: "Llamada telefónica" },
      ],
      required: true,
    },
  ];

  const isCurrentQuestionAnswered = () => {
    const currentQuestion = questions[currentStep];
    return !!currentQuestion.value;
  };

  const testimonials = [
    {
      name: "María González",
      text: "Invertir con esta plataforma ha sido una de las mejores decisiones financieras que he tomado. El proceso fue sencillo y los rendimientos superaron mis expectativas.",
      rating: 5,
    },
    {
      name: "Carlos Rodríguez",
      text: "El equipo de asesores me guió durante todo el proceso. Me explicaron claramente todas mis opciones y me ayudaron a elegir la inversión que mejor se adaptaba a mis necesidades.",
      rating: 5,
    },
    {
      name: "Ana Martínez",
      text: "Comencé con una inversión pequeña y al ver los resultados, decidí aumentar mi capital. La plataforma es muy intuitiva y el servicio al cliente es excelente.",
      rating: 4,
    },
  ];

  const stats = [
    {
      icon: <DollarSign className="h-8 w-8" />,
      value: "Q120M+",
      label: "Capital invertido",
    },
    {
      icon: <Users className="h-8 w-8" />,
      value: "5,000+",
      label: "Inversionistas activos",
    },
    {
      icon: <Award className="h-8 w-8" />,
      value: "15+",
      label: "Premios de excelencia",
    },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      {/* Enhanced Hero Section */}
      <section className="relative min-h-[calc(var(--vh,1vh)*100)] flex items-center justify-center bg-[#1d1d1d] overflow-hidden py-16 px-4 md:py-0">
        {/* Header Logo */}
        <div className="absolute top-0 left-0 w-full py-4 px-6 z-30">
          <div className="container mx-auto">
            <img src={LogoCashIn} alt="CashIn Logo" className="h-12 md:h-16" />
          </div>
        </div>

        <div className="container mx-auto px-4 py-12 grid md:grid-cols-2 gap-8 items-center relative z-10">
          {/* Text content */}
          <div className="text-white text-left">
            <h1 className="text-4xl md:text-6xl font-bold mb-6 leading-tight">
              Invierte en tu futuro con{" "}
              <span className="text-[#d8e710]">confianza</span>
            </h1>
            <p className="text-xl md:text-2xl mb-8 text-gray-300 max-w-xl">
              Garantía que protege tu inversión
            </p>

            {/* Mobile Hero Image - only visible on mobile screens */}
            <div className="flex justify-center items-center mb-8 md:hidden">
              <div className="relative w-2/3 max-w-[280px]">
                <div className="absolute -inset-4 bg-gradient-to-tr from-[#4d56f2]/10 to-[#d8e710]/10 rounded-full blur-xl opacity-70"></div>
                <img
                  src={HeroMan}
                  alt="Inversionista exitoso"
                  className="relative z-10 w-full h-auto object-contain drop-shadow-2xl"
                  style={{
                    maskImage:
                      "linear-gradient(to bottom, black 70%, transparent 100%)",
                    WebkitMaskImage:
                      "linear-gradient(to bottom, black 70%, transparent 100%)",
                  }}
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
              <Button
                onClick={scrollToForm}
                className="bg-[#4d56f2] hover:bg-[#4d56f2]/90 text-white text-lg px-8 py-6 rounded-full cursor-pointer"
              >
                Comienza Ahora
              </Button>
              <Button
                variant="outline"
                onClick={scrollToReviews}
                className="bg-transparent border-2 border-white/30 hover:bg-white/10 hover:text-white text-white text-lg px-8 py-6 rounded-full cursor-pointer"
              >
                Conoce más
              </Button>
            </div>

            {/* Stats preview */}
            <div className="mt-12 grid grid-cols-3 gap-4">
              <div className="text-center">
                <p className="text-3xl font-bold text-[#d8e710]">12%</p>
                <p className="text-sm text-gray-400">Rendimiento promedio</p>
              </div>
              <div className="text-center">
                <p className="text-3xl font-bold text-[#d8e710]">5K+</p>
                <p className="text-sm text-gray-400">Inversionistas</p>
              </div>
              <div className="text-center">
                <p className="text-3xl font-bold text-[#d8e710]">Q120M+</p>
                <p className="text-sm text-gray-400">Capital invertido</p>
              </div>
            </div>
          </div>

          {/* Hero Image - visible only on medium and larger screens */}
          <div className="hidden md:flex justify-center items-center">
            <div className="relative">
              <div className="absolute -inset-4 bg-gradient-to-tr from-[#4d56f2]/10 to-[#d8e710]/10 rounded-full blur-xl opacity-70"></div>
              <img
                src={HeroMan}
                alt="Inversionista exitoso"
                className="relative z-10 max-h-[500px] object-contain drop-shadow-2xl"
                style={{
                  maskImage:
                    "linear-gradient(to bottom, black 70%, transparent 100%)",
                  WebkitMaskImage:
                    "linear-gradient(to bottom, black 70%, transparent 100%)",
                }}
              />
            </div>
          </div>
        </div>

        <div className="absolute bottom-4 md:bottom-10 left-1/2 transform -translate-x-1/2 animate-bounce z-20">
          <button
            onClick={scrollToForm}
            className="bg-transparent border-none cursor-pointer"
            aria-label="Scroll to form"
          >
            <ChevronDown className="h-10 w-10 text-[#d8e710]" />
          </button>
        </div>
      </section>

      {/* Form Wizard Section */}
      <section
        ref={formRef}
        id="form"
        className="min-h-[calc(var(--vh,1vh)*100)] py-16 md:py-24 flex items-center justify-center bg-white"
      >
        <div className="container mx-auto px-4 w-full">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-12 text-[#1d1d1d]">
            Comienza tu viaje de inversión
          </h2>

          <div className="max-w-2xl mx-auto bg-white rounded-xl overflow-hidden border-2 border-[#4d56f2]/40">
            {!isSubmitted ? (
              <div className="p-6 md:p-8">
                {/* Progress Bar */}
                <div className="w-full bg-gray-200 h-2 rounded-full mb-8">
                  <div
                    className="bg-[#4d56f2] h-2 rounded-full transition-all duration-500 ease-in-out"
                    style={{
                      width: `${((currentStep + 1) / questions.length) * 100}%`,
                    }}
                  ></div>
                </div>

                {/* Form Steps */}
                <div className="relative min-h-[300px]">
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
                      <h3 className="text-xl md:text-2xl font-semibold mb-6 text-[#1d1d1d]">
                        {question.label}
                      </h3>

                      {question.type === "text" ||
                      question.type === "email" ||
                      question.type === "tel" ? (
                        <Input
                          type={question.type}
                          value={question.value}
                          onChange={(e) =>
                            handleInputChange(question.id, e.target.value)
                          }
                          className="w-full p-3 text-lg border-2 border-gray-300 rounded-lg focus:border-[#4d56f2] focus:ring-[#4d56f2]"
                          placeholder={`Ingresa tu ${question.label.toLowerCase()}`}
                          required={question.required}
                        />
                      ) : question.type === "radio" ? (
                        <RadioGroup
                          value={question.value}
                          onValueChange={(value) =>
                            handleInputChange(question.id, value)
                          }
                          className="space-y-4"
                        >
                          {question.options?.map((option) => (
                            <div
                              key={option.value}
                              className="flex items-center space-x-2"
                            >
                              <RadioGroupItem
                                id={`${question.id}-${option.value}`}
                                value={option.value}
                                className="h-5 w-5 border-2 text-[#4d56f2]"
                              />
                              <Label
                                htmlFor={`${question.id}-${option.value}`}
                                className="text-lg font-medium cursor-pointer"
                              >
                                {option.label}
                              </Label>
                            </div>
                          ))}
                        </RadioGroup>
                      ) : null}
                    </div>
                  ))}
                </div>

                {/* Navigation Buttons */}
                <div className="flex justify-between mt-12">
                  <Button
                    type="button"
                    onClick={prevStep}
                    disabled={currentStep === 0}
                    variant="outline"
                    className="px-6 py-2 border-2 border-[#4d56f2] text-[#4d56f2] disabled:opacity-50"
                  >
                    Anterior
                  </Button>

                  <Button
                    type="button"
                    onClick={nextStep}
                    disabled={!isCurrentQuestionAnswered() || isSubmitting}
                    className="px-6 py-2 bg-[#4d56f2] hover:bg-[#4d56f2]/90 text-white disabled:opacity-50"
                  >
                    {currentStep === questions.length - 1
                      ? isSubmitting
                        ? "Enviando..."
                        : "Enviar"
                      : "Siguiente"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="p-8 text-center">
                <div className="w-16 h-16 bg-[#d8e710] rounded-full flex items-center justify-center mx-auto mb-6">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-10 w-10 text-[#1d1d1d]"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
                <h3 className="text-2xl font-bold text-[#1d1d1d] mb-4">
                  ¡Gracias por tu interés!
                </h3>
                <p className="text-lg text-gray-700 mb-6">
                  Hemos recibido tu información y un asesor se pondrá en
                  contacto contigo pronto a través de{" "}
                  {formData.contactMethod === "whatsapp"
                    ? "WhatsApp"
                    : "una llamada telefónica"}
                  .
                </p>
                <Button
                  onClick={() => {
                    setIsSubmitted(false);
                    setCurrentStep(0);
                    setFormData({
                      fullName: "",
                      phoneNumber: "",
                      email: "",
                      hasInvested: "",
                      hasBankAccount: "",
                      investmentRange: "",
                      contactMethod: "",
                    });
                  }}
                  className="bg-[#4d56f2] hover:bg-[#4d56f2]/90 text-white"
                >
                  Volver al inicio
                </Button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section
        ref={reviewsRef}
        id="reviews"
        className="min-h-[calc(var(--vh,1vh)*100)] py-16 md:py-24 flex items-center justify-center bg-[#f8f8f8]"
      >
        <div className="container mx-auto px-4 w-full">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-12 text-[#1d1d1d]">
            Lo que dicen nuestros inversionistas
          </h2>

          <div className="grid md:grid-cols-3 gap-8">
            {testimonials.map((testimonial, index) => (
              <div key={index} className="bg-white p-6 rounded-xl shadow-md">
                <div className="flex mb-4">
                  {[...Array(5)].map((_, i) => (
                    <Star
                      key={i}
                      className={cn(
                        "h-5 w-5",
                        i < testimonial.rating
                          ? "text-[#d8e710] fill-[#d8e710]"
                          : "text-gray-300"
                      )}
                    />
                  ))}
                </div>
                <p className="text-gray-700 mb-4">"{testimonial.text}"</p>
                <p className="font-semibold text-[#1d1d1d]">
                  {testimonial.name}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="min-h-[calc(var(--vh,1vh)*100)] py-16 md:py-24 flex items-center justify-center bg-[#4d56f2] text-white">
        <div className="container mx-auto px-4 w-full">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-12">
            Nuestros números hablan por sí mismos
          </h2>

          <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            {stats.map((stat, index) => (
              <div key={index} className="text-center">
                <div className="bg-white/10 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
                  {stat.icon}
                </div>
                <h3 className="text-3xl md:text-4xl font-bold mb-2 text-[#d8e710]">
                  {stat.value}
                </h3>
                <p className="text-lg">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 bg-[#1d1d1d] text-white">
        <div className="container mx-auto px-4 text-center">
          <p className="mb-4">
            © {new Date().getFullYear()} Club Cash In. Todos los derechos
            reservados.
          </p>
          <p className="text-sm text-gray-400 mb-6">
            La inversión implica riesgos. El rendimiento pasado no garantiza
            resultados futuros.
          </p>
          <button
            onClick={scrollToTop}
            className="bg-[#4d56f2] text-white px-4 py-2 rounded-full text-sm hover:bg-[#4d56f2]/90 transition-colors"
          >
            Volver arriba
          </button>
        </div>
      </footer>
    </div>
  );
}
