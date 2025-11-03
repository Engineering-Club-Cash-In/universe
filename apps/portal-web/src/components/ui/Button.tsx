import React from "react";
import { motion } from "framer-motion";

interface ButtonProps {
  children: string;
  size?: "lg" | "md" | "sm";
  onClick?: () => void;
  className?: string;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  size = "lg",
  onClick,
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
        font-semibold text-inherit cursor-pointer
        hover:border-0 hover:bg-[rgba(15,15,15,1)]
        active:border-0 active:bg-[rgba(15,15,15,1)]
        ${className}
      `}
    >
      {children}
    </motion.button>
  );
};

