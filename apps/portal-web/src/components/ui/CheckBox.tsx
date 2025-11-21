import { IconCheck } from "@components/icons";
import { motion } from "framer-motion";
import React from "react";

interface CheckBoxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string | React.ReactNode;
  className?: string;
  isLabelLink?: boolean;
  labelHref?: string;
}

export const CheckBox: React.FC<CheckBoxProps> = ({
  checked,
  onChange,
  label,
  className = "",
  isLabelLink = false,
  labelHref,
}) => {
  console.log("CheckBox - checked:", checked, "onChange:", typeof onChange);
  
  const handleToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    console.log("Toggle clicked, current checked:", checked, "new value:", !checked);
    onChange(!checked);
  };

  return (
    <label className={`flex items-center gap-3 cursor-pointer ${className}`}>
      <motion.div
        onClick={handleToggle}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        transition={{
          type: "spring",
          stiffness: 400,
          damping: 17,
        }}
        className="relative w-[18px] h-[18px] flex items-center justify-center cursor-pointer"
      >
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
          transition={{ duration: 0.2 }}
          className={`absolute inset-0 ${checked ? "[&>svg>path]:fill-secondary" : ""}`}
        >
          <IconCheck />
        </motion.div>
        {!checked && <IconCheck />}
      </motion.div>
      {label && (
        <>
          {isLabelLink && labelHref ? (
            <a
              href={labelHref}
              target="_blank"
              rel="noopener noreferrer"
              className="font-[Hero] text-[16px] select-none underline hover:text-white/80 transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              {label}
            </a>
          ) : isLabelLink ? (
            <span
              className="font-[Hero] text-[16px] select-none underline cursor-pointer hover:text-white/80 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                // Si no hay href, solo actúa como texto decorativo
              }}
            >
              {label}
            </span>
          ) : (
            <span
              className="font-[Hero] text-sm select-none cursor-pointer"
              onClick={handleToggle}
            >
              {label}
            </span>
          )}
        </>
      )}
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => {
          console.log("Input onChange triggered:", e.target.checked);
          onChange(e.target.checked);
        }}
        className="sr-only"
      />
    </label>
  );
};
