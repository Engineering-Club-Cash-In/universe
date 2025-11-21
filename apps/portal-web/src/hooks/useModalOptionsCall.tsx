import type { ModalOption } from "@/components";
import { useState } from "react";

export const useModalOptionsCall = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const phoneNumber = import.meta.env.VITE_WHATSAPP_PHONE_NUMBER;
  const urlInspection = import.meta.env.VITE_URL_INSPECTION;

  const modalOptionsInvestors: ModalOption[] = [
    {
      type: "whatsapp",
      title:
        "Puedes obtener más información y realizar el proceso para convertirte en inversionista a través de nuestro WhatsApp.",
      description: "",
      buttonText: "WhatsApp",
      buttonAction: () => {
        const defaultMessage =
          "Hola, estoy interesado en obtener más información sobre las oportunidades de inversión.";
        window.open(
          `https://api.whatsapp.com/send/?phone=${phoneNumber}&text=${encodeURIComponent(defaultMessage)}&type=phone_number&app_absent=0`,
          "_blank"
        );
        setIsModalOpen(false);
      },
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
    buttonAction: () => {
      const defaultMessage =
        "Hola, estoy interesado en obtener más información sobre el crédito vehicular.";
      window.open(
        `https://api.whatsapp.com/send/?phone=${phoneNumber}&text=${encodeURIComponent(defaultMessage)}&type=phone_number&app_absent=0`,
        "_blank"
      );
      setIsModalOpen(false);
    },
  };

  const optionCreditSell: ModalOption = {
    type: "whatsapp",
    title:
      "Puedes obtener más información y realizar el proceso para vender tu auto a través de nuestro WhatsApp.",
    description: "",
    buttonText: "WhatsApp",
    buttonAction: () => {
      const defaultMessage =
        "Hola, estoy interesado en obtener más información sobre la venta de mi auto.";
      window.open(
        `https://api.whatsapp.com/send/?phone=${phoneNumber}&text=${encodeURIComponent(defaultMessage)}&type=phone_number&app_absent=0`,
        "_blank"
      );
      setIsModalOpen(false);
    },
  };

  const optionCrediQuestions: ModalOption = {
    type: "whatsapp",
    title:
      "Puedes obtener más información y resolver tus dudas sobre nuestros créditos a través de nuestro WhatsApp.",
    description: "",
    buttonText: "WhatsApp",
    buttonAction: () => {
      const defaultMessage =
        "Hola, tengo algunas preguntas sobre los créditos que ofrecen.";
      window.open(
        `https://api.whatsapp.com/send/?phone=${phoneNumber}&text=${encodeURIComponent(defaultMessage)}&type=phone_number&app_absent=0`,
        "_blank"
      );
      setIsModalOpen(false);
    },
  };

  const optionInspection: ModalOption = {
    type: "link",
    title:
      "Puedes programar una inspección de tu vehículo a través de nuestro sistema en línea.",
    description: "",
    buttonText: "Iniciar inspección",
    buttonAction: () => {
      window.open(urlInspection, "_blank");
      setIsModalOpen(false);
    },
  };

  const optionAgendarCita: ModalOption = {
    type: "whatsapp",
    title:
      "También puedes agendar una cita con uno de nuestros agentes para aclarar toda la información que necesites sobre nuestros créditos.",
    description: "",
    buttonText: "WhatsApp",
    buttonAction: () => {
      const defaultMessage =
        "Hola, me gustaría agendar una cita para inspeccionar mi vehículo y obtener más información sobre sus créditos.";
      window.open(
        `https://api.whatsapp.com/send/?phone=${phoneNumber}&text=${encodeURIComponent(defaultMessage)}&type=phone_number&app_absent=0`,
        "_blank"
      );
      setIsModalOpen(false);
    },
  };

  const optionSellQuestions: ModalOption = {
    type: "whatsapp",
    title:
      "Puedes obtener más información y resolver tus dudas sobre la venta de tu auto a través de nuestro WhatsApp.",
    description: "",
    buttonText: "WhatsApp",
    buttonAction: () => {
      const defaultMessage =
        "Hola, tengo algunas preguntas sobre la venta de mi auto.";
      window.open(
        `https://api.whatsapp.com/send/?phone=${phoneNumber}&text=${encodeURIComponent(defaultMessage)}&type=phone_number&app_absent=0`,
        "_blank"
      );
      setIsModalOpen(false);
    },
  };

  const optionPayment: ModalOption = {
    type: "whatsapp",
    title:
      "Puedes obtener más información y realizar el proceso de pago del crédito a través de nuestro WhatsApp.",
    description: "",
    buttonText: "WhatsApp",
    buttonAction: () => {
      const defaultMessage =
        "Hola, quiero realizar el pago de mi crédito vehicular.";
      window.open(
        `https://api.whatsapp.com/send/?phone=${phoneNumber}&text=${encodeURIComponent(defaultMessage)}&type=phone_number&app_absent=0`,
        "_blank"
      );
      setIsModalOpen(false);
    },
  }

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
  };
};
