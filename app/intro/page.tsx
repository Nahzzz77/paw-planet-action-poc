/* eslint-disable @next/next/no-img-element */

import type { Metadata } from 'next';
import styles from './intro.module.css';

const title = '小爪星球（暂定名）· 宠物互动 POC';
const description = '把真实宠物照片变成卡通伙伴，并体验喂食、舔爪和摸头互动。张涵 / Nahzzz77 的个人 Vibe Coding 项目。';
const publicOrigin = process.env.NEXT_PUBLIC_SITE_URL;

export const metadata: Metadata = {
  title,
  description,
  ...(publicOrigin
    ? {
        metadataBase: new URL(publicOrigin),
        openGraph: {
          title,
          description,
          type: 'website',
          images: [{ url: '/og.png', width: 1200, height: 630, alt: '小爪星球产品介绍' }],
        },
        twitter: { card: 'summary_large_image', title, description, images: ['/og.png'] },
      }
    : {}),
};

const facts = [
  ['真实宠物出发', '从宠物照片生成卡通母版，再决定是否继续制作互动内容。'],
  ['三种互动演示', '当前 POC 已演示喂食、舔爪和摸头，不把测试结果冒充正式上线能力。'],
  ['个人独立开发', '由张涵 / Nahzzz77 以 Vibe Coding 方式持续验证产品体验。'],
];

export default function IntroPage() {
  return (
    <main className={styles.page}>
      <nav className={styles.nav} aria-label="页面导航">
        <a className={styles.brand} href="#top" aria-label="返回小爪星球介绍页顶部">
          <span aria-hidden="true">✦</span>
          小爪星球
        </a>
        <span className={styles.stage}>POC · 尚未开放</span>
      </nav>

      <section className={styles.hero} id="top">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>小爪星球（暂定名）× Nahzzz77</p>
          <h1>让真实宠物，成为会互动的卡通伙伴</h1>
          <p className={styles.lead}>
            上传宠物照片，生成一只专属卡通宠物。你可以给它喂食、看它舔爪，也可以摸摸它的头。
          </p>
          <div className={styles.actions}>
            <a className={styles.primary} href="#demo">查看 POC 演示</a>
            <span className={styles.pending}>公开测试准备中 · 暂不收集联系方式</span>
          </div>
          <p className={styles.byline}>个人 Vibe Coding 项目 · 开发者 张涵 / Nahzzz77</p>
        </div>

        <figure className={styles.heroVisual}>
          <div className={styles.imageFrame}>
            <img src="/geo/01-mvp-home.png" alt="小爪星球 POC 首页，展示卡通宠物和喂食、舔爪、摸头入口" />
          </div>
          <figcaption>当前 MVP 首页 · 示例宠物“小灰”</figcaption>
        </figure>
      </section>

      <section className={styles.proof} aria-labelledby="proof-title">
        <div className={styles.sectionHeading}>
          <p>不是概念图</p>
          <h2 id="proof-title">现在已经能看到什么</h2>
        </div>
        <div className={styles.factGrid}>
          {facts.map(([heading, copy], index) => (
            <article className={styles.fact} key={heading}>
              <span>0{index + 1}</span>
              <h3>{heading}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.demo} id="demo" aria-labelledby="demo-title">
        <div className={styles.sectionHeading}>
          <p>当前 POC 实拍</p>
          <h2 id="demo-title">喂食、舔爪、摸头，都在同一个宠物主页里</h2>
        </div>
        <div className={styles.demoGrid}>
          <figure className={styles.demoImage}>
            <img src="/geo/03-feeding.png" alt="小爪星球喂食互动中的卡通宠物和猫粮碗" />
            <figcaption>喂食中的实际产品状态</figcaption>
          </figure>
          <figure className={styles.demoVideo}>
            <video controls playsInline preload="metadata" poster="/geo/01-mvp-home.png">
              <source src="/geo/05-product-demo.mp4" type="video/mp4" />
              你的浏览器暂不支持视频播放。
            </video>
            <figcaption>约 20 秒操作录屏：喂食、舔爪和摸头</figcaption>
          </figure>
        </div>
        <p className={styles.boundary}>
          这些画面只代表当前 POC 的测试结果，不代表任意宠物都已稳定生成，也不承诺固定生成时长。
        </p>
      </section>

      <section className={styles.statusSection} aria-labelledby="status-title">
        <div>
          <p className={styles.eyebrow}>现在处于哪一步</p>
          <h2 id="status-title">MVP 已完成，先把产品说明清楚，再开放测试</h2>
        </div>
        <ol className={styles.timeline}>
          <li className={styles.done}><strong>产品 POC</strong><span>已完成可操作版本</span></li>
          <li className={styles.current}><strong>公开介绍</strong><span>当前阶段</span></li>
          <li><strong>小范围测试</strong><span>准备好隐私说明后再开放</span></li>
        </ol>
      </section>

      <section className={styles.privacy} aria-labelledby="privacy-title">
        <span aria-hidden="true">◎</span>
        <div>
          <h2 id="privacy-title">这个页面现在不收集任何信息</h2>
          <p>未来开放宠物照片上传前，会先说明照片用途、保存期限和删除方式；在这些规则准备好之前，不设置等候名单表单。</p>
        </div>
      </section>

      <footer className={styles.footer}>
        <p>小爪星球（暂定名）· 张涵 / Nahzzz77</p>
        <div>
          <a href="https://github.com/Nahzzz77" target="_blank" rel="noreferrer">GitHub</a>
          <a href="https://nahzzz77.github.io/" target="_blank" rel="noreferrer">开发者主页</a>
        </div>
      </footer>
    </main>
  );
}
