'use client';

/* Browser-local Blob URLs cannot be handled by the Next image optimizer. */
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, CSSProperties } from 'react';
import { inspectPetPhoto } from './pet-photo';
import type { PetPhotoInfo } from './pet-photo';
import type {
  PetActionBatch,
  PetActionBranch,
} from '@/lib/pet-action-branches';
import {
  isPlayablePetActionBranch as isPlayableBranch,
  isSha256,
} from '@/lib/pet-action-branches';
import {
  emptyPetStore,
  parsePetStore,
  removePet,
  selectPet,
  upsertPet,
  type SavedPetProfile,
} from '@/lib/pet-profiles';

type LoadState = 'loading' | 'ready' | 'fallback' | 'error';
type Action = 'lick' | 'feed' | 'pet';
type MediaKey = 'idle' | Action;
type PetAction = Action | null;
type FeedPhase = 'hidden' | 'entering' | 'holding' | 'exiting';
type CanonicalAnchorPhase = 'idle' | 'entering' | 'action' | 'returning';
type PetKind = 'cat' | 'dog';
type PetGender = '' | 'male' | 'female';
type HomeView = 'restoring' | 'empty' | 'demo' | 'custom';
type CreatorStatus =
  | 'empty'
  | 'checking'
  | 'ready'
  | 'submitting'
  | 'queued'
  | 'generating'
  | 'poll_error'
  | 'ready_for_review'
  | 'confirming'
  | 'rejected'
  | 'approved'
  | 'error';

type AvatarJobResponse = {
  status: string;
  jobId?: string;
  previewUrl?: string;
  pollAfterMs?: number;
  cached?: boolean;
  message?: string;
  petName?: string;
  ageOrBirthday?: string;
  gender?: PetGender | null;
  actionBatch?: PetActionBatch;
};

type ActionProgressResponse = {
  status: 'planned' | 'generating' | 'partial_ready' | 'complete' | 'error';
  playable?: number;
  total?: number;
  pollAfterMs?: number;
  message?: string;
  actionBatch?: PetActionBatch;
};

const PRIMARY_VIDEOS: Record<MediaKey, string> = {
  idle: '/assets/generated/cat-idle-scail2-poc-smooth30-v1.mp4',
  lick: '/assets/generated/cat-lick-paw-scail2-complete-poc-smooth30-seam-v3.mp4',
  feed: '/assets/generated/cat-feed-trework-seedance-poc-v1.mp4',
  pet: '/assets/generated/cat-head-pet-scail2-poc-smooth30-seam-v4.mp4',
};
const FALLBACK_VIDEOS: Record<MediaKey, string | null> = {
  idle: '/assets/cat-idle-local-blink-v2.mp4',
  lick: '/assets/cat-lick-paw-scail2.mp4',
  feed: null,
  pet: '/assets/cat-head-pet.mp4',
};
const ACTION_LABELS: Record<Action, string> = { lick: '舔爪', feed: '喂食', pet: '摸头' };

const FeedActionIcon = () => <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <path d="M13 28c0-6 8-10 19-10s19 4 19 10v3H13z" fill="#f7d67d" stroke="#70472f" strokeWidth="3" strokeLinejoin="round" />
  <circle cx="22" cy="25" r="3.2" fill="#a65f32" /><circle cx="31.5" cy="22.5" r="3.2" fill="#bd743a" /><circle cx="41" cy="25" r="3.2" fill="#8e4f2d" />
  <path d="M12 30h40l-4.2 16.5A6 6 0 0 1 42 51H22a6 6 0 0 1-5.8-4.5z" fill="#fff1bd" stroke="#70472f" strokeWidth="3" strokeLinejoin="round" />
  <path d="M18 35c8 3 20 3 28 0" fill="none" stroke="#fff8dd" strokeWidth="3" strokeLinecap="round" />
</svg>;

const LickActionIcon = () => <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <ellipse cx="19" cy="21" rx="7" ry="9" transform="rotate(-24 19 21)" fill="#fff0c6" stroke="#3f603b" strokeWidth="3" />
  <ellipse cx="31" cy="16" rx="7" ry="9" fill="#fff0c6" stroke="#3f603b" strokeWidth="3" />
  <ellipse cx="44" cy="21" rx="7" ry="9" transform="rotate(24 44 21)" fill="#fff0c6" stroke="#3f603b" strokeWidth="3" />
  <path d="M18 43c0-10 6-17 14-17s14 7 14 17c0 7-5 10-14 10s-14-3-14-10z" fill="#fff0c6" stroke="#3f603b" strokeWidth="3" strokeLinejoin="round" />
  <path d="M25 42c0-5 3-9 7-9s7 4 7 9c0 4-3 6-7 6s-7-2-7-6z" fill="#f49b91" />
</svg>;

const PetActionIcon = () => <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <path d="M14 29l-1-14 12 7c5-3 10-3 15 0l11-7-1 15c2 4 2 9 0 13-3 7-10 10-18 10s-16-3-19-10c-2-5-1-10 1-14z" fill="#fff0c9" stroke="#713f4d" strokeWidth="3" strokeLinejoin="round" />
  <path d="M17 21l7 4-7 2zM47 21l-7 4 7 2z" fill="#f2a0aa" />
  <path d="M20 35c2 3 6 3 8 0M36 35c2 3 6 3 8 0" fill="none" stroke="#713f4d" strokeWidth="3" strokeLinecap="round" />
  <path d="M29 40l3 2 3-2" fill="#e78391" stroke="#713f4d" strokeWidth="2" strokeLinejoin="round" />
  <path d="M27 45c3 3 7 3 10 0M18 42l-7 2M46 42l7 2" fill="none" stroke="#713f4d" strokeWidth="2.3" strokeLinecap="round" />
  <path d="M48 9c-3-4-9-2-9 3 0 4 9 10 9 10s9-6 9-10c0-5-6-7-9-3z" fill="#f4879a" stroke="#713f4d" strokeWidth="2.5" strokeLinejoin="round" />
  <path d="M45 11c1-1 3-1 4 0" fill="none" stroke="#ffc8d1" strokeWidth="2" strokeLinecap="round" />
</svg>;

const POSTER = '/assets/gray-cat-idle.png';
const VIDEO_READY_TIMEOUT_MS = 800;
const VIDEO_FRAME_TIMEOUT_MS = 1200;
const BOWL_TRANSITION_MS = 520;
const CANONICAL_ANCHOR_SETTLE_MS = 140;
const APPROVED_PET_STORAGE_KEY = 'paw-planet-approved-pet-v1';

type TimedPetActionBranch = PetActionBranch & {
  fps?: number;
  handoffOutFrame?: number;
};

type CustomVideoCache = {
  revisionKey: string | null;
  batchId: string | null;
  sourceKeys: Partial<Record<MediaKey, string>>;
  sources: Partial<Record<MediaKey, string>>;
};

type CustomMediaRevisionItem = {
  action: MediaKey;
  label: string;
  sourceKey: string;
  sourceUrl: string;
  expectedSha256: string;
  expectedFps: number;
  expectedFrames: number;
};

type CustomMediaRevision = {
  revisionKey: string;
  batchId: string;
  items: CustomMediaRevisionItem[];
};

type PendingCustomVideoCommit = {
  cache: CustomVideoCache;
  createdObjectUrls: Set<string>;
};

const CUSTOM_MEDIA_KEYS: MediaKey[] = ['idle', 'lick', 'feed', 'pet'];
const CUSTOM_MEDIA_CACHE_CONTRACT = 'custom-media-v2';
const EMPTY_CUSTOM_VIDEO_CACHE: CustomVideoCache = {
  revisionKey: null,
  batchId: null,
  sourceKeys: {},
  sources: {},
};

const customBranchSourceKey = (batch: PetActionBatch, branch: PetActionBranch) => JSON.stringify([
  CUSTOM_MEDIA_CACHE_CONTRACT,
  batch.id,
  batch.masterSha256,
  branch.action,
  branch.videoUrl ?? '',
  branch.outputSha256 ?? '',
  branch.mediaPolicyVersion ?? '',
  branch.qaPolicyVersion ?? '',
  branch.publishState ?? '',
]);

const createCustomMediaRevision = (batch: PetActionBatch | null): CustomMediaRevision | null => {
  if (!batch || !isSha256(batch.masterSha256)) return null;
  if (batch.branches.length !== CUSTOM_MEDIA_KEYS.length
    || new Set(batch.branches.map((branch) => branch.action)).size !== CUSTOM_MEDIA_KEYS.length) return null;
  const items = CUSTOM_MEDIA_KEYS.flatMap((action) => {
    const branch = batch.branches.find((item) => item.action === action);
    if (!branch || !isPlayableBranch(branch) || !branch.videoUrl || !isSha256(branch.outputSha256) || !branch.fps || !branch.frameCount) {
      return [];
    }
    return [{
      action,
      label: branch.label,
      sourceKey: customBranchSourceKey(batch, branch),
      sourceUrl: branch.videoUrl,
      expectedSha256: branch.outputSha256,
      expectedFps: branch.fps,
      expectedFrames: branch.frameCount,
    }];
  });
  if (items.length === 0) return null;
  return {
    revisionKey: JSON.stringify(items.map((item) => item.sourceKey)),
    batchId: batch.id,
    items,
  };
};

const sha256Hex = async (blob: Blob) => {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const validatePreparedVideo = (
  objectUrl: string,
  item: CustomMediaRevisionItem,
  signal: AbortSignal,
) => new Promise<void>((resolve, reject) => {
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  let settled = false;
  let timeout = 0;
  const cleanup = () => {
    window.clearTimeout(timeout);
    signal.removeEventListener('abort', onAbort);
    video.removeEventListener('loadeddata', onLoadedData);
    video.removeEventListener('error', onError);
    video.pause();
    video.removeAttribute('src');
    video.load();
  };
  const finish = (error?: Error) => {
    if (settled) return;
    settled = true;
    cleanup();
    if (error) reject(error);
    else resolve();
  };
  const onAbort = () => finish(new DOMException('Aborted', 'AbortError'));
  const onError = () => finish(new Error(`${item.label}: video decode failed`));
  const onLoadedData = () => {
    const expectedDuration = item.expectedFrames / item.expectedFps;
    if (video.videoWidth !== 576 || video.videoHeight !== 768) {
      finish(new Error(`${item.label}: expected 576x768, got ${video.videoWidth}x${video.videoHeight}`));
      return;
    }
    if (!Number.isFinite(video.duration) || Math.abs(video.duration - expectedDuration) > 0.08) {
      finish(new Error(`${item.label}: invalid duration ${video.duration}`));
      return;
    }
    finish();
  };
  signal.addEventListener('abort', onAbort, { once: true });
  video.addEventListener('loadeddata', onLoadedData, { once: true });
  video.addEventListener('error', onError, { once: true });
  timeout = window.setTimeout(() => finish(new Error(`${item.label}: video preparation timed out`)), 8000);
  if (signal.aborted) {
    onAbort();
    return;
  }
  video.src = objectUrl;
  video.load();
});

const waitForMs = (duration: number) => new Promise<void>((resolve) => {
  window.setTimeout(resolve, duration);
});

const tryStartVideoPlayback = async (video: HTMLVideoElement, timeoutMs = 1200) => {
  let timeout: number | null = null;
  const playbackAttempt = video.play().then(() => true, () => false);
  const timeoutAttempt = new Promise<boolean>((resolve) => {
    timeout = window.setTimeout(() => resolve(false), timeoutMs);
  });
  const started = await Promise.race([playbackAttempt, timeoutAttempt]);
  if (timeout !== null) window.clearTimeout(timeout);
  if (!started) video.pause();
  return started;
};

const initialCustomVideoState = (batch?: PetActionBatch): Partial<Record<MediaKey, LoadState>> => {
  if (!batch) return {};
  return Object.fromEntries(
    batch.branches
      .filter((item) => Boolean(item.videoUrl))
      .map((item) => [item.action, 'loading'] as const),
  );
};

const waitForReactPaint = () => new Promise<void>((resolve) => {
  let settled = false;
  let firstFrame = 0;
  let secondFrame = 0;
  let fallbackTimer = 0;
  const finish = () => {
    if (settled) return;
    settled = true;
    window.clearTimeout(fallbackTimer);
    window.cancelAnimationFrame(firstFrame);
    window.cancelAnimationFrame(secondFrame);
    resolve();
  };
  fallbackTimer = window.setTimeout(finish, 48);
  firstFrame = window.requestAnimationFrame(() => {
    secondFrame = window.requestAnimationFrame(finish);
  });
});

const waitForPresentedVideoFrame = (
  video: HTMLVideoElement,
  timeoutMs = VIDEO_FRAME_TIMEOUT_MS,
) => new Promise<boolean>((resolve) => {
  let settled = false;
  let callbackId: number | null = null;
  let firstFrame = 0;
  let secondFrame = 0;
  let fallbackTimer = 0;
  const finish = (presented: boolean) => {
    if (settled) return;
    settled = true;
    window.clearTimeout(fallbackTimer);
    window.cancelAnimationFrame(firstFrame);
    window.cancelAnimationFrame(secondFrame);
    if (callbackId !== null && typeof video.cancelVideoFrameCallback === 'function') {
      video.cancelVideoFrameCallback(callbackId);
    }
    resolve(presented);
  };
  fallbackTimer = window.setTimeout(() => finish(false), timeoutMs);
  if (typeof video.requestVideoFrameCallback === 'function') {
    callbackId = video.requestVideoFrameCallback(() => finish(true));
  } else {
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        finish(video.readyState >= 2 && !video.paused);
      });
    });
  }
});

const tryStartVideoOnPresentedFrame = async (video: HTMLVideoElement, timeoutMs = 1200) => {
  const started = await tryStartVideoPlayback(video, timeoutMs);
  if (!started) return false;
  return waitForPresentedVideoFrame(video, timeoutMs);
};

const ensureVideoStartFrame = (video: HTMLVideoElement) => {
  video.pause();
  if (!video.seeking && video.currentTime <= 0.01 && video.readyState >= 2) {
    return Promise.resolve(true);
  }

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      video.removeEventListener('seeked', onReady);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('canplay', onReady);
      resolve(ready);
    };
    const onReady = () => {
      if (!video.seeking && video.readyState >= 2) finish(true);
    };
    const timeout = window.setTimeout(
      () => finish(!video.seeking && video.readyState >= 2),
      VIDEO_READY_TIMEOUT_MS,
    );

    video.addEventListener('seeked', onReady);
    video.addEventListener('loadeddata', onReady);
    video.addEventListener('canplay', onReady);
    if (video.ended || video.currentTime > 0.01) video.currentTime = 0;
    window.requestAnimationFrame(onReady);
  });
};

const prepareIdleReturnFrame = async (video: HTMLVideoElement, sequenceIsCurrent: () => boolean) => {
  if (!sequenceIsCurrent()) return false;
  const ready = await ensureVideoStartFrame(video);
  return ready && sequenceIsCurrent();
};

export default function Home() {
  const idleVideoRef = useRef<HTMLVideoElement>(null);
  const lickVideoRef = useRef<HTMLVideoElement>(null);
  const feedVideoRef = useRef<HTMLVideoElement>(null);
  const petVideoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const creatorTriggerRef = useRef<HTMLButtonElement>(null);
  const creatorDialogRef = useRef<HTMLElement>(null);
  const mediaTransitionSequence = useRef(0);
  const idlePresentationSequence = useRef(0);
  const mediaTransitionLocked = useRef(false);
  const mediaTransitionTarget = useRef<MediaKey | null>(null);
  const actionRef = useRef<PetAction>(null);
  const bowlAnimationWaitRef = useRef<{
    phase: 'entering' | 'exiting';
    timer: number;
    resolve: (completed: boolean) => void;
  } | null>(null);
  const pendingEndedActionRef = useRef<Action | null>(null);
  const actionWatchdogRef = useRef<{
    action: Action;
    sequence: number;
    timer: number;
  } | null>(null);
  const actionHandoffWatchRef = useRef<{
    action: Action;
    sequence: number;
    video: HTMLVideoElement;
    callbackId: number;
  } | null>(null);
  const sourcePreviewUrlRef = useRef<string | null>(null);
  const approvedAvatarUrlRef = useRef<string | null>(null);
  const restoreSequenceRef = useRef(0);
  const customVideoCacheRef = useRef<CustomVideoCache>(EMPTY_CUSTOM_VIDEO_CACHE);
  const pendingCustomVideoCommitRef = useRef<PendingCustomVideoCommit | null>(null);
  const retiredCustomVideoUrlsRef = useRef<string[]>([]);
  const [videoSources, setVideoSources] = useState<Record<MediaKey, string>>(PRIMARY_VIDEOS);
  const [videoState, setVideoState] = useState<Record<MediaKey, LoadState>>({
    idle: 'loading',
    lick: 'loading',
    feed: 'loading',
    pet: 'loading',
  });
  const [idleFramePresented, setIdleFramePresented] = useState(false);
  const [action, setActionState] = useState<PetAction>(null);
  const [feedPhase, setFeedPhase] = useState<FeedPhase>('hidden');
  const [mediaTransitioning, setMediaTransitioning] = useState(false);
  const [homeView, setHomeView] = useState<HomeView>('restoring');
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [restoreError, setRestoreError] = useState('');
  const [notice, setNotice] = useState('上传一张宠物照片，确认卡通形象后，它才会出现在主页');
  const [bond, setBond] = useState(72);
  const [fullness, setFullness] = useState(66);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [creatorStatus, setCreatorStatus] = useState<CreatorStatus>('empty');
  const [creatorError, setCreatorError] = useState('');
  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null);
  const [photoInfo, setPhotoInfo] = useState<PetPhotoInfo | null>(null);
  const [sourcePreview, setSourcePreview] = useState<string | null>(null);
  const [petKind, setPetKind] = useState<PetKind>('cat');
  const [petNameDraft, setPetNameDraft] = useState('我的宝贝');
  const [petAgeOrBirthdayDraft, setPetAgeOrBirthdayDraft] = useState('');
  const [petGenderDraft, setPetGenderDraft] = useState<PetGender>('');
  const [avatarJobId, setAvatarJobId] = useState<string | null>(null);
  const [avatarRequestKey, setAvatarRequestKey] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarCached, setAvatarCached] = useState(false);
  const [approvedAvatar, setApprovedAvatar] = useState<string | null>(null);
  const [approvedPetName, setApprovedPetName] = useState('我的宝贝');
  const [savedPets, setSavedPets] = useState<SavedPetProfile[]>([]);
  const [activePetJobId, setActivePetJobId] = useState<string | null>(null);
  const [actionBatch, setActionBatch] = useState<PetActionBatch | null>(null);
  const [customVideoState, setCustomVideoState] = useState<Partial<Record<MediaKey, LoadState>>>({});
  const [customVideoReadySources, setCustomVideoReadySources] = useState<Partial<Record<MediaKey, string>>>({});
  const [customVideoCache, setCustomVideoCache] = useState<CustomVideoCache>(EMPTY_CUSTOM_VIDEO_CACHE);
  const [canonicalAnchorPhase, setCanonicalAnchorPhase] = useState<CanonicalAnchorPhase>('idle');

  const setActiveAction = (next: PetAction | ((current: PetAction) => PetAction)) => {
    const resolved = typeof next === 'function' ? next(actionRef.current) : next;
    actionRef.current = resolved;
    setActionState(resolved);
  };

  const customMediaRevision = createCustomMediaRevision(actionBatch);
  const customMediaRevisionKey = customMediaRevision?.revisionKey ?? null;
  const keepPreviousBatchDuringTransition = action !== null || mediaTransitioning;
  const customVideoSources = customVideoCache.batchId === actionBatch?.id
    || keepPreviousBatchDuringTransition
    ? customVideoCache.sources
    : {};

  const commitCustomVideoCache = useCallback((next: CustomVideoCache) => {
    const current = customVideoCacheRef.current;
    if (current.revisionKey === next.revisionKey) return;
    const retainedUrls = new Set(Object.values(next.sources));
    Object.values(current.sources).forEach((url) => {
      if (url && !retainedUrls.has(url)) retiredCustomVideoUrlsRef.current.push(url);
    });
    customVideoCacheRef.current = next;
    setCustomVideoCache(next);
  }, []);

  useEffect(() => {
    const currentCache = customVideoCacheRef.current;
    if (currentCache.revisionKey === customMediaRevisionKey) return;

    const controller = new AbortController();
    const createdObjectUrls = new Set<string>();
    let disposed = false;

    if (!customMediaRevision) {
      const emptyCommit: PendingCustomVideoCommit = {
        cache: EMPTY_CUSTOM_VIDEO_CACHE,
        createdObjectUrls,
      };
      window.queueMicrotask(() => {
        if (disposed) return;
        if (actionRef.current || mediaTransitionLocked.current) {
          pendingCustomVideoCommitRef.current = emptyCommit;
        } else {
          commitCustomVideoCache(emptyCommit.cache);
        }
        setCustomVideoState({});
        setCustomVideoReadySources({});
      });
      return () => {
        disposed = true;
        controller.abort();
      };
    }

    const nextState: Partial<Record<MediaKey, LoadState>> = {};
    customMediaRevision.items.forEach((item) => {
      const canReuse = currentCache.sourceKeys[item.action] === item.sourceKey
        && Boolean(currentCache.sources[item.action]);
      nextState[item.action] = canReuse ? customVideoState[item.action] ?? 'loading' : 'loading';
    });
    window.queueMicrotask(() => {
      if (disposed) return;
      setCustomVideoState(nextState);
      setCustomVideoReadySources((readySources) => Object.fromEntries(
        customMediaRevision.items.flatMap((item) => {
          const currentSource = currentCache.sources[item.action];
          return currentCache.sourceKeys[item.action] === item.sourceKey
            && currentSource
            && readySources[item.action] === currentSource
            ? [[item.action, currentSource]]
            : [];
        }),
      ));
    });

    void Promise.all(customMediaRevision.items.map(async (item) => {
      if (
        currentCache.sourceKeys[item.action] === item.sourceKey
        && currentCache.sources[item.action]
      ) {
        return [item, currentCache.sources[item.action]] as const;
      }
      const response = await fetch(item.sourceUrl, {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`${item.label}: HTTP ${response.status}`);
      const blob = await response.blob();
      if (!blob.size) throw new Error(`${item.label}: empty video`);
      const mimeType = (blob.type || response.headers.get('content-type') || '').split(';')[0].toLowerCase();
      if (mimeType !== 'video/mp4') throw new Error(`${item.label}: unexpected media type ${mimeType || 'unknown'}`);
      const actualSha256 = await sha256Hex(blob);
      if (actualSha256 !== item.expectedSha256) {
        throw new Error(`${item.label}: downloaded bytes do not match the published SHA-256`);
      }
      const objectUrl = URL.createObjectURL(blob);
      createdObjectUrls.add(objectUrl);
      await validatePreparedVideo(objectUrl, item, controller.signal);
      return [item, objectUrl] as const;
    })).then((entries) => {
      if (disposed) return;
      const cache: CustomVideoCache = {
        revisionKey: customMediaRevision.revisionKey,
        batchId: customMediaRevision.batchId,
        sourceKeys: Object.fromEntries(entries.map(([item]) => [item.action, item.sourceKey])),
        sources: Object.fromEntries(entries.map(([item, objectUrl]) => [item.action, objectUrl])),
      };
      const pendingCommit: PendingCustomVideoCommit = { cache, createdObjectUrls };
      if (actionRef.current || mediaTransitionLocked.current) {
        pendingCustomVideoCommitRef.current = pendingCommit;
        return;
      }
      commitCustomVideoCache(cache);
      createdObjectUrls.clear();
    }).catch((error: unknown) => {
      if (disposed || (error instanceof DOMException && error.name === 'AbortError')) return;
      controller.abort();
      createdObjectUrls.forEach((url) => URL.revokeObjectURL(url));
      createdObjectUrls.clear();
      setCustomVideoState((current) => {
        const failed = { ...current };
        customMediaRevision.items.forEach((item) => {
          if (currentCache.sourceKeys[item.action] !== item.sourceKey) failed[item.action] = 'error';
        });
        return failed;
      });
      const message = error instanceof Error ? error.message : '视频缓存失败';
      setNotice(`${message}；新修订未完整下载，已拒绝部分换源`);
    });

    return () => {
      disposed = true;
      controller.abort();
      const pendingCommit = pendingCustomVideoCommitRef.current;
      if (pendingCommit?.createdObjectUrls === createdObjectUrls) {
        pendingCustomVideoCommitRef.current = null;
      }
      createdObjectUrls.forEach((url) => URL.revokeObjectURL(url));
      createdObjectUrls.clear();
    };
  // The primitive revision key deliberately excludes actionBatch object identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customMediaRevisionKey, commitCustomVideoCache]);

  useEffect(() => {
    if (action !== null || mediaTransitioning) return;
    const pendingCommit = pendingCustomVideoCommitRef.current;
    if (!pendingCommit) return;
    pendingCustomVideoCommitRef.current = null;
    if (pendingCommit.cache.revisionKey !== customMediaRevisionKey) {
      pendingCommit.createdObjectUrls.forEach((url) => URL.revokeObjectURL(url));
      pendingCommit.createdObjectUrls.clear();
      return;
    }
    commitCustomVideoCache(pendingCommit.cache);
    pendingCommit.createdObjectUrls.clear();
  }, [action, customMediaRevisionKey, commitCustomVideoCache, mediaTransitioning]);

  useEffect(() => {
    const retiredUrls = retiredCustomVideoUrlsRef.current.splice(0);
    retiredUrls.forEach((url) => URL.revokeObjectURL(url));
  }, [customVideoCache.revisionKey]);

  const confirmIdleFramePresented = useCallback(async (
    video: HTMLVideoElement,
    timeoutMs = VIDEO_FRAME_TIMEOUT_MS,
  ) => {
    const sequence = ++idlePresentationSequence.current;
    const source = video.currentSrc || video.src;
    const presented = await tryStartVideoOnPresentedFrame(video, timeoutMs);
    const currentSource = video.currentSrc || video.src;
    if (
      sequence !== idlePresentationSequence.current
      || idleVideoRef.current !== video
      || currentSource !== source
    ) return false;
    setIdleFramePresented(presented);
    return presented;
  }, []);

  useEffect(() => {
    const resumeIdle = () => {
      if (document.visibilityState !== 'visible' || actionRef.current !== null) return;
      const video = idleVideoRef.current;
      if (video) void confirmIdleFramePresented(video);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        idlePresentationSequence.current += 1;
        setIdleFramePresented(false);
        return;
      }
      resumeIdle();
    };
    const onPageShow = () => {
      setIdleFramePresented(false);
      resumeIdle();
    };
    const resumeTimer = window.setTimeout(resumeIdle, 0);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', resumeIdle);
    return () => {
      window.clearTimeout(resumeTimer);
      idlePresentationSequence.current += 1;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('focus', resumeIdle);
    };
  }, [actionBatch?.id, approvedAvatar, confirmIdleFramePresented, videoSources.idle]);

  useEffect(() => {
    const retiredUrlsRef = retiredCustomVideoUrlsRef;
    return () => {
      mediaTransitionSequence.current += 1;
      if (bowlAnimationWaitRef.current) {
        clearTimeout(bowlAnimationWaitRef.current.timer);
        bowlAnimationWaitRef.current.resolve(false);
        bowlAnimationWaitRef.current = null;
      }
      if (actionWatchdogRef.current) {
        clearTimeout(actionWatchdogRef.current.timer);
        actionWatchdogRef.current = null;
      }
      const handoffWatch = actionHandoffWatchRef.current;
      if (handoffWatch) {
        const watchedVideo = handoffWatch.video;
        if (watchedVideo && typeof watchedVideo.cancelVideoFrameCallback === 'function') {
          watchedVideo.cancelVideoFrameCallback(handoffWatch.callbackId);
        }
        actionHandoffWatchRef.current = null;
      }
      if (sourcePreviewUrlRef.current) URL.revokeObjectURL(sourcePreviewUrlRef.current);
      if (approvedAvatarUrlRef.current) URL.revokeObjectURL(approvedAvatarUrlRef.current);
      pendingCustomVideoCommitRef.current?.createdObjectUrls.forEach((url) => {
        URL.revokeObjectURL(url);
      });
      pendingCustomVideoCommitRef.current = null;
      Object.values(customVideoCacheRef.current.sources).forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
      customVideoCacheRef.current = EMPTY_CUSTOM_VIDEO_CACHE;
      retiredUrlsRef.current.splice(0).forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    const sequence = ++restoreSequenceRef.current;
    const controller = new AbortController();
    let disposed = false;
    const isCurrent = () => !disposed && restoreSequenceRef.current === sequence;

    const restoreApprovedPet = async () => {
      let storedStore = emptyPetStore();
      let storedPet: SavedPetProfile | null = null;
      let clearStoredRecord = false;
      try {
        let raw: string | null = null;
        try {
          raw = window.localStorage.getItem(APPROVED_PET_STORAGE_KEY);
        } catch {
          if (isCurrent()) {
            setHomeView('empty');
            setNotice('当前浏览器不允许保存宠物记录；仍可从上传照片开始');
          }
          return;
        }
        storedStore = parsePetStore(raw);
        setSavedPets(storedStore.pets);
        if (!storedStore.pets.length) {
          if (isCurrent()) {
            setRestoreError('');
            setHomeView('empty');
          }
          return;
        }
        storedPet = storedStore.pets.find((pet) => pet.jobId === storedStore.activeJobId) ?? null;
        if (!storedPet) {
          clearStoredRecord = true;
          throw new Error('本地宠物记录不完整');
        }
        try {
          window.localStorage.setItem(APPROVED_PET_STORAGE_KEY, JSON.stringify(storedStore));
        } catch {
          // Migration can stay in memory when storage is read-only.
        }

        const statusResponse = await fetch(`/api/pet-avatar/jobs/${encodeURIComponent(storedPet.jobId)}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if ([401, 403, 404, 410].includes(statusResponse.status)) {
          clearStoredRecord = true;
          throw new Error('已保存的宠物不存在或已经过期');
        }
        if (!statusResponse.ok) throw new Error('宠物服务暂时无法连接');
        const statusResult = await statusResponse.json() as AvatarJobResponse;
        if (statusResult.status === 'rejected') {
          clearStoredRecord = true;
          throw new Error('已保存的宠物没有通过确认');
        }
        if (statusResult.status !== 'approved' || !statusResult.previewUrl) {
          throw new Error('宠物记录暂时没有准备好');
        }
        const imageResponse = await fetch(statusResult.previewUrl, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if ([401, 403, 404, 410].includes(imageResponse.status)) {
          clearStoredRecord = true;
          throw new Error('已保存的宠物图片不存在或已经过期');
        }
        if (!imageResponse.ok) throw new Error('已保存的宠物图片暂时无法读取');
        const restoredUrl = URL.createObjectURL(await imageResponse.blob());
        if (!isCurrent()) {
          URL.revokeObjectURL(restoredUrl);
          return;
        }

        if (approvedAvatarUrlRef.current) URL.revokeObjectURL(approvedAvatarUrlRef.current);
        approvedAvatarUrlRef.current = restoredUrl;
        setApprovedAvatar(restoredUrl);
        setApprovedPetName(storedPet.petName);
        setPetKind(storedPet.kind);
        setPetNameDraft(storedPet.petName);
        setPetAgeOrBirthdayDraft(statusResult.ageOrBirthday ?? storedPet.ageOrBirthday);
        setPetGenderDraft(statusResult.gender === 'male' || statusResult.gender === 'female'
          ? statusResult.gender
          : storedPet.gender ?? '');
        setAvatarJobId(storedPet.jobId);
        setActivePetJobId(storedPet.jobId);
        setAvatarPreview(statusResult.previewUrl);
        setActionBatch(statusResult.actionBatch ?? null);
        setCustomVideoState(initialCustomVideoState(statusResult.actionBatch));
        setCreatorStatus('approved');
        setHomeView('custom');
        setRestoreError('');
        setNotice(`${storedPet.petName}已经回来啦`);
      } catch (error) {
        if (!isCurrent() || (error instanceof DOMException && error.name === 'AbortError')) return;
        if (clearStoredRecord && storedPet) {
          const nextStore = removePet(storedStore, storedPet.jobId);
          try {
            if (nextStore.pets.length) window.localStorage.setItem(APPROVED_PET_STORAGE_KEY, JSON.stringify(nextStore));
            else window.localStorage.removeItem(APPROVED_PET_STORAGE_KEY);
          } catch {
            // Private browsing may deny storage; the empty first-user flow still works.
          }
          setSavedPets(nextStore.pets);
          setRestoreError('');
          if (nextStore.pets.length) {
            setHomeView('restoring');
            setRestoreAttempt((value) => value + 1);
          } else {
            setActivePetJobId(null);
            setHomeView('empty');
            setNotice('上传一张宠物照片，确认卡通形象后，它才会出现在主页');
          }
          return;
        }
        const message = error instanceof Error ? error.message : '宠物记录暂时无法读取';
        setRestoreError(message);
        setHomeView('restoring');
        setNotice(`${message}；已保留记录，重试不会重新生成或计费`);
      }
    };

    void restoreApprovedPet();
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [restoreAttempt]);

  useEffect(() => {
    if (!avatarJobId || (creatorStatus !== 'queued' && creatorStatus !== 'generating')) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let consecutiveFailures = 0;

    const poll = async () => {
      try {
        const response = await fetch(`/api/pet-avatar/jobs/${encodeURIComponent(avatarJobId)}`, {
          cache: 'no-store',
        });
        const result = await response.json() as AvatarJobResponse;
        if (cancelled) return;
        if (!response.ok || result.status === 'error' || result.status === 'failed') {
          throw new Error(result.message || '无法读取生成进度');
        }
        consecutiveFailures = 0;
        setCreatorError('');
        if (result.status === 'ready_for_review' && result.previewUrl) {
          setAvatarPreview(result.previewUrl);
          setCreatorStatus('ready_for_review');
          return;
        }
        setCreatorStatus(result.status === 'queued' ? 'queued' : 'generating');
        timer = setTimeout(poll, result.pollAfterMs || 2000);
      } catch (error) {
        if (cancelled) return;
        consecutiveFailures += 1;
        const message = error instanceof Error ? error.message : '生成进度读取失败';
        if (consecutiveFailures >= 3) {
          setCreatorError(`${message}。原任务号已保留，点“继续查询原任务”不会重复生成或重复计费。`);
          setCreatorStatus('poll_error');
          return;
        }
        setCreatorError(`${message}，正在自动重试进度查询，不会新建 GPU 任务。`);
        timer = setTimeout(poll, 3500);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [avatarJobId, creatorStatus]);

  useEffect(() => {
    if (!avatarJobId || creatorStatus !== 'approved' || homeView !== 'custom') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastPlayable = actionBatch?.branches.filter(isPlayableBranch).length ?? 0;

    const pollActions = async (start = false) => {
      try {
        const response = await fetch(`/api/pet-avatar/jobs/${encodeURIComponent(avatarJobId)}/actions`, {
          method: start ? 'POST' : 'GET',
          cache: 'no-store',
        });
        const result = await response.json() as ActionProgressResponse;
        if (cancelled) return;
        if (!response.ok || result.status === 'error') {
          throw new Error(result.message || '无法读取动作生成进度');
        }
        if (result.actionBatch) setActionBatch(result.actionBatch);
        const playable = result.playable ?? result.actionBatch?.branches.filter(isPlayableBranch).length ?? 0;
        if (playable > lastPlayable) {
          lastPlayable = playable;
          setNotice(playable === 4
            ? '四个动作已全部准备好'
            : `第 ${playable} 个动作已准备好，可以先看；其余动作继续生成中`);
        }
        const stillGenerating = result.actionBatch?.branches.some((branch) => (
          branch.runState === 'queued' || branch.runState === 'generating'
        )) ?? false;
        if (result.status === 'complete' || result.status === 'planned' || !stillGenerating) return;
        timer = setTimeout(pollActions, result.pollAfterMs || 1500);
      } catch {
        if (cancelled) return;
        timer = setTimeout(pollActions, 3500);
      }
    };

    void pollActions(true);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  // The poll owns its last-playable counter; batch updates must not restart it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatarJobId, creatorStatus, homeView]);

  useEffect(() => {
    if (!creatorOpen) return;
    const previousOverflow = document.body.style.overflow;
    const trigger = creatorTriggerRef.current;
    document.body.style.overflow = 'hidden';
    const focusableSelector = 'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])';
    window.requestAnimationFrame(() => {
      creatorDialogRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCreatorOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !creatorDialogRef.current) return;
      const focusable = [...creatorDialogRef.current.querySelectorAll<HTMLElement>(focusableSelector)];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      trigger?.focus();
    };
  }, [creatorOpen]);

  useEffect(() => {
    if (homeView !== 'demo') return;
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
  }, [homeView, videoSources]);

  const getActionVideo = (kind: Action) => {
    if (kind === 'lick') return lickVideoRef.current;
    if (kind === 'feed') return feedVideoRef.current;
    return petVideoRef.current;
  };

  const getCustomBranch = (kind: MediaKey) =>
    actionBatch?.branches.find((item) => item.action === kind);
  const customMediaSourceIsCurrent = (kind: MediaKey, branch?: PetActionBranch) => {
    if (!actionBatch || !branch) return false;
    const expectedSourceKey = customBranchSourceKey(actionBatch, branch);
    const cachedSource = customVideoCache.sources[kind];
    const renderedSource = customVideoSources[kind];
    return Boolean(
      cachedSource
      && renderedSource === cachedSource
      && customVideoCache.batchId === actionBatch.id
      && customVideoCache.sourceKeys[kind] === expectedSourceKey
    );
  };
  const customMediaElementHasCurrentSource = (kind: MediaKey) => {
    const source = customVideoSources[kind];
    const video = kind === 'idle' ? idleVideoRef.current : getActionVideo(kind);
    return Boolean(source && video && (video.currentSrc || video.src) === source);
  };
  const releaseSourcePreview = () => {
    if (sourcePreviewUrlRef.current) URL.revokeObjectURL(sourcePreviewUrlRef.current);
    sourcePreviewUrlRef.current = null;
    setSourcePreview(null);
  };

  const chooseAnotherPhoto = () => {
    if (['checking', 'submitting', 'queued', 'generating', 'confirming'].includes(creatorStatus)) return;
    fileInputRef.current?.click();
  };

  const onPhotoSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    restoreSequenceRef.current += 1;
    setRestoreError('');
    releaseSourcePreview();
    setSelectedPhoto(null);
    setPhotoInfo(null);
    setAvatarJobId(null);
    setAvatarRequestKey(null);
    setAvatarPreview(null);
    setAvatarCached(false);
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

  const generateAvatar = async () => {
    if (!selectedPhoto || !['ready', 'error'].includes(creatorStatus) || petKind !== 'cat') return;
    const requestKey = avatarRequestKey ?? crypto.randomUUID();
    setAvatarRequestKey(requestKey);
    setCreatorError('');
    setAvatarPreview(null);
    setAvatarJobId(null);
    setAvatarCached(false);
    setCreatorStatus('submitting');

    try {
      const form = new FormData();
      form.append('photo', selectedPhoto);
      form.append('petKind', petKind);
      form.append('petName', petNameDraft.trim() || '我的宝贝');
      form.append('ageOrBirthday', petAgeOrBirthdayDraft.trim());
      form.append('gender', petGenderDraft);
      const response = await fetch('/api/pet-avatar/jobs', {
        method: 'POST',
        headers: { 'Idempotency-Key': requestKey },
        body: form,
      });
      const result = await response.json().catch(() => ({
        status: 'error',
        message: response.status === 413
          ? '照片上传超过网页服务限制，请换一张不超过 12MB 的照片'
          : '生成服务返回了无法读取的结果',
      })) as AvatarJobResponse;
      if (result.jobId) setAvatarJobId(result.jobId);
      if (!response.ok) throw new Error(result.message || '卡通母版生成失败');
      if (!result.jobId) throw new Error('生成服务没有返回任务编号');

      setAvatarCached(Boolean(result.cached));
      if (result.status === 'ready_for_review' && result.previewUrl) {
        setAvatarPreview(result.previewUrl);
        setCreatorStatus('ready_for_review');
      } else {
        setCreatorStatus(result.status === 'generating' ? 'generating' : 'queued');
      }
    } catch (error) {
      setCreatorError(error instanceof Error ? error.message : '卡通母版生成失败');
      setCreatorStatus('error');
    }
  };

  const rememberApprovedPet = (jobId: string, petName: string) => {
    restoreSequenceRef.current += 1;
    setActivePetJobId(jobId);
    try {
      const nextStore = upsertPet(
        parsePetStore(window.localStorage.getItem(APPROVED_PET_STORAGE_KEY)),
        {
        jobId,
        petName,
        kind: petKind,
        ageOrBirthday: petAgeOrBirthdayDraft.trim(),
        gender: petGenderDraft || null,
        },
      );
      window.localStorage.setItem(APPROVED_PET_STORAGE_KEY, JSON.stringify(nextStore));
      setSavedPets(nextStore.pets);
    } catch {
      // The current page still works if storage is unavailable.
    }
  };

  const selectSavedPet = (pet: SavedPetProfile) => {
    if (pet.jobId === activePetJobId || creatorWorking) return;
    try {
      const nextStore = selectPet(parsePetStore(
        window.localStorage.getItem(APPROVED_PET_STORAGE_KEY),
      ), pet.jobId);
      window.localStorage.setItem(APPROVED_PET_STORAGE_KEY, JSON.stringify(nextStore));
      setSavedPets(nextStore.pets);
    } catch {
      setNotice('当前浏览器不允许切换宠物档案');
      return;
    }
    setCreatorOpen(false);
    setActivePetJobId(pet.jobId);
    setIdleFramePresented(false);
    setHomeView('restoring');
    setRestoreError('');
    setNotice(`正在打开${pet.petName}的档案`);
    setRestoreAttempt((value) => value + 1);
  };

  const openNewPetCreator = () => {
    if (creatorWorking) return;
    releaseSourcePreview();
    setSelectedPhoto(null);
    setPhotoInfo(null);
    setAvatarRequestKey(null);
    setAvatarPreview(null);
    setAvatarCached(false);
    setCreatorError('');
    setCreatorStatus('empty');
    setPetKind('cat');
    setPetNameDraft('我的宝贝');
    setPetAgeOrBirthdayDraft('');
    setPetGenderDraft('');
    setCreatorOpen(true);
  };

  const reviewAvatar = async (approved: boolean) => {
    if (!avatarJobId || !avatarPreview || creatorStatus !== 'ready_for_review') return;
    setCreatorError('');
    setCreatorStatus('confirming');
    let preparedLocalUrl: string | null = null;
    try {
      if (approved) {
        const imageResponse = await fetch(avatarPreview, { cache: 'no-store' });
        if (!imageResponse.ok) throw new Error('母版图片读取失败');
        preparedLocalUrl = URL.createObjectURL(await imageResponse.blob());
      }

      const response = await fetch(`/api/pet-avatar/jobs/${encodeURIComponent(avatarJobId)}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approved,
          petName: petNameDraft.trim() || '我的宝贝',
          ageOrBirthday: petAgeOrBirthdayDraft.trim(),
          gender: petGenderDraft || null,
        }),
      });
      const result = await response.json() as AvatarJobResponse;
      if (!response.ok) throw new Error(result.message || '母版确认失败');

      if (!approved) {
        setCreatorStatus('rejected');
        setNotice('你已标记这张母版不够像；不会用它生成动作');
        return;
      }

      if (!preparedLocalUrl) throw new Error('母版图片尚未准备好');
      cancelMediaTransition();
      [lickVideoRef.current, feedVideoRef.current, petVideoRef.current].forEach((video) => {
        if (!video) return;
        video.pause();
        video.currentTime = 0;
      });
      if (approvedAvatarUrlRef.current) URL.revokeObjectURL(approvedAvatarUrlRef.current);
      approvedAvatarUrlRef.current = preparedLocalUrl;
      setIdleFramePresented(false);
      setApprovedAvatar(preparedLocalUrl);
      preparedLocalUrl = null;
      const confirmedPetName = petNameDraft.trim() || '我的宝贝';
      setApprovedPetName(confirmedPetName);
      setPetAgeOrBirthdayDraft(result.ageOrBirthday ?? petAgeOrBirthdayDraft.trim());
      setPetGenderDraft(result.gender === 'male' || result.gender === 'female' ? result.gender : '');
      setActionBatch(result.actionBatch ?? null);
      setCustomVideoState(initialCustomVideoState(result.actionBatch));
      setActiveAction(null);
      setFeedPhase('hidden');
      setCreatorStatus('approved');
      setHomeView('custom');
      rememberApprovedPet(avatarJobId, confirmedPetName);
      setNotice(`${confirmedPetName}已经加入你的宠物档案`);
      setCreatorOpen(false);
    } catch (error) {
      if (preparedLocalUrl) URL.revokeObjectURL(preparedLocalUrl);
      const fallbackMessage = error instanceof Error ? error.message : '母版确认失败';
      try {
        const statusResponse = await fetch(`/api/pet-avatar/jobs/${encodeURIComponent(avatarJobId)}`, {
          cache: 'no-store',
        });
        const statusResult = await statusResponse.json() as AvatarJobResponse;
        if (statusResult.status === 'rejected') {
          setCreatorStatus('rejected');
          setNotice('你已标记这张母版不够像；不会用它生成动作');
          return;
        }
        if (statusResult.status === 'approved' && statusResult.previewUrl) {
          const imageResponse = await fetch(statusResult.previewUrl, { cache: 'no-store' });
          if (!imageResponse.ok) throw new Error('已确认母版，但图片暂时无法读取');
          const recoveredUrl = URL.createObjectURL(await imageResponse.blob());
          cancelMediaTransition();
          [lickVideoRef.current, feedVideoRef.current, petVideoRef.current].forEach((video) => {
            if (!video) return;
            video.pause();
            video.currentTime = 0;
          });
          if (approvedAvatarUrlRef.current) URL.revokeObjectURL(approvedAvatarUrlRef.current);
          approvedAvatarUrlRef.current = recoveredUrl;
          setIdleFramePresented(false);
          setApprovedAvatar(recoveredUrl);
          const confirmedPetName = petNameDraft.trim() || '我的宝贝';
          setApprovedPetName(confirmedPetName);
          setPetAgeOrBirthdayDraft(statusResult.ageOrBirthday ?? petAgeOrBirthdayDraft.trim());
          setPetGenderDraft(statusResult.gender === 'male' || statusResult.gender === 'female'
            ? statusResult.gender
            : '');
          setActionBatch(statusResult.actionBatch ?? null);
          setCustomVideoState(initialCustomVideoState(statusResult.actionBatch));
          setActiveAction(null);
          setFeedPhase('hidden');
          setCreatorStatus('approved');
          setHomeView('custom');
          rememberApprovedPet(avatarJobId, confirmedPetName);
          setNotice(`${confirmedPetName}已经加入你的宠物档案`);
          setCreatorOpen(false);
          return;
        }
      } catch {
        // Keep the original confirmation error below; the job can be checked again.
      }
      setCreatorError(`${fallbackMessage}。已保留原任务，请再次确认。`);
      setCreatorStatus('ready_for_review');
    }
  };

  const keepIdlePlaying = () => {
    const video = idleVideoRef.current;
    if (!video) return;
    void confirmIdleFramePresented(video);
  };

  const beginMediaTransition = (target: MediaKey) => {
    mediaTransitionLocked.current = true;
    mediaTransitionTarget.current = target;
    setMediaTransitioning(true);
    mediaTransitionSequence.current += 1;
    return mediaTransitionSequence.current;
  };

  const completeMediaTransition = (sequence: number) => {
    if (sequence !== mediaTransitionSequence.current) return;
    mediaTransitionLocked.current = false;
    mediaTransitionTarget.current = null;
    setMediaTransitioning(false);
  };

  const clearActionWatchdog = (kind?: Action) => {
    const watchdog = actionWatchdogRef.current;
    if (!watchdog || (kind && watchdog.action !== kind)) return;
    clearTimeout(watchdog.timer);
    actionWatchdogRef.current = null;
  };

  const clearActionHandoffWatch = (kind?: Action) => {
    const handoffWatch = actionHandoffWatchRef.current;
    if (!handoffWatch || (kind && handoffWatch.action !== kind)) return;
    const video = handoffWatch.video;
    if (video && typeof video.cancelVideoFrameCallback === 'function') {
      video.cancelVideoFrameCallback(handoffWatch.callbackId);
    }
    actionHandoffWatchRef.current = null;
  };

  const cancelMediaTransition = () => {
    mediaTransitionSequence.current += 1;
    mediaTransitionLocked.current = false;
    mediaTransitionTarget.current = null;
    setMediaTransitioning(false);
    pendingEndedActionRef.current = null;
    clearActionWatchdog();
    clearActionHandoffWatch();
    setCanonicalAnchorPhase('idle');
    if (bowlAnimationWaitRef.current) {
      clearTimeout(bowlAnimationWaitRef.current.timer);
      bowlAnimationWaitRef.current.resolve(false);
      bowlAnimationWaitRef.current = null;
    }
  };

  const waitForBowlAnimation = (phase: 'entering' | 'exiting') => new Promise<boolean>((resolve) => {
    if (bowlAnimationWaitRef.current) {
      clearTimeout(bowlAnimationWaitRef.current.timer);
      bowlAnimationWaitRef.current.resolve(false);
    }
    const waiter = {
      phase,
      timer: 0,
      resolve,
    };
    waiter.timer = window.setTimeout(() => {
      if (bowlAnimationWaitRef.current !== waiter) return;
      bowlAnimationWaitRef.current = null;
      resolve(true);
    }, BOWL_TRANSITION_MS + 500);
    bowlAnimationWaitRef.current = waiter;
  });

  const finishBowlAnimation = (phase: FeedPhase, animationName: string) => {
    const waiter = bowlAnimationWaitRef.current;
    const expectedAnimation = phase === 'entering'
      ? 'bowlEnter'
      : phase === 'exiting'
        ? 'bowlExit'
        : null;
    if (!expectedAnimation || animationName !== expectedAnimation || waiter?.phase !== phase) return;
    clearTimeout(waiter.timer);
    bowlAnimationWaitRef.current = null;
    waiter.resolve(true);
  };

  const showDemo = () => {
    setIdleFramePresented(false);
    setHomeView('demo');
    setNotice('小灰只是功能示例；上传并确认你自己的宠物后，主页才会换成它');
  };

  const exitDemo = () => {
    cancelMediaTransition();
    [idleVideoRef.current, lickVideoRef.current, feedVideoRef.current, petVideoRef.current].forEach((video) => {
      if (!video) return;
      video.pause();
      video.currentTime = 0;
    });
    setIdleFramePresented(false);
    setActiveAction(null);
    setFeedPhase('hidden');
    setHomeView('empty');
    setNotice('已退出小灰示例；上传并确认一张照片后，宠物才会出现在主页');
  };

  const onMediaLoaded = (kind: MediaKey) => {
    const loadedState = videoSources[kind] === PRIMARY_VIDEOS[kind] ? 'ready' : 'fallback';
    setVideoState((current) => ({ ...current, [kind]: loadedState }));
    if (kind === 'idle' && idleVideoRef.current) {
      void confirmIdleFramePresented(idleVideoRef.current);
    }
  };

  const onMediaError = (kind: MediaKey) => {
    if (kind === 'idle') {
      setIdleFramePresented(false);
      cancelMediaTransition();
      [lickVideoRef.current, feedVideoRef.current, petVideoRef.current].forEach((video) => {
        if (!video) return;
        video.pause();
        video.currentTime = 0;
      });
      setActiveAction(null);
      setFeedPhase('hidden');
    } else if (mediaTransitionTarget.current === kind || actionRef.current === kind) {
      cancelMediaTransition();
    } else {
      clearActionWatchdog(kind);
    }
    if (kind === 'feed') setFeedPhase('hidden');
    const video = kind === 'idle' ? idleVideoRef.current : getActionVideo(kind);
    if (video) video.pause();

    const fallback = FALLBACK_VIDEOS[kind];
    if (fallback && videoSources[kind] === PRIMARY_VIDEOS[kind]) {
      setVideoSources((current) => ({ ...current, [kind]: fallback }));
      setVideoState((current) => ({ ...current, [kind]: 'loading' }));
      setActiveAction((current) => current === kind ? null : current);
      if (kind !== 'idle') keepIdlePlaying();
      setNotice(`${kind === 'idle' ? '待机' : ACTION_LABELS[kind]}主成片加载失败，已自动切换 POC 回退`);
      return;
    }

    if (kind === 'feed') {
      setVideoState((current) => ({ ...current, feed: 'fallback' }));
      setActiveAction((current) => current === 'feed' ? null : current);
      keepIdlePlaying();
      setNotice('喂食成片不可用，已切换到可演示的交互回退');
      return;
    }

    setVideoState((current) => ({ ...current, [kind]: 'error' }));
    setActiveAction((current) => current === kind ? null : current);
    if (kind !== 'idle') keepIdlePlaying();
    setNotice(`${kind === 'idle' ? '待机' : ACTION_LABELS[kind]}视频和回退都加载失败，其他入口仍可体验`);
  };

  const customMediaEventIsCurrent = (
    kind: MediaKey,
    revisionKey: string | null,
    sourceKey: string | undefined,
    sourceUrl: string | undefined,
    video: HTMLVideoElement,
  ) => {
    const cache = customVideoCacheRef.current;
    const expectedVideo = kind === 'idle' ? idleVideoRef.current : getActionVideo(kind);
    const actualSource = video.currentSrc || video.src;
    return Boolean(
      revisionKey
      && sourceKey
      && sourceUrl
      && cache.revisionKey === revisionKey
      && cache.sourceKeys[kind] === sourceKey
      && cache.sources[kind] === sourceUrl
      && expectedVideo === video
      && actualSource === sourceUrl,
    );
  };

  const onCustomMediaLoaded = (
    kind: MediaKey,
    revisionKey: string | null,
    sourceKey: string | undefined,
    sourceUrl: string | undefined,
    video: HTMLVideoElement,
  ) => {
    if (!customMediaEventIsCurrent(kind, revisionKey, sourceKey, sourceUrl, video)) return;
    setCustomVideoState((current) => ({ ...current, [kind]: 'ready' }));
    setCustomVideoReadySources((current) => ({ ...current, [kind]: sourceUrl }));
    if (kind === 'idle') {
      void confirmIdleFramePresented(video);
    }
  };

  const onCustomMediaError = (
    kind: MediaKey,
    revisionKey: string | null,
    sourceKey: string | undefined,
    sourceUrl: string | undefined,
    video: HTMLVideoElement,
  ) => {
    if (!customMediaEventIsCurrent(kind, revisionKey, sourceKey, sourceUrl, video)) return;
    if (kind === 'idle') {
      setIdleFramePresented(false);
      cancelMediaTransition();
      [lickVideoRef.current, feedVideoRef.current, petVideoRef.current].forEach((video) => {
        if (!video) return;
        video.pause();
        video.currentTime = 0;
      });
      setActiveAction(null);
      setFeedPhase('hidden');
    } else if (mediaTransitionTarget.current === kind || actionRef.current === kind) {
      cancelMediaTransition();
    } else {
      clearActionWatchdog(kind as Action);
    }
    if (kind === 'feed') setFeedPhase('hidden');
    video.pause();
    setCustomVideoState((current) => ({ ...current, [kind]: 'error' }));
    setCustomVideoReadySources((current) => {
      if (!(kind in current)) return current;
      const next = { ...current };
      delete next[kind];
      return next;
    });
    setActiveAction((current) => current === kind ? null : current);
    if (kind !== 'idle') keepIdlePlaying();
    setNotice(`${kind === 'idle' ? '待机' : ACTION_LABELS[kind as Action]}个性化成片加载失败；不会回退播放小灰的视频`);
  };

  const playFeedFallback = async () => {
    if (actionRef.current || mediaTransitionLocked.current) return;
    const enterSequence = beginMediaTransition('feed');
    setFeedPhase('entering');
    setNotice('装满多粒猫粮的猫碗正在滑入……');
    const bowlEntered = await waitForBowlAnimation('entering');
    if (!bowlEntered || enterSequence !== mediaTransitionSequence.current) return;
    setFeedPhase('holding');
    await waitForReactPaint();
    if (enterSequence !== mediaTransitionSequence.current) return;
    setActiveAction('feed');
    setNotice('小灰闻到了香香的猫粮……');
    completeMediaTransition(enterSequence);

    await waitForMs(1800);
    if (enterSequence !== mediaTransitionSequence.current) return;
    const exitSequence = beginMediaTransition('idle');
    setActiveAction(null);
    setFeedPhase('exiting');
    setNotice('小灰已回到待机，猫碗正在退场……');
    const bowlExited = await waitForBowlAnimation('exiting');
    if (!bowlExited || exitSequence !== mediaTransitionSequence.current) return;
    setFeedPhase('hidden');
    setFullness((value) => Math.min(100, value + 12));
    setNotice('喂食完成，饱腹度 +12');
    completeMediaTransition(exitSequence);
  };

  const returnCustomPetToIdle = async (transitionSequence: number) => {
    setCanonicalAnchorPhase('returning');
    setActiveAction(null);
    await waitForReactPaint();
    if (transitionSequence !== mediaTransitionSequence.current) return false;

    const idleVideo = idleVideoRef.current;
    if (!idleVideo) {
      setIdleFramePresented(false);
      setCanonicalAnchorPhase('idle');
      return false;
    }

    const ready = await prepareIdleReturnFrame(
      idleVideo,
      () => mediaTransitionSequence.current === transitionSequence,
    );
    if (!ready || transitionSequence !== mediaTransitionSequence.current) {
      setIdleFramePresented(false);
      setCanonicalAnchorPhase('idle');
      return false;
    }
    const presented = await confirmIdleFramePresented(idleVideo, VIDEO_FRAME_TIMEOUT_MS);
    if (transitionSequence !== mediaTransitionSequence.current) return false;
    setCanonicalAnchorPhase('idle');
    return presented;
  };

  const playVideo = async (next: Action) => {
    if (homeView !== 'demo' && homeView !== 'custom') {
      setCreatorOpen(true);
      return;
    }
    const customMode = homeView === 'custom' && Boolean(approvedAvatar);
    const usesLayeredFeedFx = homeView === 'demo' && next === 'feed' && videoState.feed === 'fallback';
    const customBranch = getCustomBranch(next);
    if (customMode && !isPlayableBranch(customBranch)) {
      setNotice(customBranch?.message ?? '这个个性化动作尚未准备好');
      return;
    }
    if (
      customMode
      && (
        !customMediaSourceIsCurrent(next, customBranch)
        || customVideoReadySources[next] !== customVideoSources[next]
        || !customMediaElementHasCurrentSource(next)
      )
    ) {
      setNotice('这个动作的成片还在加载，其他已完成的动作可以先看');
      return;
    }
    if (!customMode && next === 'feed' && videoState.feed === 'fallback') {
      void playFeedFallback();
      return;
    }

    const video = getActionVideo(next);
    const activeMediaState = customMode ? customVideoState[next] : videoState[next];
    if (!video || actionRef.current || mediaTransitionLocked.current || activeMediaState === 'loading' || activeMediaState === 'error') return;
    const transitionSequence = beginMediaTransition(next);
    [lickVideoRef.current, feedVideoRef.current, petVideoRef.current].forEach((item) => {
      if (item && item !== video) { item.pause(); item.currentTime = 0; }
    });
    const activePetName = customMode ? approvedPetName : '小灰';
    setNotice(next === 'lick'
      ? `${activePetName}正在认真清理小爪子……`
      : next === 'feed'
        ? '正在准备装满多粒猫粮的猫碗……'
        : `${activePetName}放松地抬起下巴，舒服地眯起了眼睛……`);
    const startFrameReady = await ensureVideoStartFrame(video);
    if (transitionSequence !== mediaTransitionSequence.current) return;
    if (!startFrameReady) {
      completeMediaTransition(transitionSequence);
      setNotice(`“${ACTION_LABELS[next]}”首帧还没准备好，请再点一次`);
      return;
    }
    if (usesLayeredFeedFx) {
      setFeedPhase('entering');
      setNotice('猫碗正在滑入；猫仍保持待机，不会边切视频边入场');
      const bowlEntered = await waitForBowlAnimation('entering');
      if (!bowlEntered || transitionSequence !== mediaTransitionSequence.current) return;
      setFeedPhase('holding');
      await waitForReactPaint();
      if (transitionSequence !== mediaTransitionSequence.current) return;
      setNotice(`${activePetName}正在猫碗里吃猫粮……`);
    } else if (next === 'feed') {
      setNotice(`${activePetName}正在猫碗里吃猫粮……`);
    }
    if (customMode) {
      // A click can happen at any point in the looping idle clip. Settle that arbitrary
      // frame onto the approved master before revealing the compiled action's anchor.
      setCanonicalAnchorPhase('entering');
      await waitForReactPaint();
      await waitForMs(CANONICAL_ANCHOR_SETTLE_MS);
      if (transitionSequence !== mediaTransitionSequence.current) return;
      idleVideoRef.current?.pause();
      setIdleFramePresented(false);
    }
    const playbackStarted = await tryStartVideoOnPresentedFrame(video);
    if (!playbackStarted) {
      if (transitionSequence !== mediaTransitionSequence.current) return;
      if (customMode) {
        await returnCustomPetToIdle(transitionSequence);
      } else {
        setActiveAction(null);
        await waitForReactPaint();
      }
      if (transitionSequence !== mediaTransitionSequence.current) return;
      video.pause();
      video.currentTime = 0;
      if (usesLayeredFeedFx) {
        setFeedPhase('exiting');
        const bowlExited = await waitForBowlAnimation('exiting');
        if (!bowlExited || transitionSequence !== mediaTransitionSequence.current) return;
        setFeedPhase('hidden');
      }
      completeMediaTransition(transitionSequence);
      setNotice(`浏览器没有启动播放，请再点一次“${ACTION_LABELS[next]}”`);
      return;
    }
    if (transitionSequence !== mediaTransitionSequence.current) return;
    setIdleFramePresented(false);
    setActiveAction(next);
    if (customMode) setCanonicalAnchorPhase('action');
    clearActionWatchdog(next);
    clearActionHandoffWatch(next);
    const expectedDurationMs = Number.isFinite(video.duration) && video.duration > 0
      ? Math.ceil(video.duration * 1000) + 2500
      : 9000;
    const watchdogTimer = window.setTimeout(() => {
      const watchdog = actionWatchdogRef.current;
      if (!watchdog || watchdog.action !== next || watchdog.sequence !== transitionSequence) return;
      actionWatchdogRef.current = null;
      clearActionHandoffWatch(next);
      video.pause();
      video.currentTime = 0;
      cancelMediaTransition();
      setActiveAction(null);
      setFeedPhase('hidden');
      const idleVideo = idleVideoRef.current;
      if (idleVideo) {
        void ensureVideoStartFrame(idleVideo).then((ready) => {
          if (ready) keepIdlePlaying();
        });
      }
      setNotice(`“${ACTION_LABELS[next]}”播放超时，已安全退回待机，没有重新生成`);
    }, Math.max(6500, expectedDurationMs));
    actionWatchdogRef.current = {
      action: next,
      sequence: transitionSequence,
      timer: watchdogTimer,
    };
    completeMediaTransition(transitionSequence);
    if (pendingEndedActionRef.current === next) {
      pendingEndedActionRef.current = null;
      window.queueMicrotask(() => void finishVideo(next));
      return;
    }
    const idleVideo = idleVideoRef.current;
    if (idleVideo) {
      void prepareIdleReturnFrame(
        idleVideo,
        () => mediaTransitionSequence.current === transitionSequence,
      );
    }

    const timedBranch = customMode ? customBranch as TimedPetActionBranch | undefined : undefined;
    const fps = timedBranch?.fps;
    const handoffOutFrame = timedBranch?.handoffOutFrame;
    if (
      customMode
      && typeof video.requestVideoFrameCallback === 'function'
      && Number.isFinite(fps)
      && Number.isFinite(handoffOutFrame)
      && (fps ?? 0) > 0
      && (handoffOutFrame ?? -1) >= 0
    ) {
      const handoffMediaTime = (handoffOutFrame as number) / (fps as number);
      const inspectPresentedFrame = (_now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) => {
        const watch = actionHandoffWatchRef.current;
        if (!watch || watch.action !== next || watch.sequence !== transitionSequence) return;
        if (metadata.mediaTime + (0.25 / (fps as number)) >= handoffMediaTime) {
          actionHandoffWatchRef.current = null;
          window.queueMicrotask(() => void finishVideo(next));
          return;
        }
        watch.callbackId = video.requestVideoFrameCallback(inspectPresentedFrame);
      };
      const callbackId = video.requestVideoFrameCallback(inspectPresentedFrame);
      actionHandoffWatchRef.current = {
        action: next,
        sequence: transitionSequence,
        video,
        callbackId,
      };
    }
  };

  const finishVideo = async (completed: Action) => {
    const usesLayeredFeedFx = completed === 'feed' && homeView === 'demo' && videoState.feed === 'fallback';
    const customMode = homeView === 'custom' && Boolean(approvedAvatar);
    if (actionRef.current !== completed) {
      if (mediaTransitionLocked.current && mediaTransitionTarget.current === completed) {
        pendingEndedActionRef.current = completed;
      }
      return;
    }
    if (mediaTransitionLocked.current) {
      pendingEndedActionRef.current = completed;
      return;
    }
    pendingEndedActionRef.current = null;
    clearActionWatchdog(completed);
    clearActionHandoffWatch(completed);
    const video = getActionVideo(completed);
    const idleVideo = idleVideoRef.current;
    if (!video) return;
    if (customMode) {
      const transitionSequence = beginMediaTransition('idle');
      setNotice('动作尾锚帧已呈现，正在恢复待机首帧……');
      const idlePlaybackStarted = await returnCustomPetToIdle(transitionSequence);
      if (transitionSequence !== mediaTransitionSequence.current) return;
      video.pause();
      video.currentTime = 0;
      pendingEndedActionRef.current = null;
      setFeedPhase('hidden');
      if (completed === 'pet') {
        setBond((value) => Math.min(100, value + 5));
        setNotice(`摸头完成，亲密度 +5${idlePlaybackStarted ? '' : '；当前使用静态母版'}`);
      } else if (completed === 'feed') {
        setFullness((value) => Math.min(100, value + 12));
        setNotice(`喂食完成，饱腹度 +12${idlePlaybackStarted ? '' : '；当前使用静态母版'}`);
      } else {
        setNotice(`舔爪完成，${approvedPetName}已回到待机状态${idlePlaybackStarted ? '' : '；当前使用静态母版'}`);
      }
      completeMediaTransition(transitionSequence);
      return;
    }
    if (!idleVideo) {
      video.pause();
      video.currentTime = 0;
      cancelMediaTransition();
      setActiveAction(null);
      setFeedPhase('hidden');
      setNotice('待机媒体不可用；已退回当前宠物的静态母版');
      return;
    }
    const transitionSequence = beginMediaTransition('idle');
    setNotice('动作已完成，正在对齐待机首帧……');

    let idleReady = false;
    for (let attempt = 0; attempt < 3 && !idleReady; attempt += 1) {
      idleReady = await prepareIdleReturnFrame(
        idleVideo,
        () => mediaTransitionSequence.current === transitionSequence,
      );
      if (!idleReady) await waitForMs(120);
    }
    if (transitionSequence !== mediaTransitionSequence.current) return;
    if (!idleReady) {
      video.pause();
      video.currentTime = 0;
      setActiveAction(null);
      setFeedPhase('hidden');
      completeMediaTransition(transitionSequence);
      setNotice('待机首帧尚未就绪；已退回静态母版，没有将界面卡在动作尾帧');
      return;
    }
    const idlePlaybackStarted = await confirmIdleFramePresented(idleVideo, VIDEO_FRAME_TIMEOUT_MS);
    if (transitionSequence !== mediaTransitionSequence.current) return;
    setActiveAction(null);
    await waitForReactPaint();
    if (transitionSequence !== mediaTransitionSequence.current) return;

    if (completed === 'pet') {
      setBond((value) => Math.min(100, value + 5));
      setNotice(`摸头完成，亲密度 +5${idlePlaybackStarted ? '' : '；待机暂停在首帧'}`);
    } else if (completed === 'feed' && usesLayeredFeedFx) {
      setNotice(`${approvedAvatar ? approvedPetName : '小灰'}已回到待机，猫碗正在退场……`);
    } else if (completed === 'feed') {
      setNotice(`喂食完成，饱腹度 +12${idlePlaybackStarted ? '' : '；待机暂停在首帧'}`);
    } else {
      setNotice(`舔爪完成，${approvedAvatar ? approvedPetName : '小灰'}已回到待机状态${idlePlaybackStarted ? '' : '；当前停在首帧'}`);
    }
    if (completed === 'feed' && usesLayeredFeedFx) {
      await waitForReactPaint();
      if (transitionSequence !== mediaTransitionSequence.current) return;
      setFeedPhase('exiting');
      const bowlExited = await waitForBowlAnimation('exiting');
      if (!bowlExited || transitionSequence !== mediaTransitionSequence.current) return;
      setFeedPhase('hidden');
      setFullness((value) => Math.min(100, value + 12));
      setNotice(`喂食完成，饱腹度 +12${idlePlaybackStarted ? '' : '；待机暂停在首帧'}`);
      video.pause();
      video.currentTime = 0;
      completeMediaTransition(transitionSequence);
    } else {
      if (completed === 'feed') {
        setFullness((value) => Math.min(100, value + 12));
      }
      video.pause();
      video.currentTime = 0;
      completeMediaTransition(transitionSequence);
    }
  };

  const customPetActive = homeView === 'custom' && Boolean(approvedAvatar);
  const demoPetActive = homeView === 'demo';
  const restoringPet = homeView === 'restoring';
  const onboardingActive = !customPetActive && !demoPetActive;
  const hasPetHome = customPetActive || demoPetActive;
  const canUseLayeredFeedFx = demoPetActive && videoState.feed === 'fallback';
  const customBranches = actionBatch?.branches ?? [];
  const customIdleBranch = customBranches.find((item) => item.action === 'idle');
  const customLickBranch = customBranches.find((item) => item.action === 'lick');
  const customFeedBranch = customBranches.find((item) => item.action === 'feed');
  const customPetBranch = customBranches.find((item) => item.action === 'pet');
  const customBranchForAction = (kind: Action) => customBranches.find((item) => item.action === kind);
  const creatorWorking = ['checking', 'submitting', 'queued', 'generating', 'confirming'].includes(creatorStatus);
  const mediaLoading = demoPetActive && Object.values(videoState).some((state) => state === 'loading');
  const mediaError = demoPetActive && Object.values(videoState).some((state) => state === 'error');
  const mediaFallback = demoPetActive && Object.values(videoState).some((state) => state === 'fallback');
  const stageMode = action ?? (feedPhase !== 'hidden' ? 'feed' : customPetActive ? 'custom' : demoPetActive ? 'idle' : 'empty');

  const stateLabel = action === 'lick'
      ? '舔爪中'
      : action === 'feed'
          ? '喂食中'
        : action === 'pet'
          ? '摸头中'
          : feedPhase === 'entering'
            ? '猫碗入场'
            : feedPhase === 'exiting'
              ? '返回待机'
          : customPetActive
            ? '待机中'
          : restoringPet
            ? '正在读取你的宠物'
          : onboardingActive
            ? '还没有宠物'
          : mediaLoading
            ? '加载成片'
            : mediaError
              ? '部分可用'
              : mediaFallback
                ? '回退可用'
                : '待机中';
  const messageIcon = action === 'feed' || feedPhase !== 'hidden' ? '●' : action === 'pet' ? '♥' : action === 'lick' ? '✦' : customPetActive ? '✓' : '♡';
  const busy = action !== null || mediaTransitioning || feedPhase !== 'hidden';
  const usingFeedFallback = demoPetActive && action === 'feed' && videoState.feed === 'fallback';
  const hideIdle = action !== null && !usingFeedFallback;
  const customIdleHidden = canonicalAnchorPhase !== 'idle' || hideIdle || !idleFramePresented;
  const customIdleClassName = `idlePet${canonicalAnchorPhase === 'entering' ? ' anchorSettling' : ''}${customIdleHidden ? ' mediaHidden' : ''}`;
  const customAnchorHidden = canonicalAnchorPhase === 'action'
    || (canonicalAnchorPhase === 'idle' && idleFramePresented);
  const buttonNote = (kind: Action) => {
    if (customPetActive) {
      const branch = customBranchForAction(kind);
      if (!branch) return '暂不可用';
      if (isPlayableBranch(branch) && customVideoState[kind] === 'loading') return '准备中…';
      if (isPlayableBranch(branch) && customVideoState[kind] === 'error') return '稍后再试';
      if (branch.runState === 'queued' || branch.runState === 'generating') return '制作中…';
      if (branch.runState === 'failed') return '稍后再试';
      if (branch.runState === 'not_started') return '待解锁';
      return '轻点互动';
    }
    return videoState[kind] === 'fallback'
      ? '轻点互动'
      : videoState[kind] === 'loading'
        ? '准备中…'
        : videoState[kind] === 'error'
          ? '稍后再试'
          : '轻点互动';
  };

  const customActionDisabled = (kind: Action) => {
    const branch = customBranchForAction(kind);
    return !isPlayableBranch(branch)
      || !customMediaSourceIsCurrent(kind, branch)
      || customVideoState[kind] !== 'ready'
      || customVideoReadySources[kind] !== customVideoSources[kind];
  };

  const demoActionDisabled = (kind: Action) => videoState.idle === 'loading'
    || videoState.idle === 'error'
    || videoState[kind] === 'loading'
    || videoState[kind] === 'error';

  const customActionClass = (kind: Action) => {
    const branch = customBranchForAction(kind);
    if (branch?.capability === 'validated') return 'ready';
    if (branch?.capability === 'poc') return 'prototype';
    return 'pending';
  };

  const generationLabel = creatorStatus === 'submitting'
    ? '正在上传原图'
    : creatorStatus === 'queued'
      ? '已进入 GPU 队列'
      : '正在生成卡通母版';

  return (
    <main className="shell">
      <section className="phone" aria-label="小爪星球宠物互动 POC" data-home-view={homeView}>
        <header className="header">
          <div><span>我的宠物</span><h1>{customPetActive ? approvedPetName : demoPetActive ? '小灰' : restoringPet ? '正在读取' : '还没有宠物'}</h1></div>
          <div className="proof"><i /> POC</div>
        </header>

        {savedPets.length > 0 ? <nav className="petProfiles" aria-label="我的宠物档案">
          {savedPets.map((pet) => <button
            key={pet.jobId}
            type="button"
            className={pet.jobId === activePetJobId ? 'active' : ''}
            aria-pressed={pet.jobId === activePetJobId}
            disabled={creatorWorking || busy}
            onClick={() => selectSavedPet(pet)}
          ><span aria-hidden="true">{pet.kind === 'dog' ? '🐶' : '🐱'}</span><strong>{pet.petName}</strong></button>)}
          <button ref={creatorTriggerRef} className="addPetProfile" type="button" aria-haspopup="dialog" disabled={creatorWorking || busy} onClick={openNewPetCreator}><span aria-hidden="true">＋</span><strong>添加宠物</strong></button>
        </nav> : <button ref={creatorTriggerRef} className="creatorEntry" type="button" aria-haspopup="dialog" disabled={restoringPet} onClick={() => setCreatorOpen(true)}>
          <span className="creatorEntryIcon">＋</span>
          <span className="creatorEntryCopy">
            <strong>上传照片，创建我的宠物</strong>
            <small>{demoPetActive ? '小灰只是示例 · 上传后创建你的宠物' : '先生成卡通形象，再加入宠物档案'}</small>
          </span>
          <span className="creatorEntryArrow" aria-hidden="true">›</span>
        </button>}

        <section className={`stage action-${stageMode}`} aria-label="宠物动作舞台">
          <div className="stageLight" />
          {(!customPetActive || action !== null || feedPhase !== 'hidden') && <div className={`state is-${action ?? (feedPhase !== 'hidden' ? 'feed' : customPetActive ? 'approved' : demoPetActive ? mediaLoading ? 'loading' : mediaError ? 'error' : 'ready' : 'empty')}`}><i /> {stateLabel}</div>}

          {customPetActive && approvedAvatar
            ? <>
              <img
                className={`approvedAvatar${customAnchorHidden ? ' mediaHidden' : ''}`}
                src={approvedAvatar}
                alt={`${approvedPetName}的卡通母版`}
                fetchPriority="high"
              />
              {isPlayableBranch(customIdleBranch) && customVideoSources.idle && <video
                key={customVideoCache.sourceKeys.idle ?? 'custom-idle'}
                ref={idleVideoRef}
                className={customIdleClassName}
                src={customVideoSources.idle}
                poster={approvedAvatar}
                preload="auto"
                autoPlay
                loop
                playsInline
                muted
                onLoadedData={(event) => onCustomMediaLoaded(
                  'idle',
                  customVideoCache.revisionKey,
                  customVideoCache.sourceKeys.idle,
                  customVideoSources.idle,
                  event.currentTarget,
                )}
                onError={(event) => onCustomMediaError(
                  'idle',
                  customVideoCache.revisionKey,
                  customVideoCache.sourceKeys.idle,
                  customVideoSources.idle,
                  event.currentTarget,
                )}
                aria-label={`${approvedPetName}的个性化待机动作`}
              />}
              {isPlayableBranch(customLickBranch) && customVideoSources.lick && <video
                key={customVideoCache.sourceKeys.lick ?? 'custom-lick'}
                ref={lickVideoRef}
                className={action === 'lick' ? 'actionVideo visible' : 'actionVideo'}
                src={customVideoSources.lick}
                preload="auto"
                playsInline
                muted
                onLoadedData={(event) => onCustomMediaLoaded(
                  'lick',
                  customVideoCache.revisionKey,
                  customVideoCache.sourceKeys.lick,
                  customVideoSources.lick,
                  event.currentTarget,
                )}
                onError={(event) => onCustomMediaError(
                  'lick',
                  customVideoCache.revisionKey,
                  customVideoCache.sourceKeys.lick,
                  customVideoSources.lick,
                  event.currentTarget,
                )}
                onEnded={() => void finishVideo('lick')}
                aria-label={`${approvedPetName}的个性化舔爪动作`}
              />}
              {isPlayableBranch(customFeedBranch) && customVideoSources.feed && <video
                key={customVideoCache.sourceKeys.feed ?? 'custom-feed'}
                ref={feedVideoRef}
                className={action === 'feed' ? 'actionVideo visible' : 'actionVideo'}
                src={customVideoSources.feed}
                preload="auto"
                playsInline
                muted
                onLoadedData={(event) => onCustomMediaLoaded(
                  'feed',
                  customVideoCache.revisionKey,
                  customVideoCache.sourceKeys.feed,
                  customVideoSources.feed,
                  event.currentTarget,
                )}
                onError={(event) => onCustomMediaError(
                  'feed',
                  customVideoCache.revisionKey,
                  customVideoCache.sourceKeys.feed,
                  customVideoSources.feed,
                  event.currentTarget,
                )}
                onEnded={() => void finishVideo('feed')}
                aria-label={`${approvedPetName}的个性化猫碗喂食动作`}
              />}
              {isPlayableBranch(customPetBranch) && customVideoSources.pet && <video
                key={customVideoCache.sourceKeys.pet ?? 'custom-pet'}
                ref={petVideoRef}
                className={action === 'pet' ? 'actionVideo visible' : 'actionVideo'}
                src={customVideoSources.pet}
                preload="auto"
                playsInline
                muted
                onLoadedData={(event) => onCustomMediaLoaded(
                  'pet',
                  customVideoCache.revisionKey,
                  customVideoCache.sourceKeys.pet,
                  customVideoSources.pet,
                  event.currentTarget,
                )}
                onError={(event) => onCustomMediaError(
                  'pet',
                  customVideoCache.revisionKey,
                  customVideoCache.sourceKeys.pet,
                  customVideoSources.pet,
                  event.currentTarget,
                )}
                onEnded={() => void finishVideo('pet')}
                aria-label={`${approvedPetName}的个性化摸头动作`}
              />}
            </>
            : demoPetActive ? <>
              <img
                className={`idleFallback${hideIdle || idleFramePresented ? ' mediaHidden' : ''}`}
                src={POSTER}
                alt="灰色英国短毛猫小灰的待机预览"
                fetchPriority="high"
              />
              <video ref={idleVideoRef} className={hideIdle || !idleFramePresented ? 'idlePet mediaHidden' : 'idlePet'} src={videoSources.idle} poster={POSTER} preload="auto" autoPlay loop playsInline muted onLoadedData={() => onMediaLoaded('idle')} onError={() => onMediaError('idle')} aria-label="灰色英国短毛猫小灰眨眼待机" />
              <video ref={lickVideoRef} className={action === 'lick' ? 'actionVideo visible' : 'actionVideo'} src={videoSources.lick} preload="auto" playsInline muted onLoadedData={() => onMediaLoaded('lick')} onError={() => onMediaError('lick')} onEnded={() => void finishVideo('lick')} aria-label="小灰舔爪动作" />
              <video ref={feedVideoRef} className={action === 'feed' && !usingFeedFallback ? 'actionVideo demoFeedVideo visible' : 'actionVideo demoFeedVideo'} src={videoSources.feed} preload="auto" playsInline muted onLoadedData={() => onMediaLoaded('feed')} onError={() => onMediaError('feed')} onEnded={() => void finishVideo('feed')} aria-label="小灰低头吃猫粮动作" />
              <video ref={petVideoRef} className={action === 'pet' ? 'actionVideo visible' : 'actionVideo'} src={videoSources.pet} preload="auto" playsInline muted onLoadedData={() => onMediaLoaded('pet')} onError={() => onMediaError('pet')} onEnded={() => void finishVideo('pet')} aria-label="小灰摸头后的舒服反应" />

              <div className="petFx" aria-hidden="true"><i>♥</i><i>♥</i><i>♥</i></div>
            </> : <div className={`emptyPetStage${restoringPet ? ' isRestoring' : ''}`}>
              <span className="emptyPetMark" aria-hidden="true">{restoringPet ? '◌' : '＋'}</span>
              <h2>{restoringPet ? '正在读取你的宠物' : '这里还没有宠物'}</h2>
              <p>{restoreError
                ? `${restoreError}。保存记录还在，重试不会重新生成或计费。`
                : restoringPet
                ? '如果你以前确认过宠物，我们会恢复它；不会先闪出小灰。'
                : '先上传一张真实照片，生成卡通形象。只有你确认“像”，它才会进入这个主页。'}</p>
              {restoringPet && restoreError && <div className="emptyPetActions">
                <button className="emptyPrimary" type="button" onClick={() => {
                  setRestoreError('');
                  setRestoreAttempt((value) => value + 1);
                }}>重新读取宠物</button>
              </div>}
              {!restoringPet && <div className="emptyPetActions">
                <button className="emptyPrimary" type="button" onClick={() => setCreatorOpen(true)}>上传宠物照片</button>
                <button className="emptySecondary" type="button" onClick={showDemo}>查看小灰示例</button>
              </div>}
            </div>}

          {canUseLayeredFeedFx && <div
            className={`feedFx phase-${feedPhase}`}
            aria-hidden="true"
            onAnimationEnd={(event) => {
              if (event.target !== event.currentTarget) return;
              finishBowlAnimation(feedPhase, event.animationName);
            }}
          >
            <img src="/assets/pet-bowl-feed-3d-v2.png" alt="" draggable="false" />
          </div>}
          {hasPetHome && <div className="floor" />}
          {hasPetHome && <div className="message" aria-live="polite"><span>{messageIcon}</span><p>{notice}</p></div>}
        </section>

        {demoPetActive && <section className="vitals" aria-label="宠物状态">
            <div><span className="vitalIcon">♥</span><p><small>亲密度</small><strong>{bond}</strong></p><em style={{ '--value': `${bond}%` } as CSSProperties} /></div>
            <div><span className="vitalIcon">●</span><p><small>饱腹度</small><strong>{fullness}</strong></p><em style={{ '--value': `${fullness}%` } as CSSProperties} /></div>
            <div><span className="vitalIcon">☺</span><p><small>状态</small><strong>开心</strong></p></div>
        </section>}

        {hasPetHome && <nav className="actions" aria-label="宠物互动动作">
          <button type="button" className={`${customPetActive ? customActionClass('feed') : videoState.feed === 'fallback' ? 'prototype' : 'ready'}${action === 'feed' ? ' active' : ''}`} disabled={busy || (customPetActive ? customActionDisabled('feed') : demoActionDisabled('feed'))} onClick={() => playVideo('feed')}><span><FeedActionIcon /></span><strong>{action === 'feed' ? '喂食中' : '喂食'}</strong><small>{buttonNote('feed')}</small></button>
          <button type="button" className={`${customPetActive ? customActionClass('lick') : 'ready'}${action === 'lick' ? ' active' : ''}`} disabled={busy || (customPetActive ? customActionDisabled('lick') : demoActionDisabled('lick'))} onClick={() => playVideo('lick')}><span><LickActionIcon /></span><strong>{action === 'lick' ? '播放中' : '舔爪'}</strong><small>{buttonNote('lick')}</small></button>
          <button type="button" className={`${customPetActive ? customActionClass('pet') : 'ready'}${action === 'pet' ? ' active' : ''}`} disabled={busy || (customPetActive ? customActionDisabled('pet') : demoActionDisabled('pet'))} onClick={() => playVideo('pet')}><span><PetActionIcon /></span><strong>{action === 'pet' ? '摸摸中' : '摸头'}</strong><small>{buttonNote('pet')}</small></button>
        </nav>}

        {!customPetActive && (demoPetActive
            ? <footer className="honesty customHonesty"><i /><p><strong>这是主动打开的小灰功能示例</strong><span>它不是新用户的默认宠物，也不会冒充你上传的宠物。</span></p><button type="button" onClick={exitDemo}>退出示例</button></footer>
            : <footer className="honesty"><i /><p><strong>{restoringPet ? '正在打开宠物档案' : '新用户从空主页开始'}</strong><span>{restoringPet ? '正在读取你选中的宠物。' : '没有确认卡通形象之前，主页不会放入任何默认猫狗。'}</span></p></footer>)}
      </section>

      {creatorOpen && <div className="creatorBackdrop" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setCreatorOpen(false);
      }}>
        <section ref={creatorDialogRef} className="creatorDialog" role="dialog" aria-modal="true" aria-labelledby="creator-title" aria-describedby="creator-description">
          <button className="creatorClose" type="button" aria-label="关闭创建宠物窗口" onClick={() => setCreatorOpen(false)}>×</button>
          <header className="creatorIntro">
            <span>Qwen 真实图生图</span>
            <h2 id="creator-title">创建宠物卡通母版</h2>
            <p id="creator-description">上传一张清晰猫咪照片，生成后会把原图和卡通版并排给你看。只有你点“像，使用这张”，它才会成为后续动作的母版。</p>
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
                <button type="button" disabled title="狗狗固定风格母版还没有验收">狗狗·待开放</button>
              </div></fieldset>
            </div>

            <div className="creatorDetails">
              <label><span>年龄或生日 <small>选填</small></span><input value={petAgeOrBirthdayDraft} maxLength={24} disabled={creatorStatus === 'confirming'} onChange={(event) => setPetAgeOrBirthdayDraft(event.target.value)} placeholder="例如：3岁 / 2023-05-01" /></label>
              <fieldset><legend>性别 <small>选填</small></legend><div className="genderOptions">
                <button type="button" className={petGenderDraft === 'male' ? 'selected' : ''} aria-pressed={petGenderDraft === 'male'} disabled={creatorStatus === 'confirming'} onClick={() => setPetGenderDraft(petGenderDraft === 'male' ? '' : 'male')}>公</button>
                <button type="button" className={petGenderDraft === 'female' ? 'selected' : ''} aria-pressed={petGenderDraft === 'female'} disabled={creatorStatus === 'confirming'} onClick={() => setPetGenderDraft(petGenderDraft === 'female' ? '' : 'female')}>母</button>
              </div></fieldset>
            </div>
            <p className="creatorDetailsHint">生成期间可以补充这些资料；当前动作不按性格定制，所以暂不收集性格。</p>

            <div className="previewCompare">
              <figure><div><img src={sourcePreview} alt="上传的宠物原图" /></div><figcaption>原始照片</figcaption></figure>
              <figure><div>{avatarPreview
                ? <img src={avatarPreview} alt="Qwen 生成的宠物卡通母版" />
                : <span>{creatorWorking ? generationLabel : '等待真实生成'}<br />Qwen 2511 Int8</span>}</div><figcaption>AI 卡通母版</figcaption></figure>
            </div>

            {photoInfo && <p className="photoMeta">照片 {photoInfo.width} × {photoInfo.height} · {(photoInfo.size / 1024 / 1024).toFixed(1)}MB · {petKind === 'cat' ? '猫咪模板' : '狗狗模板'}</p>}
          </div>}

          {sourcePreview && ['submitting', 'queued', 'generating'].includes(creatorStatus) && <div className="generationProgress" role="status" aria-live="polite"><i /><p><strong>{generationLabel}</strong><small>请稍等，可以关闭弹窗，任务会继续运行</small></p></div>}

          {creatorError && <p className="creatorError" role="alert">{creatorError}</p>}

          {sourcePreview && <div className={`creatorBoundary status-${creatorStatus}`} role="status" aria-live="polite">
            {creatorStatus === 'ready_for_review' ? <><strong>请你做最关键的一步：对照原图看像不像</strong><span>重点看脸型、耳朵、眼睛颜色、毛长和花纹。不像就退回，不会自动生成四条动作。{avatarCached ? '这里复用刚才真实生成的同照片结果，没有再计费。' : ''}</span></>
              : creatorStatus === 'confirming' ? <><strong>正在保存你的选择</strong><span>这一步不会新建 GPU 任务，请不要重复点击。</span></>
                : creatorStatus === 'poll_error' ? <><strong>生成任务还在，但进度查询暂时中断</strong><span>继续查询只会追踪原任务，不会再生成一次或重复计费。</span></>
              : creatorStatus === 'rejected' ? <><strong>这张已标记为“不够像”</strong><span>这次 POC 不会继续消耗额度重复生成。可以重新选照片，或等我们优化毛长和脸型约束后再试。</span></>
                : creatorStatus === 'approved' ? <><strong>已经加入宠物档案</strong><span>现在可以回到主页和它互动了。</span></>
                  : avatarCached ? <><strong>已找到这张照片刚才的真实 Qwen 结果</strong><span>复用同一个已生成结果，没有再启动 GPU，也没有再计费。</span></>
                    : <><strong>先生成一张母版，再决定用不用</strong><span>这一步只生成静态卡通形象，不会直接烧四条动作的额度。</span></>}
          </div>}

          <div className="creatorActions">
            {sourcePreview && <button className="secondary" type="button" disabled={creatorWorking} onClick={chooseAnotherPhoto}>重新选照片</button>}
            {selectedPhoto && creatorStatus === 'error' && avatarJobId && <button className="secondary" type="button" onClick={() => { setAvatarJobId(null); setAvatarRequestKey(null); setCreatorError('原任务已失败。下一次点击才会创建新任务。'); setCreatorStatus('ready'); }}>准备一次新尝试</button>}
            {selectedPhoto && (creatorStatus === 'ready' || (creatorStatus === 'error' && !avatarJobId)) && <button className="primary" type="button" onClick={generateAvatar}>{creatorStatus === 'error' ? '继续原请求' : '生成 AI 卡通母版'}</button>}
            {selectedPhoto && ['submitting', 'queued', 'generating'].includes(creatorStatus) && <button className="primary" type="button" disabled>{generationLabel}</button>}
            {creatorStatus === 'poll_error' && <button className="primary" type="button" onClick={() => { setCreatorError(''); setCreatorStatus('generating'); }}>继续查询原任务</button>}
            {creatorStatus === 'ready_for_review' && <>
              <button className="danger" type="button" onClick={() => void reviewAvatar(false)}>不像，不使用</button>
              <button className="primary" type="button" onClick={() => void reviewAvatar(true)}>像，使用这张</button>
            </>}
            {creatorStatus === 'confirming' && <button className="primary" type="button" disabled>正在保存选择</button>}
            {creatorStatus === 'rejected' && <button className="primary" type="button" onClick={chooseAnotherPhoto}>换一张照片</button>}
            {creatorStatus === 'approved' && <button className="primary" type="button" onClick={() => setCreatorOpen(false)}>看我的宠物</button>}
          </div>
        </section>
      </div>}
    </main>
  );
}
