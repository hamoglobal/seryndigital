import './globals.css';

export const metadata = {
  title: 'Seryn Digital — AI AUTO RESEARCH',
  description: 'Hệ thống lắng nghe & cảnh báo tín hiệu truyền thông trên Google, báo chí và mạng xã hội.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
