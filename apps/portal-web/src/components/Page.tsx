import { Footer } from "@/features";
import React, { type FC } from "react";
import { useIsMobile } from "@/hooks";

interface PageProps {
  children?: React.ReactNode;
  url?: string;
}

export const Page: FC<PageProps> = ({ children, url = "/Layer_1.svg" }) => {
  const isMobile = useIsMobile();

  return (
    <div
      className="flex flex-col gap-4 bg-dark text-light min-h-screen"
      style={{
        backgroundImage: `url(${url})`,
         backgroundSize: isMobile ? "300% auto" : "100% auto",
        backgroundPosition: "center",
      }}
    >
      {children}
      <Footer />
    </div>
  );
};
