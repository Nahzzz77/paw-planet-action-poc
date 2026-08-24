'use client';

import { useEffect, useRef, useState } from 'react';

type PlayerState = 'loading' | 'idle' | 'playing' | 'error';

const VIDEO = '/assets/cat-lick-paw.mp4';
const POSTER = '/assets/gray-cat-idle.png';

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<PlayerState>('loading');
  const [notice, setNotice] = useState('点击“舔爪”，看完后会自动回到待机');

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const ready = () => setState('idle');
    const error = () => { setState('error'); setNotice('视频素材加载失败，请刷新页面再试'); };
    video.addEventListener('loadeddata', ready);
    video.addEventListener('error', error);
    if (video.readyState >= 2) ready();
    return () => { video.removeEventListener('loadeddata', ready); video.removeEventListener('error', error); };
  }, []);

  const playLick = async () => {
    const video = videoRef.current;
    if (!video || state === 'playing' || state === 'error') return;
    video.currentTime = 0;
    setState('playing');
    setNotice('小灰正在认真清理小爪子……');
    try { await video.play(); }
    catch { setState('idle'); setNotice('浏览器没有启动播放，请再点一次“舔爪”'); }
  };

  const finishAction = () => {
    const video = videoRef.current;
    if (video) { video.pause(); video.currentTime = 0; }
    setState('idle');
    setNotice('动作已完成，小灰回到待机状态');
  };

  const pending = (label: string) => setNotice(`${label}的交互位置已留好，下一阶段只需接入对应成片`);
  const stateLabel = { loading: '加载动作素材', idle: '待机中', playing: '舔爪中', error: '素材异常' }[state];

  return (
    <main className="shell">
      <section className="phone" aria-label="小爪星球宠物互动 POC">
        <header className="header">
          <button className="round" type="button" aria-label="返回">‹</button>
          <div><span>我的宠物</span><h1>小灰</h1></div>
          <div className="proof"><i /> POC</div>
        </header>

        <section className="stage" aria-label="宠物动作舞台">
          <div className="stageLight" />
          <div className={`state is-${state}`}><i /> {stateLabel}</div>
          {/* The poster is a local, fixed-size POC asset; no runtime image service is needed. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={state === 'playing' ? 'idlePet hidden' : 'idlePet'} src={POSTER} alt="灰色英国短毛猫小灰的待机形象" />
          <video ref={videoRef} className={state === 'playing' ? 'actionVideo visible' : 'actionVideo'} src={VIDEO} poster={POSTER} preload="auto" playsInline muted onEnded={finishAction} aria-label="小灰舔爪动作" />
          <div className="floor" />
          <div className="message" aria-live="polite"><span>{state === 'playing' ? '✦' : '♡'}</span><p>{notice}</p></div>
        </section>

        <section className="vitals" aria-label="宠物状态">
          <div><span className="vitalIcon">♥</span><p><small>亲密度</small><strong>72</strong></p></div>
          <div><span className="vitalIcon">☼</span><p><small>今日心情</small><strong>开心</strong></p></div>
          <div><span className="vitalIcon">◔</span><p><small>动作库</small><strong>1 / 3</strong></p></div>
        </section>

        <nav className="actions" aria-label="宠物互动动作">
          <button type="button" className="pending" onClick={() => pending('喂食')}><span>🦴</span><strong>喂食</strong><small>待接成片</small></button>
          <button type="button" className="ready" disabled={state === 'loading' || state === 'playing' || state === 'error'} onClick={playLick}><span>🐾</span><strong>{state === 'playing' ? '播放中' : '舔爪'}</strong><small>已接成片</small></button>
          <button type="button" className="pending" onClick={() => pending('摸头')}><span>♡</span><strong>摸头</strong><small>待接成片</small></button>
        </nav>

        <footer className="honesty"><i /><p><strong>当前验证范围</strong><span>真实跑通“点击 → 播放预制动作 → 自动回待机”，不谎称已完成照片个性化。</span></p></footer>
      </section>
    </main>
  );
}
