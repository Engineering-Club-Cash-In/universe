import { motion } from "framer-motion";
import React, { useState } from "react";

interface ButtonIconProps {
  children: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  className?: string;
  variant?: "lg" | "md" | "sm";
  isLoading?: boolean;
}

export const ButtonIcon: React.FC<ButtonIconProps> = ({
  children,
  icon,
  onClick,
  className = "",
  variant = "lg",
  isLoading = false,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);

  const variantClasses = {
    lg: "h-[50px] px-[25px] py-[25.833px] text-[13.333px]",
    md: "h-[42px] px-[20px] py-[20px] text-[12px]",
    sm: "h-[36px] px-[16px] py-[16px] text-[11px]",
  };

  const iconColor = isHovered || isPressed ? "#0F0F0F" : "#747474";

  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={isLoading}
      onHoverStart={() => !isLoading && setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
      onTapStart={() => !isLoading && setIsPressed(true)}
      onTap={() => setIsPressed(false)}
      onTapCancel={() => setIsPressed(false)}
      whileHover={!isLoading ? {
        scale: 1.02,
        backgroundColor: "#c4c4c4",
        color: "#0F0F0F",
      } : {}}
      whileTap={!isLoading ? {
        scale: 0.98,
        color: "#0F0F0F",
      } : {}}
      transition={{
        type: "spring",
        stiffness: 400,
        damping: 17,
      }}
      className={`
        flex
        items-center
        justify-center
        w-full
        ${variantClasses[variant]}
        rounded-[12.5px]
        bg-[#D9D9D9]
        text-[#747474]
        font-[Hero]
        font-normal
        leading-[110%]
        tracking-[-0.267px]
        border-0
        outline-none
        gap-2
        ${isLoading ? 'cursor-wait opacity-70' : 'cursor-pointer'}
        ${className}
      `}
    >
      {isLoading ? (
        <div className="flex items-center gap-1">
          <motion.div
            className="w-2 h-2 bg-[#747474] rounded-full"
            animate={{ scale: [1, 1.2, 1], opacity: [1, 0.5, 1] }}
            transition={{ duration: 0.8, repeat: Infinity, delay: 0 }}
          />
          <motion.div
            className="w-2 h-2 bg-[#747474] rounded-full"
            animate={{ scale: [1, 1.2, 1], opacity: [1, 0.5, 1] }}
            transition={{ duration: 0.8, repeat: Infinity, delay: 0.15 }}
          />
          <motion.div
            className="w-2 h-2 bg-[#747474] rounded-full"
            animate={{ scale: [1, 1.2, 1], opacity: [1, 0.5, 1] }}
            transition={{ duration: 0.8, repeat: Infinity, delay: 0.3 }}
          />
        </div>
      ) : (
        <>
          {icon && (
            <span
              className="flex items-center justify-center transition-all duration-200 [&>svg]:transition-all [&>svg]:duration-200 [&>svg>path]:transition-all [&>svg>path]:duration-200"
              style={{ 
                color: iconColor,
              } as React.CSSProperties}
            >
              <div style={{ color: iconColor }} className="[&>svg>*]:stroke-current [&>svg>*]:fill-current">
                {icon}
              </div>
            </span>
          )}
          {children}
        </>
      )}
    </motion.button>
  );
};
