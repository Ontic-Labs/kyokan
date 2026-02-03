"use client";

import { useState } from "react";
import KeyClaimModal from "./key-claim-modal";

export default function GetApiKeyButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="px-4 py-2 bg-accent-primary text-white rounded-md font-medium hover:bg-accent-primary/90 transition-colors"
      >
        Get API Key
      </button>
      <KeyClaimModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}
