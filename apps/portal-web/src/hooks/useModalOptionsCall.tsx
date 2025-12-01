import type { ModalOption } from "@/components";
import { useState } from "react";

export const useModalOptionsCall = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const WAphoneNumber = import.meta.env.VITE_WHATSAPP_PHONE_NUMBER;
  const phoneNumber = import.meta.env.VITE_PHONE_NUMBER;
  const urlInspection = import.meta.env.VITE_URL_INSPECTION;

  // Funciones unificadas para acciones
  const openWhatsApp = (defaultMessage: string) => {
    globalThis.open(
      `https://api.whatsapp.com/send/?phone=${WAphoneNumber}&text=${encodeURIComponent(defaultMessage)}&type=phone_number&app_absent=0`,
      "_blank"
    );
    setIsModalOpen(false);
  };

  const makeCall = () => {
    globalThis.open(`tel:${phoneNumber}`, "_blank");
    setIsModalOpen(false);
  };

  const openInspection = () => {
    globalThis.open(urlInspection, "_blank");
    setIsModalOpen(false);
  };

  const modalOptionsInvestors: ModalOption[] = [
    {
      type: "whatsapp",
      title:
        "Puedes obtener más información y realizar el proceso para convertirte en inversionista a través de nuestro WhatsApp.",
      description: "",
      buttonText: "WhatsApp",
      buttonAction: () =>
        openWhatsApp(
          "Hola, estoy interesado en obtener más información sobre las oportunidades de inversión."
        ),
    },
    {
      type: "schedule",
      title:
        "También puedes hacer una cita con uno de nuestros agentes para aclarar toda la información que necesites y comenzar a ser un inversionista con nosotros.",
      description: "",
      buttonText: "Agendar cita",
      buttonAction: () => {
        // Navegar a la página de agendar cita
        setIsModalOpen(false);
      },
    },
  ];

  const optionCreditBuy: ModalOption = {
    type: "whatsapp",
    title:
      "Puedes obtener más información y realizar el proceso para obtener tu crédito vehicular a través de nuestro WhatsApp.",
    description: "",
    buttonText: "WhatsApp",
    buttonAction: () =>
      openWhatsApp(
        "Hola, estoy interesado en obtener más información sobre el crédito vehicular."
      ),
  };

  const optionCreditSell: ModalOption = {
    type: "whatsapp",
    title:
      "Puedes obtener más información y realizar el proceso para vender tu auto a través de nuestro WhatsApp.",
    description: "",
    buttonText: "WhatsApp",
    buttonAction: () =>
      openWhatsApp(
        "Hola, estoy interesado en obtener más información sobre la venta de mi auto."
      ),
  };

  const optionCrediQuestions: ModalOption = {
    type: "whatsapp",
    title:
      "Puedes obtener más información y resolver tus dudas sobre nuestros créditos a través de nuestro WhatsApp.",
    description: "",
    buttonText: "WhatsApp",
    buttonAction: () =>
      openWhatsApp("Hola, tengo algunas preguntas sobre los créditos que ofrecen."),
  };

  const optionInspection: ModalOption = {
    type: "link",
    title:
      "Puedes programar una inspección de tu vehículo a través de nuestro sistema en línea.",
    description: "",
    buttonText: "Iniciar inspección",
    buttonAction: openInspection,
  };

  const optionAgendarCita: ModalOption = {
    type: "whatsapp",
    title:
      "También puedes agendar una cita con uno de nuestros agentes para aclarar toda la información que necesites sobre nuestros créditos.",
    description: "",
    buttonText: "WhatsApp",
    buttonAction: () =>
      openWhatsApp(
        "Hola, me gustaría agendar una cita para inspeccionar mi vehículo y obtener más información sobre sus créditos."
      ),
  };

  const optionSellQuestions: ModalOption[] = [
    {
      type: "whatsapp",
      title:
        "Puedes obtener más información y resolver tus dudas sobre la venta de tu auto a través de nuestro WhatsApp.",
      description: "",
      buttonText: "WhatsApp",
      buttonAction: () =>
        openWhatsApp("Hola, tengo algunas preguntas sobre la venta de mi auto."),
    },
    {
      type: "call",
      title:
        "También puedes llamarnos directamente para resolver tus dudas sobre la venta de tu auto.",
      description: "",
      buttonText: "Llamar ahora",
      buttonAction: makeCall,
    },
  ];

  const optionPayment: ModalOption = {
    type: "whatsapp",
    title:
      "Puedes obtener más información y realizar el proceso de pago del crédito a través de nuestro WhatsApp.",
    description: "",
    buttonText: "WhatsApp",
    buttonAction: () =>
      openWhatsApp("Hola, quiero realizar el pago de mi crédito vehicular."),
  };

  const optionCreditVehicle: ModalOption = {
    type: "whatsapp",
    title:
      "Puedes obtener más información y realizar el proceso para obtener tu crédito vehicular a través de nuestro WhatsApp.",
    description: "",
    buttonText: "WhatsApp",
    buttonAction: () =>
      openWhatsApp(
        "Hola, estoy interesado en obtener más información sobre el crédito vehicular."
      ),
  };
  
  return {
    isModalOpen,
    setIsModalOpen,
    modalOptionsInvestors,
    optionsCredit: {
      buy: optionCreditBuy,
      sell: optionCreditSell,
      questions: optionCrediQuestions,
    },
    optionsSell: {
      inspection: optionInspection,
      schedule: optionAgendarCita,
      questions: optionSellQuestions,
    },
    optionPayment,
    optionCreditVehicle,
    openWhatsApp,
    makeCall
  };
};
