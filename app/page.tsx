'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

type LoadState = 'loading' | 'ready' | 'error';
type PetAction = 'lick' | 'feed' | 'pet' | null;
type VideoAction = Exclude<PetAction, 'feed' | null>;

const VIDEOS: Record<VideoAction, string> = {
  lick: '/assets/cat-lick-paw.mp4',
  pet: '/assets/cat-head-pet.mp4',
};
const POSTER = '/assets/gray-cat-idle.png';

export default function Home() {
  const lickVideoRef = useRef<HTMLVideoElement>(null);
  const petVideoRef = useRef<HTMLVideoElement>(null);
  const effectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [videoState, setVideoState] = useState<Record<VideoAction, LoadState>>({ lick: 'loading', pet: 'loading' });
  const [action, setAction] = useState<PetAction>(null);
  const [notice, setNotice] = useState('舔爪和摸头是真实成片；喂食是可操作的交互样机');
  const [bond, setBond] = useState(72);
  const [fullness, setFullness] = useState(66);

  useEffect(() => {
    const readyTimer = window.setTimeout(() => {
      const readyPatch: Partial<Record<VideoAction, LoadState>> = {};
      if (lickVideoRef.current?.readyState && lickVideoRef.current.readyState >= 2) readyPatch.lick = 'ready';
      if (petVideoRef.current?.readyState && petVideoRef.current.readyState >= 2) readyPatch.pet = 'ready';
      if (Object.keys(readyPatch).length) {
        setVideoState((current) => ({ ...current, ...readyPatch }));
      }
    }, 0);

    return () => {
      window.clearTimeout(readyTimer);
      if (effectTimer.current) clearTimeout(effectTimer.current);
    };
  }, []);

  const setVideoLoadState = (kind: VideoAction, state: LoadState) => {
    setVideoState((current) => ({ ...current, [kind]: state }));
    if (state === 'error') {
      const video = kind === 'lick' ? lickVideoRef.current : petVideoRef.current;
      if (video) { video.pause(); video.currentTime = 0; }
      setAction((current) => current === kind ? null : current);
      setNotice(`${kind === 'lick' ? '舔爪' : '摸头'}视频加载失败，其他入口仍可体验`);
    }
  };

  const playVideo = async (next: VideoAction) => {
    const video = next === 'lick' ? lickVideoRef.current : petVideoRef.current;
    if (!video || action || videoState[next] === 'error') return;
    [lickVideoRef.current, petVideoRef.current].forEach((item) => {
      if (item && item !== video) { item.pause(); item.currentTime = 0; }
    });
    video.currentTime = 0;
    setAction(next);
    setNotice(next === 'lick' ? '小灰正在认真清理小爪子……' : '轻轻摸摸头，小灰舒服地眯起了眼睛……');
    try { await video.play(); }
    catch { setAction(null); setNotice(`浏览器没有启动播放，请再点一次“${next === 'lick' ? '舔爪' : '摸头'}”`); }
  };

  const finishVideo = (completed: VideoAction) => {
    const video = completed === 'lick' ? lickVideoRef.current : petVideoRef.current;
    if (video) { video.pause(); video.currentTime = 0; }
    if (completed === 'pet') {
      setBond((value) => Math.min(100, value + 5));
      setNotice('摸头完成，亲密度 +5');
    } else {
      setNotice('舔爪完成，小灰已回到待机状态');
    }
    setAction(null);
  };

  const playFeed = () => {
    if (action) return;
    if (effectTimer.current) clearTimeout(effectTimer.current);
    setAction('feed');
    setNotice('小灰闻到了香香的猫粮……');
    effectTimer.current = setTimeout(() => {
      setFullness((value) => Math.min(100, value + 12));
      setNotice('喂食完成，饱腹度 +12');
      setAction(null);
      effectTimer.current = null;
    }, 2700);
  };

  const mediaLoading = Object.values(videoState).some((state) => state === 'loading');
  const mediaError = Object.values(videoState).some((state) => state === 'error');

  const stateLabel = action === 'lick'
    ? '舔爪中'
    : action === 'feed'
        ? '喂食中'
      : action === 'pet'
        ? '摸头中'
        : mediaLoading
          ? '加载成片'
          : mediaError
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
          <div className={`state is-${action ?? (mediaLoading ? 'loading' : mediaError ? 'error' : 'ready')}`}><i /> {stateLabel}</div>

          {/* The poster is a local, fixed-size POC asset; no runtime image service is needed. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={action === 'lick' || action === 'pet' ? 'idlePet hidden' : 'idlePet'} src={POSTER} alt="灰色英国短毛猫小灰的待机形象" />
          <video ref={lickVideoRef} className={action === 'lick' ? 'actionVideo visible' : 'actionVideo'} src={VIDEOS.lick} poster={POSTER} preload="auto" playsInline muted onLoadedData={() => setVideoLoadState('lick', 'ready')} onError={() => setVideoLoadState('lick', 'error')} onEnded={() => finishVideo('lick')} aria-label="小灰舔爪动作" />
          <video ref={petVideoRef} className={action === 'pet' ? 'actionVideo visible' : 'actionVideo'} src={VIDEOS.pet} poster={POSTER} preload="auto" playsInline muted onLoadedData={() => setVideoLoadState('pet', 'ready')} onError={() => setVideoLoadState('pet', 'error')} onEnded={() => finishVideo('pet')} aria-label="小灰摸头后的舒服反应" />

          <button className="headHit" type="button" aria-label="直接摸小灰的头" disabled={busy || videoState.pet === 'error'} onClick={() => playVideo('pet')}><span>轻点头部</span></button>

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
          <div><span className="vitalIcon">◔</span><p><small>动作成片</small><strong>2 / 3</strong></p></div>
        </section>

        <nav className="actions" aria-label="宠物互动动作">
          <button type="button" className={action === 'feed' ? 'prototype active' : 'prototype'} disabled={busy} onClick={playFeed}><span>🦴</span><strong>{action === 'feed' ? '喂食中' : '喂食'}</strong><small>交互样机</small></button>
          <button type="button" className={action === 'lick' ? 'ready active' : 'ready'} disabled={busy || videoState.lick === 'error'} onClick={() => playVideo('lick')}><span>🐾</span><strong>{action === 'lick' ? '播放中' : '舔爪'}</strong><small>真实成片</small></button>
          <button type="button" className={action === 'pet' ? 'ready active' : 'ready'} disabled={busy || videoState.pet === 'error'} onClick={() => playVideo('pet')}><span>♡</span><strong>{action === 'pet' ? '摸摸中' : '摸头'}</strong><small>真实成片</small></button>
        </nav>

        <footer className="honesty"><i /><p><strong>三个入口都已可操作</strong><span>舔爪与摸头播放真实 MP4；喂食先验证交互、状态和数值，待同角色成片完成后原位替换。</span></p></footer>
      </section>
    </main>
  );
}
