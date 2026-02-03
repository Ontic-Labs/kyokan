"use client";

import { useEffect, useRef } from "react";

export default function RedocPrint() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js";
    script.async = true;
    script.onload = () => {
      const readToken = (name: string) =>
        getComputedStyle(document.documentElement)
          .getPropertyValue(name)
          .trim();
      const redoc = (window as unknown as { Redoc?: { init: (specUrl: string, options: Record<string, unknown>, container: HTMLElement) => void } }).Redoc;
      if (containerRef.current && redoc) {
        redoc.init(
          "/openapi.json",
          {
            scrollYOffset: 0,
            hideDownloadButton: true,
            expandResponses: "200",
            nativeScrollbars: true,
            hideRightPanel: true,
            theme: {
              breakpoints: {
                small: "50rem",
                medium: "75rem",
                large: "105rem",
              },
              colors: {
                primary: {
                  main: readToken("--token-interactive-primary"),
                },
                text: {
                  primary: readToken("--token-text-primary"),
                  secondary: readToken("--token-text-secondary"),
                },
                http: {
                  get: readToken("--token-status-success"),
                  post: readToken("--token-status-info"),
                  put: readToken("--token-status-warning"),
                  delete: readToken("--token-status-error"),
                },
              },
              typography: {
                fontSize: "14px",
                fontFamily: "ui-sans-serif, system-ui, sans-serif",
                headings: {
                  fontFamily: "ui-sans-serif, system-ui, sans-serif",
                },
                code: {
                  fontSize: "13px",
                  fontFamily: "ui-monospace, monospace",
                },
              },
              sidebar: {
                backgroundColor: readToken("--token-surface-nav"),
                textColor: readToken("--token-text-primary"),
                width: "260px",
              },
            },
          },
          containerRef.current
        );

        setTimeout(() => {
          window.print();
        }, 750);
      }
    };
    document.body.appendChild(script);

    return () => {
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="min-h-screen w-full"
      style={{ backgroundColor: "var(--token-surface)" }}
    />
  );
}
