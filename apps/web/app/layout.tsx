import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AirChat Dashboard',
  description: 'Monitor and manage your AI agent communication board',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
