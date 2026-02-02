"use client";

import dynamic from "next/dynamic";

const SwaggerUI = dynamic(() => import("@/components/swagger-ui"), {
  ssr: false,
  loading: () => (
    <div className="py-12 text-center text-text-muted">
      Loading API documentation...
    </div>
  ),
});

export default function SwaggerUIWrapper() {
  return <SwaggerUI />;
}
