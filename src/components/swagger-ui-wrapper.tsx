"use client";

import dynamic from "next/dynamic";
import { UI_STRINGS } from "@/constants/ui-strings";

const SwaggerUI = dynamic(() => import("@/components/swagger-ui"), {
  ssr: false,
  loading: () => (
    <div className="py-12 text-center text-text-muted">
      {UI_STRINGS.swagger.loading}
    </div>
  ),
});

export default function SwaggerUIWrapper() {
  return <SwaggerUI />;
}
