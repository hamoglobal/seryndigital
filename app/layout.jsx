import './globals.css';
import AuthProvider from '@/components/AuthProvider';

export const metadata = {
  title: 'Seryn Digital — AI AUTO RESEARCH',
  description: 'Hệ thống lắng nghe & cảnh báo tín hiệu truyền thông trên Google, báo chí và mạng xã hội.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
