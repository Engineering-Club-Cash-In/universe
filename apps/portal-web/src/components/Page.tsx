import React, { type FC } from "react";

interface PageProps {
  children?: React.ReactNode;
}

export const Page: FC<PageProps> = ({ children }) => {
  return (
    <div
     className="p-6 flex flex-col gap-4 bg-dark text-light min-h-screen"
      style={{
        backgroundImage: "url(/Layer_1.svg)",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }}
    >
      {children}
    </div>
  );
};
