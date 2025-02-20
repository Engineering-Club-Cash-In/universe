"use client";

import CCILogo from "/assets/landing/cci-logo.svg";
import InstagramIcon from "/assets/landing/ig.svg";
import FacebookIcon from "/assets/landing/fb.svg";
import TwitterIcon from "/assets/landing/x.svg";
import YoutubeIcon from "/assets/landing/yt.svg";
import LinkedInIcon from "/assets/landing/in.svg";
import NextArrowIcon from "/assets/landing/next-arrow.svg";
import PreviousArrowIcon from "/assets/landing/prev-arrow.svg";
import ChecklistIcon from "/assets/landing/checklist.svg";
import StopwatchIcon from "/assets/landing/stopwatch.svg";
import CustomInput from "../components/sections/landing/custominput";
import CustomButton from "../components/sections/landing/custombutton";
import DPIIcon from "/assets/landing/dpi.svg";
import CashIcon from "/assets/landing/cash.svg";
import CalendarIcon from "/assets/landing/calendar.svg";
import { Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";

function App() {
  const slides = [
    {
      title: "Tranki",
      description: "¿Qué es Tranki?",
      image: null,
      text: "Es el nuevo producto que Club Cash In pone a tu disposición para que apliques a un crédito al alcance de tu mano.",
    },
    {
      title: ChecklistIcon,
      description: "¿Qué necesitas para aplicar?",
      image: null,
      text: [
        "Tomar una foto de ambos lados de tu DPI, que debe estar vigente y en buen estado",
        "Tus últimos 3 estados de cuenta, donde se reflejen tus movimientos monetarios usuales",
      ],
    },
    {
      title: StopwatchIcon,
      description: "Obten tu crédito de forma rápida y sencilla",
      image: null,
      text: [
        "El proceso de solicitud es rápido y sencillo, y el tiempo de respuesta es de 24 horas hábiles.",
      ],
    },
    {
      title: "Tranki",
      description: "Un producto de la familia",
      image: CCILogo,
      text: "Tranki cuenta con el apoyo, el respaldo y la solidez de Club Cash In",
    },
    // Add more slides as needed
  ];

  // "activeSlide" is the currently displayed slide.
  // "targetSlide" is the slide we're transitioning to.
  // "direction" shows which way we want to slide ("left" for previous, "right" for next).
  // "animate" is used to trigger the CSS transitions.
  const [activeSlide, setActiveSlide] = useState(0);
  const [targetSlide, setTargetSlide] = useState<number | null>(null);
  const [direction, setDirection] = useState<"left" | "right" | null>(null);
  const [animate, setAnimate] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(true);
  const [inputs, setInputs] = useState<
    {
      icon: string;
      label: string;
      placeholder: string;
      value: string;
    }[]
  >([
    {
      icon: DPIIcon,
      label: "dpi",
      placeholder: "DPI",
      value: "",
    },
    {
      icon: CashIcon,
      label: "monto",
      placeholder: "Monto",
      value: "",
    },
    {
      icon: CalendarIcon,
      label: "plazo",
      placeholder: "Plazo",
      value: "",
    },
  ]);

  // Once the targetSlide is set, trigger the animation in the next tick.
  useEffect(() => {
    if (targetSlide !== null) {
      const timer = setTimeout(() => setAnimate(true), 20);
      return () => clearTimeout(timer);
    }
  }, [targetSlide]);

  // Once the animation is complete (300ms), update the active slide.
  useEffect(() => {
    if (animate && targetSlide !== null) {
      const timer = setTimeout(() => {
        setActiveSlide(targetSlide);
        setTargetSlide(null);
        setAnimate(false);
        setDirection(null);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [animate, targetSlide]);

  const currentSlide = slides[activeSlide];
  const incomingSlide = targetSlide !== null ? slides[targetSlide] : null;

  // Determine transform classes.
  // The current (active) slide:
  // • If we're transitioning, slide it offscreen (left if direction "right", right if "left")
  // • Otherwise, stay centered.
  const activeSlideClass =
    targetSlide !== null && animate && direction
      ? direction === "right"
        ? "-translate-x-full"
        : "translate-x-full"
      : "translate-x-0";

  // The incoming slide:
  // • When not yet animating (animate is false), it starts offscreen on the correct side.
  // • Once animate=true, it transitions to the center ("translate-x-0").
  const incomingSlideClass =
    targetSlide !== null && direction
      ? !animate
        ? direction === "right"
          ? "translate-x-full"
          : "-translate-x-full"
        : "translate-x-0"
      : "";

  const nextSlideFunc = () => {
    if (targetSlide !== null) return; // prevent if already transitioning
    setDirection("right");
    setTargetSlide((activeSlide + 1) % slides.length);
  };

  const prevSlideFunc = () => {
    if (targetSlide !== null) return;
    setDirection("left");
    setTargetSlide((activeSlide - 1 + slides.length) % slides.length);
  };

  const closeModalFunc = () => {
    setIsModalOpen(false);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-between bg-gradient-to-br from-purple-500 to-purple-700 text-white text-[calc(10px+2vmin)]">
      <header className="w-full p-8 max-w-screen-2xl">
        <div className="flex flex-row w-full items-center justify-between">
          <span className="text-3xl font-bold">Tranki</span>
          <span className="text-lg font-bold">
            <Link to="/register">Ingresar</Link>
          </span>
        </div>
      </header>
      <main className="w-full flex items-center justify-center max-w-screen-2xl">
        {isModalOpen && (
          <div className="flex flex-col w-2/5 min-h-[400px] max-h-[400px] pb-20 items-center justify-center bg-white drop-shadow-xl rounded-lg relative overflow-hidden">
            <div className="w-full flex items-center justify-end">
              <button
                className="absolute top-0 right-4 py-4 text-purple hover:text-purple-600 transition-colors cursor-pointer z-10"
                aria-label="Close introduction modal"
                onClick={closeModalFunc}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
            {/* Active Slide Container */}
            <div
              key={`slide-${activeSlide}-current`}
              className={`absolute top-0 left-0 w-full h-full flex transition-transform duration-300 ${activeSlideClass}`}
            >
              <div className="flex flex-col w-full h-full pt-4 items-center justify-center gap-3">
                {!currentSlide.title.toString().includes("svg") ? (
                  <span className="text-3xl font-bold text-purple">
                    {currentSlide.title}
                  </span>
                ) : (
                  <img
                    src={currentSlide.title || "/placeholder.svg"}
                    alt="slide-title"
                    className="w-1/5"
                  />
                )}
                <p className="text-xl font-extrabold text-black">
                  {currentSlide.description}
                </p>
                {currentSlide.image && (
                  <img
                    src={currentSlide.image || "/placeholder.svg"}
                    alt="slide-image"
                    className="w-1/4"
                  />
                )}
                {Array.isArray(currentSlide.text) ? (
                  <ul className="text-base text-black/70 text-left w-3/5 list-disc">
                    {currentSlide.text.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-base text-black/70 text-center w-3/5">
                    {currentSlide.text}
                  </p>
                )}
              </div>
            </div>
            {/* Incoming Slide Container */}
            {incomingSlide !== null && (
              <div
                key={`slide-${targetSlide}-incoming`}
                className={`absolute top-0 left-0 w-full h-full flex transition-transform duration-300 ${incomingSlideClass}`}
              >
                <div className="flex flex-col w-full h-full pt-4 items-center justify-center gap-3">
                  {!incomingSlide.title.toString().includes("svg") ? (
                    <span className="text-3xl font-bold text-purple">
                      {incomingSlide.title}
                    </span>
                  ) : (
                    <img
                      src={incomingSlide.title || "/placeholder.svg"}
                      alt="slide-title"
                      className="w-1/5"
                    />
                  )}
                  <p className="text-xl font-extrabold text-black">
                    {incomingSlide.description}
                  </p>
                  {incomingSlide.image && (
                    <img
                      src={incomingSlide.image || "/placeholder.svg"}
                      alt="slide-image"
                      className="w-1/4"
                    />
                  )}
                  {Array.isArray(incomingSlide.text) ? (
                    <ul className="text-base text-black/70 text-left w-3/5 list-disc">
                      {incomingSlide.text.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-base text-black/70 text-center w-3/5">
                      {incomingSlide.text}
                    </p>
                  )}
                </div>
              </div>
            )}
            <button
              onClick={prevSlideFunc}
              className="absolute left-0 pl-5 hover:scale-150 transition-transform"
            >
              <img
                src={PreviousArrowIcon || "/placeholder.svg"}
                alt="previous-arrow"
              />
            </button>
            <button
              onClick={nextSlideFunc}
              className="absolute h-1/2 right-0 mr-5 hover:scale-150 transition-transform"
            >
              <img src={NextArrowIcon || "/placeholder.svg"} alt="next-arrow" />
            </button>
            <div className="absolute w-full bottom-4">
              <div className="flex flex-row gap-2 absolute bottom-0 w-full justify-center px-4">
                {slides.map((_, index) => (
                  <div
                    key={index}
                    className={`w-2 h-2 rounded-full ${
                      activeSlide === index ? "bg-purple" : "bg-purple/50"
                    }`}
                  ></div>
                ))}
              </div>
            </div>
          </div>
        )}
        {!isModalOpen && (
          <div className="w-full h-full flex flex-col px-10 items-center justify-center gap-10">
            <span className="text-3xl font-bold">
              Solicita tu crédito, Tranki
            </span>
            <div className="grid grid-cols-4 gap-3">
              {[0, 1, 2].map((item) => (
                <CustomInput
                  key={item}
                  icon={inputs[item].icon}
                  label={inputs[item].label}
                  placeholder={inputs[item].placeholder}
                  value={inputs[item].value}
                  onChange={(value) => {
                    setInputs(
                      inputs.map((input, index) =>
                        index === item ? { ...input, value } : input
                      )
                    );
                  }}
                />
              ))}
              <CustomButton
                text="Solicitar"
                to={`/register?dpi=${inputs[0].value}&monto=${inputs[1].value}&plazo=${inputs[2].value}`}
              />
            </div>
          </div>
        )}
      </main>
      <footer className="w-full pb-10 max-w-screen-2xl">
        <div className="flex flex-col w-full gap-12 items-center justify-between">
          <span className="text-3xl font-bold">Tranki</span>
          <div className="flex flex-row items-center justify-center gap-16">
            <a href="#">
              <img src={InstagramIcon || "/placeholder.svg"} alt="instagram" />
            </a>
            <a href="#">
              <img src={FacebookIcon || "/placeholder.svg"} alt="facebook" />
            </a>
            <a href="#">
              <img src={TwitterIcon || "/placeholder.svg"} alt="twitter" />
            </a>
            <a href="#">
              <img src={YoutubeIcon || "/placeholder.svg"} alt="youtube" />
            </a>
            <a href="#">
              <img src={LinkedInIcon || "/placeholder.svg"} alt="linkedin" />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
