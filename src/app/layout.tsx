import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'AdAsset Map — управление конструкциями',
  description: 'Карта, осмотры и обслуживание рекламных конструкций',
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
