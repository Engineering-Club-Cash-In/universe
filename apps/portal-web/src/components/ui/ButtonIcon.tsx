import { motion } from "framer-motion";
import React, { useState } from "react";

interface ButtonIconProps {
  children: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  className?: string;
  variant?: "lg" | "md" | "sm";
}

export const ButtonIcon: React.FC<ButtonIconProps> = ({
  children,
  icon,
  onClick,
  className = "",
  variant = "lg",
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
      onClick={onClick}
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
      onTapStart={() => setIsPressed(true)}
      onTap={() => setIsPressed(false)}
      onTapCancel={() => setIsPressed(false)}
      whileHover={{
        scale: 1.02,
        backgroundColor: "#c4c4c4",
        color: "#0F0F0F",
      }}
      whileTap={{
        scale: 0.98,
        color: "#0F0F0F",
      }}
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
        cursor-pointer
        gap-2
        ${className}
      `}
    >
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
    </motion.button>
  );
};
