import Link from "next/link";
import type { ReactNode } from "react";

export default function InternoLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <nav>
        <strong>RutaSur</strong>
        <Link href="/">Torre de control</Link>
        <Link href="/analitica">Analítica</Link>
        <Link href="/demo">Demo</Link>
      </nav>
      <main>{children}</main>
    </>
  );
}