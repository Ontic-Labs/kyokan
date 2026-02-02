"use client";

import SwaggerUIReact from "swagger-ui-react";
import "swagger-ui-react/swagger-ui.css";

export default function SwaggerUI() {
  return (
    <SwaggerUIReact
      url="/api/openapi"
      persistAuthorization={true}
      tryItOutEnabled={true}
      displayRequestDuration={true}
      docExpansion="list"
      defaultModelsExpandDepth={-1}
    />
  );
}
