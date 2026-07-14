import './globals.css';

export const metadata = {
  title: 'Seryn Digital — Giám sát thương hiệu',
  description: 'Dashboard giám sát thương hiệu Seryn Clinic trên Google, báo chí và mạng xã hội.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
