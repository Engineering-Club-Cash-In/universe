import React from "react";

export const Link: React.FC<{ href: string; children: React.ReactNode }> = ({
  href,
  children,
}) => {
  return (
    <a href={href} className="hover:text-primary transition-colors">
      {children}
    </a>
  );
};
