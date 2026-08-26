'use client';

/* Browser-local Blob URLs cannot be handled by the Next image optimizer. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, CSSProperties } from 'react';
import { createLocalCartoonPreview, inspectPetPhoto } from './cartoonize';
import type { PetPhotoInfo } from './cartoonize';

type LoadState = 'loading' | 'ready' | 'fallback' | 'error';
type Action = 'lick' | 'feed' | 'pet';
type MediaKey = 'idle' | Action;
type PetAction = Action | null;
type PetKind = 'cat' | 'dog';
type CreatorStatus = 'empty' | 'checking' | 'ready' | 'processing' | 'result' | 'error';

const PRIMARY_VIDEOS: Record<MediaKey, string> = {
  idle: '/assets/generated/cat-idle-scail2-poc-v1.mp4',
  lick: '/assets/generated/cat-lick-paw-scail2-complete-poc-v1.mp4',
  feed: '/assets/generated/cat-eat-scail2-poc-v1.mp4',
  pet: '/assets/generated/cat-head-pet-scail2-poc-v1.mp4',
};
const FALLBACK_VIDEOS: Record<MediaKey, string | null> = {
  idle: '/assets/cat-idle-local-blink-v2.mp4',
  lick: '/assets/cat-lick-paw-scail2.mp4',
  feed: null,
  pet: '/assets/cat-head-pet.mp4',
};
const ACTION_LABELS: Record<Action, string> = { lick: '舔爪', feed: '喂食', pet: '摸头' };
const POSTER = '/assets/gray-cat-idle.png';

export default function Home() {
  const idleVideoRef = useRef<HTMLVideoElement>(null);
  const lickVideoRef = useRef<HTMLVideoElement>(null);
  const feedVideoRef = useRef<HTMLVideoElement>(null);
  const petVideoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const effectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sourcePreviewUrlRef = useRef<string | null>(null);
  const cartoonPreviewUrlRef = useRef<string | null>(null);
  const customAvatarUrlRef = useRef<string | null>(null);
  const [videoSources, setVideoSources] = useState<Record<MediaKey, string>>(PRIMARY_VIDEOS);
  const [videoState, setVideoState] = useState<Record<MediaKey, LoadState>>({
    idle: 'loading',
    lick: 'loading',
    feed: 'loading',
    pet: 'loading',
  });
  const [action, setAction] = useState<PetAction>(null);
  const [notice, setNotice] = useState('待机、舔爪、喂食和摸头四段 POC 成片正在加载');
  const [bond, setBond] = useState(72);
  const [fullness, setFullness] = useState(66);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [creatorStatus, setCreatorStatus] = useState<CreatorStatus>('empty');
  const [creatorError, setCreatorError] = useState('');
  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null);
  const [photoInfo, setPhotoInfo] = useState<PetPhotoInfo | null>(null);
  const [sourcePreview, setSourcePreview] = useState<string | null>(null);
  const [cartoonPreview, setCartoonPreview] = useState<string | null>(null);
  const [cartoonBlob, setCartoonBlob] = useState<Blob | null>(null);
  const [customAvatar, setCustomAvatar] = useState<string | null>(null);
  const [petKind, setPetKind] = useState<PetKind>('cat');
  const [petNameDraft, setPetNameDraft] = useState('我的宝贝');
  const [petName, setPetName] = useState('我的宝贝');

  useEffect(() => {
    return () => {
      if (effectTimer.current) clearTimeout(effectTimer.current);
      if (sourcePreviewUrlRef.current) URL.revokeObjectURL(sourcePreviewUrlRef.current);
      if (cartoonPreviewUrlRef.current) URL.revokeObjectURL(cartoonPreviewUrlRef.current);
      if (customAvatarUrlRef.current) URL.revokeObjectURL(customAvatarUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (!creatorOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCreatorOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [creatorOpen]);

  useEffect(() => {
    const readyTimer = window.setTimeout(() => {
      const refs: Record<MediaKey, HTMLVideoElement | null> = {
        idle: idleVideoRef.current,
        lick: lickVideoRef.current,
        feed: feedVideoRef.current,
        pet: petVideoRef.current,
      };
      const readyPatch: Partial<Record<MediaKey, LoadState>> = {};
      (Object.keys(refs) as MediaKey[]).forEach((kind) => {
        const video = refs[kind];
        if (video && video.readyState >= 2) {
          readyPatch[kind] = videoSources[kind] === PRIMARY_VIDEOS[kind] ? 'ready' : 'fallback';
        }
      });
      if (Object.keys(readyPatch).length) {
        setVideoState((current) => ({ ...current, ...readyPatch }));
        if (Object.keys(readyPatch).length === 4 && (Object.keys(readyPatch) as MediaKey[]).every((kind) => readyPatch[kind] === 'ready')) {
          setNotice('四段 SCAIL-2 POC 成片已就绪，可以开始演示');
        }
      }
    }, 0);

    return () => window.clearTimeout(readyTimer);
  }, [videoSources]);

  const getActionVideo = (kind: Action) => {
    if (kind === 'lick') return lickVideoRef.current;
    if (kind === 'feed') return feedVideoRef.current;
    return petVideoRef.current;
  };

  const releasePreviewUrl = (kind: 'source' | 'cartoon') => {
    const ref = kind === 'source' ? sourcePreviewUrlRef : cartoonPreviewUrlRef;
    if (ref.current) URL.revokeObjectURL(ref.current);
    ref.current = null;
    if (kind === 'source') setSourcePreview(null);
    else setCartoonPreview(null);
  };

  const chooseAnotherPhoto = () => {
    if (creatorStatus === 'checking' || creatorStatus === 'processing') return;
    fileInputRef.current?.click();
  };

  const onPhotoSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    releasePreviewUrl('source');
    releasePreviewUrl('cartoon');
    setSelectedPhoto(null);
    setCartoonBlob(null);
    setPhotoInfo(null);
    setCreatorError('');
    setCreatorStatus('checking');

    try {
      const info = await inspectPetPhoto(file);
      const previewUrl = URL.createObjectURL(file);
      sourcePreviewUrlRef.current = previewUrl;
      setSourcePreview(previewUrl);
      setSelectedPhoto(file);
      setPhotoInfo(info);
      setCreatorStatus('ready');
    } catch (error) {
      setCreatorError(error instanceof Error ? error.message : '这张照片无法读取，请换一张重试');
      setCreatorStatus('error');
    }
  };

  const generateCartoonPreview = async () => {
    if (!selectedPhoto || creatorStatus === 'processing') return;
    releasePreviewUrl('cartoon');
    setCartoonBlob(null);
    setCreatorError('');
    setCreatorStatus('processing');

    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const blob = await createLocalCartoonPreview(selectedPhoto);
      const previewUrl = URL.createObjectURL(blob);
      cartoonPreviewUrlRef.current = previewUrl;
      setCartoonBlob(blob);
      setCartoonPreview(previewUrl);
      setCreatorStatus('result');
    } catch (error) {
      setCreatorError(error instanceof Error ? error.message : '卡通预览生成失败，请换一张照片重试');
      setCreatorStatus('error');
    }
  };

  const useCartoonPreview = () => {
    if (!cartoonBlob) return;
    if (customAvatarUrlRef.current) URL.revokeObjectURL(customAvatarUrlRef.current);
    const avatarUrl = URL.createObjectURL(cartoonBlob);
    customAvatarUrlRef.current = avatarUrl;
    setCustomAvatar(avatarUrl);
    setPetName(petNameDraft.trim() || '我的宝贝');
    setAction(null);
    setNotice('本地卡通母版已创建；个性化动作需要接入 GPU 后再生成');
    setCreatorOpen(false);
  };

  const returnToDemoPet = () => {
    setCustomAvatar(null);
    if (customAvatarUrlRef.current) URL.revokeObjectURL(customAvatarUrlRef.current);
    customAvatarUrlRef.current = null;
    setNotice('已返回小灰动作演示，四段 SCAIL-2 POC 成片可继续体验');
    resetIdleVideo();
  };

  const resetIdleVideo = () => {
    const video = idleVideoRef.current;
    if (!video) return;
    video.currentTime = 0;
    void video.play().catch(() => undefined);
  };

  const onMediaLoaded = (kind: MediaKey) => {
    const loadedState = videoSources[kind] === PRIMARY_VIDEOS[kind] ? 'ready' : 'fallback';
    setVideoState((current) => ({ ...current, [kind]: loadedState }));
  };

  const onMediaError = (kind: MediaKey) => {
    const video = kind === 'idle' ? idleVideoRef.current : getActionVideo(kind);
    if (video) { video.pause(); video.currentTime = 0; }

    const fallback = FALLBACK_VIDEOS[kind];
    if (fallback && videoSources[kind] === PRIMARY_VIDEOS[kind]) {
      setVideoSources((current) => ({ ...current, [kind]: fallback }));
      setVideoState((current) => ({ ...current, [kind]: 'loading' }));
      setAction((current) => current === kind ? null : current);
      if (kind !== 'idle') resetIdleVideo();
      setNotice(`${kind === 'idle' ? '待机' : ACTION_LABELS[kind]}主成片加载失败，已自动切换 POC 回退`);
      return;
    }

    if (kind === 'feed') {
      setVideoState((current) => ({ ...current, feed: 'fallback' }));
      setAction((current) => current === 'feed' ? null : current);
      resetIdleVideo();
      setNotice('喂食成片不可用，已切换到可演示的交互回退');
      return;
    }

    setVideoState((current) => ({ ...current, [kind]: 'error' }));
    setAction((current) => current === kind ? null : current);
    if (kind !== 'idle') resetIdleVideo();
    setNotice(`${kind === 'idle' ? '待机' : ACTION_LABELS[kind]}视频和回退都加载失败，其他入口仍可体验`);
  };

  const playFeedFallback = () => {
    if (action) return;
    if (effectTimer.current) clearTimeout(effectTimer.current);
    setAction('feed');
    setNotice('小灰闻到了香香的猫粮……');
    effectTimer.current = setTimeout(() => {
      setFullness((value) => Math.min(100, value + 12));
      setNotice('喂食完成，饱腹度 +12');
      setAction(null);
      resetIdleVideo();
      effectTimer.current = null;
    }, 2700);
  };

  const playVideo = async (next: Action) => {
    if (next === 'feed' && videoState.feed === 'fallback') {
      playFeedFallback();
      return;
    }

    const video = getActionVideo(next);
    if (!video || action || videoState[next] === 'loading' || videoState[next] === 'error') return;
    [lickVideoRef.current, feedVideoRef.current, petVideoRef.current].forEach((item) => {
      if (item && item !== video) { item.pause(); item.currentTime = 0; }
    });
    idleVideoRef.current?.pause();
    video.currentTime = 0;
    setAction(next);
    setNotice(next === 'lick'
      ? '小灰正在认真清理小爪子……'
      : next === 'feed'
        ? '小灰正在低头吃猫粮……'
        : '轻轻摸摸头，小灰舒服地眯起了眼睛……');
    try { await video.play(); }
    catch {
      resetIdleVideo();
      setAction(null);
      setNotice(`浏览器没有启动播放，请再点一次“${ACTION_LABELS[next]}”`);
    }
  };

  const finishVideo = (completed: Action) => {
    const video = getActionVideo(completed);
    if (video) { video.pause(); video.currentTime = 0; }
    if (completed === 'pet') {
      setBond((value) => Math.min(100, value + 5));
      setNotice('摸头完成，亲密度 +5');
    } else if (completed === 'feed') {
      setFullness((value) => Math.min(100, value + 12));
      setNotice('喂食完成，饱腹度 +12');
    } else {
      setNotice('舔爪完成，小灰已回到待机状态');
    }
    resetIdleVideo();
    setAction(null);
  };

  const mediaLoading = Object.values(videoState).some((state) => state === 'loading');
  const mediaError = Object.values(videoState).some((state) => state === 'error');
  const mediaFallback = Object.values(videoState).some((state) => state === 'fallback');
  const personalizedPreview = customAvatar !== null;
  const displayPetName = personalizedPreview ? petName : '小灰';

  const stateLabel = personalizedPreview
    ? '形象预览'
    : action === 'lick'
    ? '舔爪中'
    : action === 'feed'
        ? '喂食中'
      : action === 'pet'
        ? '摸头中'
        : mediaLoading
          ? '加载成片'
          : mediaError
            ? '部分可用'
            : mediaFallback
              ? '回退可用'
              : '待机中';
  const messageIcon = personalizedPreview ? '✦' : action === 'feed' ? '●' : action === 'pet' ? '♥' : action === 'lick' ? '✦' : '♡';
  const busy = action !== null;
  const usingFeedFallback = action === 'feed' && videoState.feed === 'fallback';
  const hideIdle = personalizedPreview || (action !== null && !usingFeedFallback);
  const buttonNote = (kind: Action) => personalizedPreview
    ? '待生成'
    : videoState[kind] === 'fallback'
    ? 'POC 回退'
    : videoState[kind] === 'loading'
      ? '加载中'
      : videoState[kind] === 'error'
        ? '不可用'
        : '真实成片';

  return (
    <main className="shell">
      <section className="phone" aria-label="小爪星球宠物互动 POC">
        <header className="header">
          <button className="round" type="button" aria-label="返回">‹</button>
          <div><span>我的宠物</span><h1>{displayPetName}</h1></div>
          <div className="proof"><i /> POC</div>
        </header>

        <button className={personalizedPreview ? 'creatorEntry personalized' : 'creatorEntry'} type="button" onClick={() => setCreatorOpen(true)}>
          <span className="creatorEntryIcon">{personalizedPreview && customAvatar ? <img src={customAvatar} alt="" /> : '＋'}</span>
          <span className="creatorEntryCopy">
            <strong>{personalizedPreview ? `${displayPetName}的卡通母版` : '上传照片，创建我的宠物'}</strong>
            <small>{personalizedPreview ? '点击重新选择照片' : '照片仅在本机处理 · 不消耗生成额度'}</small>
          </span>
          <span className="creatorEntryArrow" aria-hidden="true">›</span>
        </button>

        {personalizedPreview && <button className="returnDemo" type="button" onClick={returnToDemoPet}>返回小灰动作演示</button>}

        <section className={`stage action-${personalizedPreview ? 'custom' : action ?? 'idle'}`} aria-label="宠物动作舞台">
          <div className="stageLight" />
          <div className={`state is-${action ?? (mediaLoading ? 'loading' : mediaError ? 'error' : 'ready')}`}><i /> {stateLabel}</div>

          <video ref={idleVideoRef} className={hideIdle ? 'idlePet hidden' : 'idlePet'} src={videoSources.idle} poster={POSTER} preload="auto" autoPlay loop playsInline muted onLoadedData={() => onMediaLoaded('idle')} onError={() => onMediaError('idle')} aria-label="灰色英国短毛猫小灰眨眼待机" />
          <video ref={lickVideoRef} className={action === 'lick' ? 'actionVideo visible' : 'actionVideo'} src={videoSources.lick} poster={POSTER} preload="auto" playsInline muted onLoadedData={() => onMediaLoaded('lick')} onError={() => onMediaError('lick')} onEnded={() => finishVideo('lick')} aria-label="小灰舔爪动作" />
          <video ref={feedVideoRef} className={action === 'feed' && !usingFeedFallback ? 'actionVideo visible' : 'actionVideo'} src={videoSources.feed} poster={POSTER} preload="auto" playsInline muted onLoadedData={() => onMediaLoaded('feed')} onError={() => onMediaError('feed')} onEnded={() => finishVideo('feed')} aria-label="小灰低头吃猫粮动作" />
          <video ref={petVideoRef} className={action === 'pet' ? 'actionVideo visible' : 'actionVideo'} src={videoSources.pet} poster={POSTER} preload="auto" playsInline muted onLoadedData={() => onMediaLoaded('pet')} onError={() => onMediaError('pet')} onEnded={() => finishVideo('pet')} aria-label="小灰摸头后的舒服反应" />
          {personalizedPreview && customAvatar && <img className="customPetPreview" src={customAvatar} alt={`${displayPetName}的本地卡通预览`} />}

          {usingFeedFallback && <div className="feedFx" aria-hidden="true">
            <i className="kibble k1" /><i className="kibble k2" /><i className="kibble k3" />
            <div className="bowl"><span>● ● ●</span><b>HUI</b></div>
          </div>}
          <div className="petFx" aria-hidden="true"><i>♥</i><i>♥</i><i>♥</i></div>

          <div className="floor" />
          <div className="message" aria-live="polite"><span>{messageIcon}</span><p>{notice}</p></div>
        </section>

        <section className="vitals" aria-label="宠物状态">
          <div><span className="vitalIcon">♥</span><p><small>亲密度</small><strong>{bond}</strong></p><em style={{ '--value': `${bond}%` } as CSSProperties} /></div>
          <div><span className="vitalIcon">●</span><p><small>饱腹度</small><strong>{fullness}</strong></p><em style={{ '--value': `${fullness}%` } as CSSProperties} /></div>
          <div><span className="vitalIcon">◔</span><p><small>{personalizedPreview ? '动作进度' : '视频接入'}</small><strong>{personalizedPreview ? '0 / 4' : '4 / 4'}</strong></p></div>
        </section>

        <nav className={personalizedPreview ? 'actions personalizedLocked' : 'actions'} aria-label="宠物互动动作">
          <button type="button" className={`${videoState.feed === 'fallback' ? 'prototype' : 'ready'}${action === 'feed' ? ' active' : ''}`} disabled={personalizedPreview || busy || videoState.feed === 'loading' || videoState.feed === 'error'} onClick={() => playVideo('feed')}><span>🦴</span><strong>{action === 'feed' ? '喂食中' : '喂食'}</strong><small>{buttonNote('feed')}</small></button>
          <button type="button" className={`ready${action === 'lick' ? ' active' : ''}`} disabled={personalizedPreview || busy || videoState.lick === 'loading' || videoState.lick === 'error'} onClick={() => playVideo('lick')}><span>🐾</span><strong>{action === 'lick' ? '播放中' : '舔爪'}</strong><small>{buttonNote('lick')}</small></button>
          <button type="button" className={`ready${action === 'pet' ? ' active' : ''}`} disabled={personalizedPreview || busy || videoState.pet === 'loading' || videoState.pet === 'error'} onClick={() => playVideo('pet')}><span>♡</span><strong>{action === 'pet' ? '摸摸中' : '摸头'}</strong><small>{buttonNote('pet')}</small></button>
        </nav>

        <footer className="honesty"><i /><p><strong>{personalizedPreview ? '卡通预览已完成，动作尚未生成' : '四段固定动作换宠物已接入'}</strong><span>{personalizedPreview ? '当前是浏览器本地二维卡通预览，不是 AI 生成的 3D 母版。喂食、舔爪和摸头需要接入 GPU 后为这只宠物单独生成。' : '待机、舔爪、喂食和摸头均优先播放 SCAIL-2 POC 成片；单段加载失败会自动回退。当前喂食是临时的一小块猫粮版本，正式猫碗版仍需补做。'}</span></p></footer>
      </section>

      {creatorOpen && <div className="creatorBackdrop" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setCreatorOpen(false);
      }}>
        <section className="creatorDialog" role="dialog" aria-modal="true" aria-labelledby="creator-title" aria-describedby="creator-description">
          <button className="creatorClose" type="button" aria-label="关闭创建宠物窗口" onClick={() => setCreatorOpen(false)}>×</button>
          <header className="creatorIntro">
            <span>零额度本地预览</span>
            <h2 id="creator-title">创建我的宠物</h2>
            <p id="creator-description">上传一张清晰的猫咪或狗狗照片，浏览器会在本机生成二维卡通预览，原图不会上传服务器。</p>
          </header>

          <input ref={fileInputRef} className="visuallyHidden" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" onChange={onPhotoSelected} />

          {!sourcePreview && creatorStatus !== 'checking' && <button className="uploadZone" type="button" onClick={chooseAnotherPhoto}>
            <span aria-hidden="true">＋</span>
            <strong>选择宠物照片</strong>
            <small>JPG、PNG 或 WebP，最大 12MB</small>
          </button>}

          {creatorStatus === 'checking' && <div className="creatorProgress" role="status"><i /><strong>正在检查照片</strong><small>读取尺寸和文件格式，不会联网</small></div>}

          {sourcePreview && <div className="creatorWorkspace">
            <div className="creatorFields">
              <label><span>宠物名字</span><input value={petNameDraft} maxLength={12} onChange={(event) => setPetNameDraft(event.target.value)} placeholder="例如：团团" /></label>
              <fieldset><legend>它是</legend><div className="kindOptions">
                <button type="button" className={petKind === 'cat' ? 'selected' : ''} aria-pressed={petKind === 'cat'} onClick={() => setPetKind('cat')}>猫咪</button>
                <button type="button" className={petKind === 'dog' ? 'selected' : ''} aria-pressed={petKind === 'dog'} onClick={() => setPetKind('dog')}>狗狗</button>
              </div></fieldset>
            </div>

            <div className="previewCompare">
              <figure><div><img src={sourcePreview} alt="上传的宠物原图" /></div><figcaption>原始照片</figcaption></figure>
              <figure className={cartoonPreview ? 'hasResult' : ''}><div>{cartoonPreview ? <img src={cartoonPreview} alt="本地生成的二维卡通预览" /> : <span>{creatorStatus === 'processing' ? '正在处理轮廓和色彩…' : '等待生成'}</span>}</div><figcaption>本地卡通预览</figcaption></figure>
            </div>

            {photoInfo && <p className="photoMeta">照片 {photoInfo.width} × {photoInfo.height} · {(photoInfo.size / 1024 / 1024).toFixed(1)}MB · {petKind === 'cat' ? '猫咪模板' : '狗狗模板'}</p>}
          </div>}

          {creatorError && <p className="creatorError" role="alert">{creatorError}</p>}

          {creatorStatus === 'processing' && <div className="creatorProgress compact" role="status"><i /><strong>正在生成本地卡通预览</strong><small>只做平滑、色阶和轮廓处理</small></div>}

          {cartoonPreview && <div className="creatorBoundary"><strong>这一步已经真实完成</strong><span>这是零额度二维预览。与小灰同风格的 AI 母版及四条个性化动作，需要后续连接 GPU 生成服务。</span></div>}

          <div className="creatorActions">
            {sourcePreview && <button className="secondary" type="button" disabled={creatorStatus === 'processing'} onClick={chooseAnotherPhoto}>重新选照片</button>}
            {selectedPhoto && creatorStatus !== 'result' && <button className="primary" type="button" disabled={creatorStatus === 'processing'} onClick={generateCartoonPreview}>{creatorStatus === 'processing' ? '生成中…' : '生成卡通预览'}</button>}
            {cartoonPreview && <a className="secondary" href={cartoonPreview} download={`${petNameDraft.trim() || 'pet'}-cartoon-preview.jpg`}>下载预览</a>}
            {cartoonPreview && <button className="primary" type="button" onClick={useCartoonPreview}>使用这个形象</button>}
          </div>
        </section>
      </div>}
    </main>
  );
}
