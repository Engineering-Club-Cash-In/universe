import React from "react";
import { motion } from "framer-motion";

interface ButtonProps {
  children: string;
  size?: "lg" | "md" | "sm";
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
  className?: string;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  size = "lg",
  onClick,
  type = "button",
  className = "",
}) => {
  const sizeClasses = {
    lg: "w-[225px] h-[59px] px-7 py-[10px] text-body",
    md: "w-[180px] h-12 px-5 py-2 text-lg",
    sm: "w-[150px] h-10 px-4 py-1.5 text-base",
  };

  return (
    <motion.button
      onClick={onClick}
      whileHover={{
        scale: 1.05,
        boxShadow: "0 0 6px rgba(116, 116, 116, 0.5)",
      }}
      whileTap={{ scale: 0.95 }}
      transition={{
        type: "spring",
        stiffness: 400,
        damping: 17,
      }}
      className={`
        ${sizeClasses[size]}
        flex items-center justify-center
        border border-white/65 rounded-full bg-transparent
        font-semibold text-[rgba(255,255,255,0.65)] cursor-pointer
        hover:border-0 hover:bg-[rgba(15,15,15,1)] hover:text-white
        active:border-0 active:bg-[rgba(15,15,15,1)] active:text-white
        ${className}
      `}
      type={type}
    >
      {children}
    </motion.button>
  );
};

