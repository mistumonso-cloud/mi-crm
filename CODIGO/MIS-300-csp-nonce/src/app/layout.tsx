import type { Metadata } from "next";
import { connection } from "next/server";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Vibe Coder CRM",
  description: "CRM minimalista para pequeños negocios de ventas digitales.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // MIS-300 (M2): el nonce por petición (CSP en src/proxy.ts) exige render
  // dinámico: una página prerenderizada en build se generó sin conocer el nonce,
  // así que sus <script> no lo llevan y el navegador los bloquea. connection()
  // corta el prerender de TODO el árbol (incluida la not-found por defecto), que
  // pasa a renderizarse por petición con el nonce del proxy. Ver
  // node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md.
  await connection();
  return (
    <html
      lang="es"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
