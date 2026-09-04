import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '小爪星球 · 宠物互动 POC',
  description: '上传宠物照片准备生成统一卡通母版，并体验待机、舔爪、喂食和摸头动作的虚拟宠物 Web POC。',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
