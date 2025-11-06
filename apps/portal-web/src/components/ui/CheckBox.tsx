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
  return (
    <label className={`flex items-center gap-3 cursor-pointer ${className}`}>
      <motion.div
        onClick={() => onChange(!checked)}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        transition={{
          type: "spring",
          stiffness: 400,
          damping: 17,
        }}
        className="relative w-[18px] h-[18px] flex items-center justify-center"
      >
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
          transition={{ duration: 0.2 }}
          className={`absolute inset-0 ${checked ? "[&>svg>path]:fill-primary" : ""}`}
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
          ) : (
            <span className="font-[Hero] text-sm select-none">{label}</span>
          )}
        </>
      )}
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
    </label>
  );
};
