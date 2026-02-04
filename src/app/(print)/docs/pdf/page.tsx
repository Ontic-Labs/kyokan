import RedocPrint from "@/components/redoc-print";

export const metadata = {
  title: "API Documentation (PDF)",
  description: "Printable API documentation for Kyokon.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function DocsPdfPage() {
  return (
    <div className="min-h-screen">
      <RedocPrint />
    </div>
  );
}
