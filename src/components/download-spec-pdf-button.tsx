"use client";

export default function DownloadSpecPdfButton() {
  const handleClick = () => {
    window.open("/docs/pdf", "_blank", "noopener,noreferrer");
  };

  return (
    <button
      onClick={handleClick}
      className="px-4 py-2 bg-interactive-secondary text-interactive-secondary-text rounded-md font-medium hover:bg-interactive-secondary-hover transition-colors"
    >
      Download PDF
    </button>
  );
}
