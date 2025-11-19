import React from 'react';

interface InputIconProps {
  icon: React.ReactNode;
  placeholder?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
  name?: string;
}

export const InputIcon: React.FC<InputIconProps> = ({
  icon,
  placeholder,
  value,
  onChange,
  type = 'text',
  name,
}) => {
  return (
    <div
      className="relative w-full flex items-center rounded-lg text-[#6B7280]"
      style={{
        border: '0 solid #E5E7EB',
        background: '#F9FAFB',
        height: '58px',
        padding: '16px',
      }}
    >
      <div className="flex items-center mr-3">
        {icon}
      </div>
      <input
        type={type}
        name={name}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        className="flex-1 bg-transparent border-0 outline-none"
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
        }}
      />
    </div>
  );
};
