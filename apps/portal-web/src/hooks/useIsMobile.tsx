// use is mobile hook
import { useState, useEffect } from "react";

export const MOBILE_WIDTH_THRESHOLD = 768;

export const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState<boolean>(false);

  useEffect(() => {
    const checkIsMobile = () => {
      setIsMobile(window.innerWidth <= MOBILE_WIDTH_THRESHOLD);
    };
    checkIsMobile();
    window.addEventListener("resize", checkIsMobile);
    return () => {
      window.removeEventListener("resize", checkIsMobile);
    };
  }, []);
  return isMobile;
};
