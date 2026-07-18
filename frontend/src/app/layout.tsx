import type { ReactNode } from "react";
import { SolanaWalletProvider } from "@/components/wallet/SolanaWalletProvider";
import "./globals.css";
import "@solana/wallet-adapter-react-ui/styles.css";

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <title>Quadratic Market | TxLINE sports odds</title>
        <meta
          name="description"
          content="Quadratic Market is a sports betting home for match odds, simple slips, and result checks powered by TxLINE odds."
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <SolanaWalletProvider>{children}</SolanaWalletProvider>
      </body>
    </html>
  );
}
