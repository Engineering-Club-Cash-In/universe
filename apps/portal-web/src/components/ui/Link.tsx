import React from "react";
import { Link as RouterLink } from "@tanstack/react-router";

interface LinkProps {
  href: string;
  children: React.ReactNode;
  className?: string;
  external?: boolean;
  ariaLabel?: string;
}

export const Link: React.FC<LinkProps> = ({
  href,
  children,
  className = "",
  external = false,
  ariaLabel,
}) => {
  const baseClasses = "hover:text-primary transition-color";
  const combinedClasses = `${baseClasses} ${className}`.trim();

  // Check if link is external
  const isExternal =
    external || href.startsWith("http") || href.startsWith("//");

  // Check if link is hash/anchor link
  const isHashLink = href.startsWith("#");

  // Handle hash/anchor links with smooth scroll
  if (isHashLink) {
    const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      const targetId = href.substring(1);
      const targetElement = document.getElementById(targetId);

      if (targetElement) {
        targetElement.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });

        // Update URL hash without jumping
        window.history.pushState(null, "", href);

        // Set focus for accessibility
        targetElement.focus({ preventScroll: true });
      }
    };

    return (
      <a
        href={href}
        onClick={handleClick}
        className={combinedClasses}
        aria-label={ariaLabel}
      >
        {children}
      </a>
    );
  }

  // External link
  if (isExternal) {
    return (
      <a
        href={href}
        className={combinedClasses}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={ariaLabel || `${children} (opens in new tab)`}
      >
        {children}
        <span className="sr-only"> (opens in new tab)</span>
      </a>
    );
  }

  // Internal link with router
  return (
    <RouterLink to={href} className={combinedClasses} aria-label={ariaLabel}>
      {children}
    </RouterLink>
  );
};
