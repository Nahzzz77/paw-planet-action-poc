'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

type LoadState = 'loading' | 'ready' | 'error';
type PetAction = 'lick' | 'feed' | 'pet' | null;

const VIDEO = '/assets/cat-lick-paw.mp4';
const POSTER = '/assets/gray-cat-idle.png';

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const effectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [action, setAction] = useState<PetAction>(null);
  const [notice, setNotice] = useState('舔爪是真实成片；喂食和摸头是可操作的交互样机');
  const [bond, setBond] = useState(72);
  const [fullness, setFullness] = useState(66);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const ready = () => setLoadState('ready');
    const error = () => { setLoadState('error'); setNotice('舔爪视频加载失败，喂食和摸头仍可体验'); };
    video.addEventListener('loadeddata', ready);
    video.addEventListener('error', error);
    if (video.readyState >= 2) ready();
    return () => {
      video.removeEventListener('loadeddata', ready);
      video.removeEventListener('error', error);
      if (effectTimer.current) clearTimeout(effectTimer.current);
    };
  }, []);

  const playLick = async () => {
    const video = videoRef.current;
    if (!video || action || loadState !== 'ready') return;
    video.currentTime = 0;
    setAction('lick');
    setNotice('小灰正在认真清理小爪子……');
    try { await video.play(); }
    catch { setAction(null); setNotice('浏览器没有启动播放，请再点一次“舔爪”'); }
  };

  const finishLick = () => {
    const video = videoRef.current;
    if (video) { video.pause(); video.currentTime = 0; }
    setAction(null);
    setNotice('舔爪完成，小灰已回到待机状态');
  };

  const playInteraction = (next: Exclude<PetAction, 'lick' | null>) => {
    if (action) return;
    if (effectTimer.current) clearTimeout(effectTimer.current);
    setAction(next);
    setNotice(next === 'feed' ? '小灰闻到了香香的猫粮……' : '再轻轻摸两下，小灰很喜欢');
    effectTimer.current = setTimeout(() => {
      if (next === 'feed') {
        setFullness((value) => Math.min(100, value + 12));
        setNotice('喂食完成，饱腹度 +12');
      } else {
        setBond((value) => Math.min(100, value + 5));
        setNotice('摸头完成，亲密度 +5');
      }
      setAction(null);
      effectTimer.current = null;
    }, next === 'feed' ? 2700 : 2300);
  };

  const stateLabel = action === 'lick'
    ? '舔爪中'
    : action === 'feed'
      ? '喂食中'
      : action === 'pet'
        ? '摸头中'
        : loadState === 'loading'
          ? '加载成片'
          : loadState === 'error'
            ? '部分可用'
            : '待机中';
  const messageIcon = action === 'feed' ? '●' : action === 'pet' ? '♥' : action === 'lick' ? '✦' : '♡';
  const busy = action !== null;

  return (
    <main className="shell">
      <section className="phone" aria-label="小爪星球宠物互动 POC">
        <header className="header">
          <button className="round" type="button" aria-label="返回">‹</button>
          <div><span>我的宠物</span><h1>小灰</h1></div>
          <div className="proof"><i /> POC</div>
        </header>

        <section className={`stage action-${action ?? 'idle'}`} aria-label="宠物动作舞台">
          <div className="stageLight" />
          <div className={`state is-${action ?? loadState}`}><i /> {stateLabel}</div>

          {/* The poster is a local, fixed-size POC asset; no runtime image service is needed. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={action === 'lick' ? 'idlePet hidden' : 'idlePet'} src={POSTER} alt="灰色英国短毛猫小灰的待机形象" />
          <video ref={videoRef} className={action === 'lick' ? 'actionVideo visible' : 'actionVideo'} src={VIDEO} poster={POSTER} preload="auto" playsInline muted onEnded={finishLick} aria-label="小灰舔爪动作" />

          <button className="headHit" type="button" aria-label="直接摸小灰的头" disabled={busy} onClick={() => playInteraction('pet')}><span>轻点头部</span></button>

          <div className="feedFx" aria-hidden="true">
            <i className="kibble k1" /><i className="kibble k2" /><i className="kibble k3" />
            <div className="bowl"><span>● ● ●</span><b>HUI</b></div>
          </div>
          <div className="petFx" aria-hidden="true"><span className="petHand">🫳</span><i>♥</i><i>♥</i><i>♥</i></div>

          <div className="floor" />
          <div className="message" aria-live="polite"><span>{messageIcon}</span><p>{notice}</p></div>
        </section>

        <section className="vitals" aria-label="宠物状态">
          <div><span className="vitalIcon">♥</span><p><small>亲密度</small><strong>{bond}</strong></p><em style={{ '--value': `${bond}%` } as CSSProperties} /></div>
          <div><span className="vitalIcon">●</span><p><small>饱腹度</small><strong>{fullness}</strong></p><em style={{ '--value': `${fullness}%` } as CSSProperties} /></div>
          <div><span className="vitalIcon">◔</span><p><small>动作成片</small><strong>1 / 3</strong></p></div>
        </section>

        <nav className="actions" aria-label="宠物互动动作">
          <button type="button" className={action === 'feed' ? 'prototype active' : 'prototype'} disabled={busy} onClick={() => playInteraction('feed')}><span>🦴</span><strong>{action === 'feed' ? '喂食中' : '喂食'}</strong><small>交互样机</small></button>
          <button type="button" className={action === 'lick' ? 'ready active' : 'ready'} disabled={busy || loadState !== 'ready'} onClick={playLick}><span>🐾</span><strong>{action === 'lick' ? '播放中' : '舔爪'}</strong><small>真实成片</small></button>
          <button type="button" className={action === 'pet' ? 'prototype active' : 'prototype'} disabled={busy} onClick={() => playInteraction('pet')}><span>♡</span><strong>{action === 'pet' ? '摸摸中' : '摸头'}</strong><small>交互样机</small></button>
        </nav>

        <footer className="honesty"><i /><p><strong>三个入口都已可操作</strong><span>舔爪播放真实 MP4；喂食与摸头先验证交互、状态和数值，待同角色成片完成后原位替换。</span></p></footer>
      </section>
    </main>
  );
}
