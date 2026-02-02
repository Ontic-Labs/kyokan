"use client";

import { useState } from "react";
import NavLink from "./nav-link";

export default function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        className="sm:hidden p-2 text-text-secondary hover:text-text-primary"
        aria-label="Toggle navigation"
      >
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          {open ? (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          ) : (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 6h16M4 12h16M4 18h16"
            />
          )}
        </svg>
      </button>

      {open && (
        <div className="sm:hidden absolute top-14 left-0 right-0 bg-surface-nav border-b border-border-default shadow-sm z-50">
          <div className="flex flex-col px-4 py-3 gap-1" onClick={() => setOpen(false)}>
            <NavLink href="/foods">Foods</NavLink>
            <NavLink href="/categories">Categories</NavLink>
            <NavLink href="/nutrients">Nutrients</NavLink>
            <NavLink href="/docs">API Docs</NavLink>
          </div>
        </div>
      )}
    </>
  );
}
