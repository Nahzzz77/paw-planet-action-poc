import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '小爪星球 · 宠物互动 POC',
  description: '点击动作、播放预制成片并自动回到待机的虚拟宠物 Web POC。',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
