import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, link, mkdir, open, readFile, readdir, rename, rm, unlink } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import type {
  BatchOutputRecord,
  BatchRunBranch,
  PetActionBatchManifest,
} from '../comfy/worker-pool.ts';

export const PET_VIDEO_POLICY = {
  version: 'pet-video-v2',
  qaVersion: 'pet-video-qa-v2',
  width: 576,
  height: 768,
  fps: 30,
  frames: 152,
  anchorHoldFrames: 2,
  bridgeFrames: 10,
  handoffOutFrame: 150,
  codec: 'h264',
  codecProfile: 'Main',
  codecLevel: 31,
  maxBFrames: 0,
  keyframeInterval: 30,
  maxBitrateBitsPerSecond: 8_000_000,
  vbvBufferBits: 8_000_000,
  pixelFormat: 'yuv420p',
  minSourceFullFrameSsim: 0.9,
  minSourceRoiSsim: 0.86,
  minEndpointSsim: 0.99,
  maxPtsGapSeconds: 0.05,
  minAdjacentFrameSsim: 0.68,
  minSeamWindowAdjacentSsim: 0.86,
  maxAdjacentDropFromMedian: 0.24,
  frozenPairSsim: 0.9995,
  maxFrozenRunPairs: 18,
} as const;

export type PetVideoPolicy = typeof PET_VIDEO_POLICY;

export type MediaToolchain = {
  ffmpeg: string;
  ffprobe: string;
  ffmpegVersion: string;
  source: 'environment' | 'project-package' | 'trae-runtime';
};

export type VideoProbe = {
  codec: string;
  codecProfile: string;
  codecLevel: number;
  hasBFrames: number;
  decodedBFrames: number;
  bitRate: number;
  pixelFormat: string;
  width: number;
  height: number;
  rFrameRate: string;
  avgFrameRate: string;
  frames: number;
  durationSeconds: number;
  audioStreams: number;
  maxPtsGapSeconds: number;
  firstFrameIsKeyframe: boolean;
  maxKeyframeGapFrames: number;
};

export type PetVideoQa = {
  policyVersion: typeof PET_VIDEO_POLICY.qaVersion;
  passed: boolean;
  checkedAt: string;
  probe: VideoProbe;
  endpointSsim: {
    firstToAnchor: number;
    lastToAnchor: number;
    minimumRequired: number;
    anchorFrames: Record<'0' | '1' | '150' | '151', number>;
  };
  sourceGate: {
    enforced: boolean;
    passed: boolean;
    entryFullFrameSsim: number;
    exitFullFrameSsim: number;
    entryRoiSsim: number;
    exitRoiSsim: number;
    minimumFullFrameSsim: number;
    minimumRoiSsim: number;
  };
  sourceCadence: SpatialFrameCadenceAnalysis;
  cadence: SpatialFrameCadenceAnalysis;
  checks: Array<{
    key: string;
    passed: boolean;
    expected: string;
    actual: string;
  }>;
};

export type FinalizedPetVideo = {
  outputFile: string;
  outputSha256: string;
  bytes: number;
  rawSha256: string;
  anchorSha256: string;
  timing: {
    fps: number;
    frames: number;
    entryAnchorFrame: 0;
    handoffOutFrame: number;
  };
  qa: PetVideoQa;
};

export type PetActionArtifactManifest = {
  schemaVersion: 1;
  batchId: string;
  petId: string;
  status: 'published' | 'rejected';
  policyVersion: typeof PET_VIDEO_POLICY.version;
  qaPolicyVersion: typeof PET_VIDEO_POLICY.qaVersion;
  createdAt: string;
  master: {
    file: string;
    sha256: string;
  };
  outputContract: {
    width: number;
    height: number;
    fps: number;
    frames: number;
    codec: string;
    codecProfile: string;
    codecLevel: number;
    maxBFrames: number;
    keyframeInterval: number;
    maxBitrateBitsPerSecond: number;
    vbvBufferBits: number;
    pixelFormat: string;
    audio: false;
  };
  branches: Array<{
    action: string;
    uiKey: string;
    state: 'published' | 'qa_failed';
    raw: {
      file: string;
      sha256: string;
      bytes: number;
      nodeId: string;
      slot: string;
      index: number;
    };
    final?: {
      file: string;
      publicUrl: string;
      sha256: string;
      bytes: number;
      fps: number;
      frames: number;
      entryAnchorFrame: 0;
      handoffOutFrame: number;
    };
    qa?: PetVideoQa;
    sourceQa?: {
      sourceGate: PetVideoQa['sourceGate'];
      sourceCadence: SpatialFrameCadenceAnalysis;
    };
    error?: string;
  }>;
};

export type PetActionBranchArtifactRecord = {
  schemaVersion: 1;
  batchId: string;
  petId: string;
  masterSha256: string;
  policyVersion: typeof PET_VIDEO_POLICY.version;
  qaPolicyVersion: typeof PET_VIDEO_POLICY.qaVersion;
  branch: PetActionArtifactManifest['branches'][number];
};

export class PetVideoContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PetVideoContractError';
  }
}

export class PetVideoQaError extends Error {
  readonly qa: PetVideoQa;

  constructor(message: string, qa: PetVideoQa) {
    super(message);
    this.name = 'PetVideoQaError';
    this.qa = qa;
  }
}

export type FrameCadenceAnalysis = {
  passed: boolean;
  pairCount: number;
  adjacentFrameSsim: number[];
  minimum: number;
  median: number;
  entryWindowMinimum: number;
  exitWindowMinimum: number;
  extremeJumpPairs: number[];
  longestFrozenRunPairs: number;
  thresholds: {
    minimum: number;
    seamWindowMinimum: number;
    maximumDropFromMedian: number;
    frozenPairSsim: number;
    maximumFrozenRunPairs: number;
  };
  checks: Array<{
    key: 'adjacent_floor' | 'seam_windows' | 'extreme_jump_outliers' | 'middle_freeze';
    passed: boolean;
    expected: string;
    actual: string;
  }>;
};

export type SpatialFrameCadenceAnalysis = {
  passed: boolean;
  fullFrame: FrameCadenceAnalysis;
  subjectRoi: FrameCadenceAnalysis;
};

export class PetVideoSourceQaError extends PetVideoContractError {
  readonly sourceGate: PetVideoQa['sourceGate'];
  readonly sourceCadence: SpatialFrameCadenceAnalysis;

  constructor(
    message: string,
    sourceGate: PetVideoQa['sourceGate'],
    sourceCadence: SpatialFrameCadenceAnalysis,
  ) {
    super(message);
    this.name = 'PetVideoSourceQaError';
    this.sourceGate = sourceGate;
    this.sourceCadence = sourceCadence;
  }
}

function percentile(values: readonly number[], fraction: number) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)));
  return sorted[index];
}

/**
 * Pure cadence gate used by production QA and adversarial unit tests. Pair N is
 * the SSIM between zero-based frames N and N+1. A single-frame flash therefore
 * creates two adjacent outliers, while a frozen section creates a run near 1.
 */
export function analyzeAdjacentFrameSsim(values: readonly number[]): FrameCadenceAnalysis {
  const expectedPairs = PET_VIDEO_POLICY.frames - 1;
  if (values.length !== expectedPairs || values.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new PetVideoContractError(
      `Cadence analysis requires exactly ${expectedPairs} finite SSIM values in the range 0–1.`,
    );
  }
  const adjacentFrameSsim = [...values];
  const minimum = Math.min(...adjacentFrameSsim);
  const median = percentile(adjacentFrameSsim, 0.5);
  const entryWindow = adjacentFrameSsim.slice(0, PET_VIDEO_POLICY.bridgeFrames);
  const exitWindow = adjacentFrameSsim.slice(-PET_VIDEO_POLICY.bridgeFrames);
  const entryWindowMinimum = Math.min(...entryWindow);
  const exitWindowMinimum = Math.min(...exitWindow);
  const extremeJumpPairs = adjacentFrameSsim.flatMap((value, index) => (
    median - value > PET_VIDEO_POLICY.maxAdjacentDropFromMedian ? [index] : []
  ));

  const middleStart = PET_VIDEO_POLICY.bridgeFrames;
  const middleEnd = adjacentFrameSsim.length - PET_VIDEO_POLICY.bridgeFrames;
  let frozenRun = 0;
  let longestFrozenRunPairs = 0;
  for (let index = middleStart; index < middleEnd; index += 1) {
    if (adjacentFrameSsim[index] >= PET_VIDEO_POLICY.frozenPairSsim) {
      frozenRun += 1;
      longestFrozenRunPairs = Math.max(longestFrozenRunPairs, frozenRun);
    } else {
      frozenRun = 0;
    }
  }

  const checks: FrameCadenceAnalysis['checks'] = [
    {
      key: 'adjacent_floor',
      passed: minimum >= PET_VIDEO_POLICY.minAdjacentFrameSsim,
      expected: `all pairs>=${PET_VIDEO_POLICY.minAdjacentFrameSsim}`,
      actual: `minimum=${minimum.toFixed(6)}`,
    },
    {
      key: 'seam_windows',
      passed: entryWindowMinimum >= PET_VIDEO_POLICY.minSeamWindowAdjacentSsim
        && exitWindowMinimum >= PET_VIDEO_POLICY.minSeamWindowAdjacentSsim,
      expected: `first/last ${PET_VIDEO_POLICY.bridgeFrames} pairs>=${PET_VIDEO_POLICY.minSeamWindowAdjacentSsim}`,
      actual: `entry=${entryWindowMinimum.toFixed(6)}, exit=${exitWindowMinimum.toFixed(6)}`,
    },
    {
      key: 'extreme_jump_outliers',
      passed: extremeJumpPairs.length === 0,
      expected: `no pair more than ${PET_VIDEO_POLICY.maxAdjacentDropFromMedian} below median`,
      actual: extremeJumpPairs.length === 0
        ? `median=${median.toFixed(6)}, none`
        : `median=${median.toFixed(6)}, pairs=${extremeJumpPairs.join(',')}`,
    },
    {
      key: 'middle_freeze',
      passed: longestFrozenRunPairs <= PET_VIDEO_POLICY.maxFrozenRunPairs,
      expected: `<=${PET_VIDEO_POLICY.maxFrozenRunPairs} consecutive middle pairs at SSIM>=${PET_VIDEO_POLICY.frozenPairSsim}`,
      actual: `${longestFrozenRunPairs} pairs`,
    },
  ];
  return {
    passed: checks.every((check) => check.passed),
    pairCount: adjacentFrameSsim.length,
    adjacentFrameSsim,
    minimum,
    median,
    entryWindowMinimum,
    exitWindowMinimum,
    extremeJumpPairs,
    longestFrozenRunPairs,
    thresholds: {
      minimum: PET_VIDEO_POLICY.minAdjacentFrameSsim,
      seamWindowMinimum: PET_VIDEO_POLICY.minSeamWindowAdjacentSsim,
      maximumDropFromMedian: PET_VIDEO_POLICY.maxAdjacentDropFromMedian,
      frozenPairSsim: PET_VIDEO_POLICY.frozenPairSsim,
      maximumFrozenRunPairs: PET_VIDEO_POLICY.maxFrozenRunPairs,
    },
    checks,
  };
}

type CommandResult = {
  stdout: string;
  stderr: string;
};

const MAX_COMMAND_OUTPUT = 8 * 1024 * 1024;

function safeText(value: unknown) {
  return value instanceof Error ? value.message : String(value);
}

async function runBinary(
  file: string,
  args: string[],
  options: { timeoutMs?: number; allowFailure?: boolean } = {},
): Promise<CommandResult & { exitCode: number | null }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      child.kill('SIGKILL');
    }, options.timeoutMs ?? 120_000);

    const append = (target: 'stdout' | 'stderr', bytes: Buffer) => {
      outputBytes += bytes.byteLength;
      if (outputBytes > MAX_COMMAND_OUTPUT) {
        child.kill('SIGKILL');
        return;
      }
      if (target === 'stdout') stdout += bytes.toString('utf8');
      else stderr += bytes.toString('utf8');
    };
    child.stdout.on('data', (bytes: Buffer) => append('stdout', bytes));
    child.stderr.on('data', (bytes: Buffer) => append('stderr', bytes));
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      rejectPromise(error);
    });
    child.on('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (outputBytes > MAX_COMMAND_OUTPUT) {
        rejectPromise(new PetVideoContractError(`${basename(file)} exceeded the diagnostic output limit.`));
        return;
      }
      if (exitCode !== 0 && !options.allowFailure) {
        const detail = stderr.trim().split('\n').slice(-12).join('\n');
        rejectPromise(new PetVideoContractError(
          `${basename(file)} failed (${signal ?? exitCode}).${detail ? `\n${detail}` : ''}`,
        ));
        return;
      }
      resolvePromise({ stdout, stderr, exitCode });
    });
  });
}

async function executable(path: string) {
  try {
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function candidateToolchains(projectRoot: string) {
  const result: Array<Omit<MediaToolchain, 'ffmpegVersion'>> = [];
  const configuredFfmpeg = process.env.PET_FFMPEG_BIN?.trim();
  const configuredFfprobe = process.env.PET_FFPROBE_BIN?.trim();
  if (configuredFfmpeg || configuredFfprobe) {
    if (!configuredFfmpeg || !configuredFfprobe) {
      throw new PetVideoContractError('PET_FFMPEG_BIN and PET_FFPROBE_BIN must be configured together.');
    }
    result.push({ ffmpeg: configuredFfmpeg, ffprobe: configuredFfprobe, source: 'environment' });
  }

  const platformPackage = process.platform === 'darwin' && process.arch === 'arm64'
    ? 'darwin-arm64'
    : `${process.platform}-${process.arch}`;
  result.push({
    ffmpeg: join(projectRoot, 'node_modules', '@ffmpeg-installer', platformPackage, 'ffmpeg'),
    ffprobe: join(projectRoot, 'node_modules', '@ffprobe-installer', platformPackage, 'ffprobe'),
    source: 'project-package',
  });

  if (process.platform === 'darwin' && process.arch === 'arm64') {
    const traeBin = join(
      homedir(),
      'Library',
      'Application Support',
      'TRAE SOLO CN',
      'ModularData',
      'ai-agent',
      'vm',
      'tools',
      'opt',
      'ffmpeg',
      '8.1.2',
      'bin',
    );
    result.push({
      ffmpeg: join(traeBin, 'ffmpeg'),
      ffprobe: join(traeBin, 'ffprobe'),
      source: 'trae-runtime',
    });
  }
  return result;
}

async function smokeTestMediaToolchain(candidate: Omit<MediaToolchain, 'ffmpegVersion'>) {
  const directory = join(tmpdir(), `pet-video-toolchain-smoke-${randomUUID()}`);
  const output = join(directory, 'smoke.mp4');
  await mkdir(directory, { recursive: false });
  try {
    // Listing a compiled-in filter or encoder is not enough: trimmed vendor
    // builds have advertised features that fail when the real graph runs. This
    // tiny artifact exercises every operation relied on by the finalizer.
    const graph = '[0:v]format=yuv420p,tpad=stop_mode=clone:stop_duration=0.2,'
      + 'minterpolate=fps=30:mi_mode=mci:mc_mode=aobmc[a];'
      + '[1:v]format=yuv420p,fps=30,tpad=stop_mode=clone:stop_duration=0.2,split=2[b1][b2];'
      + "[a][b1]blend=all_expr='A*0.75+B*0.25'[mixed];"
      + '[mixed][b2]ssim=shortest=1[out]';
    const encoded = await runBinary(candidate.ffmpeg, [
      '-hide_banner', '-loglevel', 'info', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=15:duration=2.1',
      '-f', 'lavfi', '-i', 'color=c=white:size=64x64:rate=30:duration=2.3',
      '-filter_complex', graph,
      '-map', '[out]', '-frames:v', '62', '-an',
      '-c:v', 'libx264',
      '-profile:v', PET_VIDEO_POLICY.codecProfile.toLowerCase(),
      '-level:v', String(PET_VIDEO_POLICY.codecLevel / 10),
      '-bf', String(PET_VIDEO_POLICY.maxBFrames),
      '-refs', '2',
      '-g', String(PET_VIDEO_POLICY.keyframeInterval),
      '-keyint_min', String(PET_VIDEO_POLICY.keyframeInterval),
      '-sc_threshold', '0',
      '-maxrate', String(PET_VIDEO_POLICY.maxBitrateBitsPerSecond),
      '-bufsize', String(PET_VIDEO_POLICY.vbvBufferBits),
      '-x264-params', 'nal-hrd=vbr',
      '-pix_fmt', PET_VIDEO_POLICY.pixelFormat,
      '-r', String(PET_VIDEO_POLICY.fps), '-fps_mode', 'cfr',
      '-movflags', '+faststart', output,
    ], { timeoutMs: 20_000 });
    if (!/SSIM[^\n]*All:/i.test(`${encoded.stdout}\n${encoded.stderr}`)) {
      throw new Error('the ssim filter did not execute');
    }
    const probed = await runBinary(candidate.ffprobe, [
      '-v', 'error', '-count_frames', '-show_frames', '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,profile,level,has_b_frames,bit_rate,pix_fmt,r_frame_rate,avg_frame_rate,nb_read_frames:'
        + 'frame=key_frame,pict_type:format=format_name',
      '-of', 'json', output,
    ], { timeoutMs: 10_000 });
    const parsed = JSON.parse(probed.stdout) as {
      streams?: Array<Record<string, string>>;
      frames?: Array<Record<string, string | number>>;
      format?: Record<string, string>;
    };
    const stream = parsed.streams?.[0];
    const formats = String(parsed.format?.format_name ?? '').split(',');
    if (!stream
      || stream.codec_name !== 'h264'
      || stream.profile !== PET_VIDEO_POLICY.codecProfile
      || Number(stream.level) !== PET_VIDEO_POLICY.codecLevel
      || Number(stream.has_b_frames) !== PET_VIDEO_POLICY.maxBFrames
      || !Number.isFinite(Number(stream.bit_rate))
      || Number(stream.bit_rate) <= 0
      || Number(stream.bit_rate) > PET_VIDEO_POLICY.maxBitrateBitsPerSecond
      || stream.pix_fmt !== 'yuv420p'
      || Math.abs(parseRate(stream.r_frame_rate ?? '') - 30) > 0.001
      || Math.abs(parseRate(stream.avg_frame_rate ?? '') - 30) > 0.001
      || Number(stream.nb_read_frames) !== 62
      || !formats.includes('mp4')) {
      throw new Error(`encode/probe contract failed: ${probed.stdout.trim()}`);
    }
    const frames = parsed.frames ?? [];
    const keyframes = frames.flatMap((frame, index) => Number(frame.key_frame) === 1 ? [index] : []);
    const boundaries = [...keyframes, frames.length - 1];
    const maximumGap = boundaries.slice(1).reduce(
      (maximum, position, index) => Math.max(maximum, position - boundaries[index]),
      0,
    );
    if (frames.some((frame) => frame.pict_type === 'B')
      || keyframes[0] !== 0
      || maximumGap > PET_VIDEO_POLICY.keyframeInterval) {
      throw new Error(`frame structure contract failed: ${probed.stdout.trim()}`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function resolveMediaToolchain(projectRoot: string): Promise<MediaToolchain> {
  const failures: string[] = [];
  for (const candidate of candidateToolchains(projectRoot)) {
    if (!(await executable(candidate.ffmpeg)) || !(await executable(candidate.ffprobe))) continue;
    try {
      const [version, filters, probeVersion] = await Promise.all([
        runBinary(candidate.ffmpeg, ['-hide_banner', '-version'], { timeoutMs: 10_000 }),
        runBinary(candidate.ffmpeg, ['-hide_banner', '-filters'], { timeoutMs: 10_000 }),
        runBinary(candidate.ffprobe, ['-hide_banner', '-version'], { timeoutMs: 10_000 }),
      ]);
      const requiredFilters = ['blend', 'minterpolate', 'ssim', 'tpad'];
      const missing = requiredFilters.filter((name) => !new RegExp(`\\b${name}\\b`).test(filters.stdout));
      if (missing.length > 0) throw new Error(`missing filters: ${missing.join(', ')}`);
      if (!probeVersion.stdout.includes('ffprobe version')) throw new Error('ffprobe version check failed');
      await smokeTestMediaToolchain(candidate);
      return {
        ...candidate,
        ffmpegVersion: version.stdout.split('\n')[0]?.trim() || 'unknown',
      };
    } catch (error) {
      failures.push(`${candidate.source}: ${safeText(error)}`);
    }
  }
  throw new PetVideoContractError(
    'A smoke-tested ffmpeg/ffprobe toolchain with libx264, blend, minterpolate, tpad, ssim, fps_mode and MP4 is required before generation starts.'
      + (failures.length ? `\n${failures.join('\n')}` : ''),
  );
}

async function fileSha256(path: string) {
  const bytes = await readFile(path);
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.byteLength,
  };
}

async function fsyncFile(path: string) {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function parseRate(rate: string) {
  const [numerator, denominator] = rate.split('/').map(Number);
  return denominator ? numerator / denominator : Number(rate);
}

export async function probeVideo(toolchain: MediaToolchain, file: string): Promise<VideoProbe> {
  const details = await runBinary(toolchain.ffprobe, [
    '-v', 'error',
    '-count_frames',
    '-show_streams',
    '-show_format',
    '-of', 'json',
    file,
  ]);
  const parsed = JSON.parse(details.stdout) as {
    streams?: Array<Record<string, string | number>>;
    format?: Record<string, string | number>;
  };
  const video = parsed.streams?.find((stream) => stream.codec_type === 'video');
  if (!video) throw new PetVideoContractError(`${file} has no video stream.`);

  const timestamps = await runBinary(toolchain.ffprobe, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'frame=best_effort_timestamp_time,key_frame,pict_type',
    '-of', 'json',
    file,
  ]);
  const timestampJson = JSON.parse(timestamps.stdout) as {
    frames?: Array<{ best_effort_timestamp_time?: string; key_frame?: number; pict_type?: string }>;
  };
  const decodedFrames = timestampJson.frames ?? [];
  const pts = decodedFrames
    .map((frame) => Number(frame.best_effort_timestamp_time))
    .filter(Number.isFinite);
  let maxPtsGapSeconds = 0;
  for (let index = 1; index < pts.length; index += 1) {
    maxPtsGapSeconds = Math.max(maxPtsGapSeconds, pts[index] - pts[index - 1]);
  }
  const keyframePositions = decodedFrames.flatMap((frame, index) => (
    Number(frame.key_frame) === 1 ? [index] : []
  ));
  const keyframeBoundaries = keyframePositions.length > 0
    ? [...keyframePositions, Math.max(decodedFrames.length - 1, 0)]
    : [0, Math.max(decodedFrames.length - 1, 0)];
  let maxKeyframeGapFrames = 0;
  for (let index = 1; index < keyframeBoundaries.length; index += 1) {
    maxKeyframeGapFrames = Math.max(
      maxKeyframeGapFrames,
      keyframeBoundaries[index] - keyframeBoundaries[index - 1],
    );
  }

  return {
    codec: String(video.codec_name ?? ''),
    codecProfile: String(video.profile ?? ''),
    codecLevel: Number(video.level ?? 0),
    hasBFrames: Number(video.has_b_frames),
    decodedBFrames: decodedFrames.filter((frame) => frame.pict_type === 'B').length,
    bitRate: Number(video.bit_rate),
    pixelFormat: String(video.pix_fmt ?? ''),
    width: Number(video.width ?? 0),
    height: Number(video.height ?? 0),
    rFrameRate: String(video.r_frame_rate ?? ''),
    avgFrameRate: String(video.avg_frame_rate ?? ''),
    frames: Number(video.nb_read_frames ?? video.nb_frames ?? pts.length),
    durationSeconds: Number(video.duration ?? parsed.format?.duration ?? 0),
    audioStreams: parsed.streams?.filter((stream) => stream.codec_type === 'audio').length ?? 0,
    maxPtsGapSeconds,
    firstFrameIsKeyframe: keyframePositions[0] === 0,
    maxKeyframeGapFrames,
  };
}

function normalizedAnchorFilter(label: string) {
  return `scale=${PET_VIDEO_POLICY.width}:${PET_VIDEO_POLICY.height}:force_original_aspect_ratio=decrease,`
    + `pad=${PET_VIDEO_POLICY.width}:${PET_VIDEO_POLICY.height}:(ow-iw)/2:(oh-ih)/2:color=white,`
    + `setsar=1,fps=${PET_VIDEO_POLICY.fps},trim=end_frame=${PET_VIDEO_POLICY.frames},`
    + `setpts=N/(${PET_VIDEO_POLICY.fps}*TB)[${label}]`;
}

function normalizeRawFilter() {
  return `scale=${PET_VIDEO_POLICY.width}:${PET_VIDEO_POLICY.height}:force_original_aspect_ratio=decrease,`
    + `pad=${PET_VIDEO_POLICY.width}:${PET_VIDEO_POLICY.height}:(ow-iw)/2:(oh-ih)/2:color=white,`
    + `setsar=1,minterpolate=fps=${PET_VIDEO_POLICY.fps}:mi_mode=mci:mc_mode=aobmc:`
    + 'me_mode=bilat:mb_size=8:vsbmc=1,tpad=stop_mode=clone:stop_duration=1,'
    + `trim=end_frame=${PET_VIDEO_POLICY.frames},setpts=N/(${PET_VIDEO_POLICY.fps}*TB),`
    + `format=${PET_VIDEO_POLICY.pixelFormat}`;
}

export function rawWeightAtFrame(frame: number) {
  if (!Number.isInteger(frame) || frame < 0 || frame >= PET_VIDEO_POLICY.frames) {
    throw new PetVideoContractError(`Frame must be an integer from 0 to ${PET_VIDEO_POLICY.frames - 1}.`);
  }
  if (frame < PET_VIDEO_POLICY.anchorHoldFrames) return 0;
  if (frame < PET_VIDEO_POLICY.bridgeFrames) {
    return (frame - (PET_VIDEO_POLICY.anchorHoldFrames - 1))
      / (PET_VIDEO_POLICY.bridgeFrames - PET_VIDEO_POLICY.anchorHoldFrames);
  }
  if (frame <= PET_VIDEO_POLICY.frames - PET_VIDEO_POLICY.bridgeFrames) return 1;
  if (frame < PET_VIDEO_POLICY.handoffOutFrame) {
    return (PET_VIDEO_POLICY.handoffOutFrame - frame)
      / (PET_VIDEO_POLICY.bridgeFrames - PET_VIDEO_POLICY.anchorHoldFrames);
  }
  return 0;
}

function compileFilter() {
  // The blend filter's N starts at 1, while the public frame contract and
  // requestVideoFrameCallback handoff use zero-based frame indices.
  const hold = PET_VIDEO_POLICY.anchorHoldFrames;
  const bridgeEnd = PET_VIDEO_POLICY.bridgeFrames;
  const actionEnd = PET_VIDEO_POLICY.frames - PET_VIDEO_POLICY.bridgeFrames + 1;
  const handoff = PET_VIDEO_POLICY.handoffOutFrame + 1;
  const bridgeSpan = PET_VIDEO_POLICY.bridgeFrames - PET_VIDEO_POLICY.anchorHoldFrames;
  const expression = [
    `if(lte(N,${hold}),B`,
    `if(lte(N,${bridgeEnd}),A*((N-${hold})/${bridgeSpan})+B*(1-(N-${hold})/${bridgeSpan})`,
    `if(lte(N,${actionEnd}),A`,
    `if(lt(N,${handoff}),A*((${handoff}-N)/${bridgeSpan})+B*(1-(${handoff}-N)/${bridgeSpan}),B))))`,
  ].join(',');
  return `[0:v]trim=end_frame=${PET_VIDEO_POLICY.frames},`
    + `setpts=N/(${PET_VIDEO_POLICY.fps}*TB)[action];`
    + `[1:v]${normalizedAnchorFilter('anchor')};`
    + `[action][anchor]blend=all_expr='${expression}',format=${PET_VIDEO_POLICY.pixelFormat}[out]`;
}

async function endpointSsim(
  toolchain: MediaToolchain,
  videoFile: string,
  anchorFile: string,
  frame: number,
) {
  const filter = `[0:v]select='eq(n,${frame})',setpts=PTS-STARTPTS[video];`
    + `[1:v]scale=${PET_VIDEO_POLICY.width}:${PET_VIDEO_POLICY.height}:force_original_aspect_ratio=decrease,`
    + `pad=${PET_VIDEO_POLICY.width}:${PET_VIDEO_POLICY.height}:(ow-iw)/2:(oh-ih)/2:color=white,`
    + 'setsar=1,trim=end_frame=1,setpts=PTS-STARTPTS[anchor];'
    + '[video][anchor]ssim[out]';
  const result = await runBinary(toolchain.ffmpeg, [
    '-hide_banner',
    '-i', videoFile,
    '-loop', '1',
    '-framerate', String(PET_VIDEO_POLICY.fps),
    '-i', anchorFile,
    '-filter_complex', filter,
    '-map', '[out]',
    '-frames:v', '1',
    '-f', 'null',
    '-',
  ]);
  const match = /All:([0-9.]+)/.exec(`${result.stdout}\n${result.stderr}`);
  if (!match) throw new PetVideoContractError(`Could not read endpoint SSIM for frame ${frame}.`);
  return Number(match[1]);
}

type SourceGate = PetVideoQa['sourceGate'];

async function sourceEndpointSsim(
  toolchain: MediaToolchain,
  normalizedVideoFile: string,
  anchorFile: string,
  frame: number,
  roi: boolean,
) {
  const crop = roi ? ',crop=448:640:64:64' : '';
  const filter = `[0:v]select='eq(n,${frame})',setpts=PTS-STARTPTS${crop}[video];`
    + `[1:v]scale=${PET_VIDEO_POLICY.width}:${PET_VIDEO_POLICY.height}:`
    + 'force_original_aspect_ratio=decrease,'
    + `pad=${PET_VIDEO_POLICY.width}:${PET_VIDEO_POLICY.height}:(ow-iw)/2:(oh-ih)/2:color=white,`
    + `setsar=1,trim=end_frame=1,setpts=PTS-STARTPTS${crop}[anchor];`
    + '[video][anchor]ssim[out]';
  const result = await runBinary(toolchain.ffmpeg, [
    '-hide_banner',
    '-i', normalizedVideoFile,
    '-loop', '1',
    '-framerate', String(PET_VIDEO_POLICY.fps),
    '-i', anchorFile,
    '-filter_complex', filter,
    '-map', '[out]',
    '-frames:v', '1',
    '-f', 'null',
    '-',
  ]);
  const matches = [...`${result.stdout}\n${result.stderr}`.matchAll(/All:([0-9.]+)/g)];
  const value = matches.at(-1)?.[1];
  if (!value) throw new PetVideoContractError(`Could not read source SSIM for frame ${frame}.`);
  return Number(value);
}

async function inspectSourceGate(
  toolchain: MediaToolchain,
  videoFile: string,
  anchorFile: string,
  enforced: boolean,
): Promise<SourceGate> {
  const [entryFullFrameSsim, exitFullFrameSsim, entryRoiSsim, exitRoiSsim] = await Promise.all([
    sourceEndpointSsim(toolchain, videoFile, anchorFile, 0, false),
    sourceEndpointSsim(toolchain, videoFile, anchorFile, PET_VIDEO_POLICY.frames - 1, false),
    sourceEndpointSsim(toolchain, videoFile, anchorFile, 0, true),
    sourceEndpointSsim(toolchain, videoFile, anchorFile, PET_VIDEO_POLICY.frames - 1, true),
  ]);
  const passed = entryFullFrameSsim >= PET_VIDEO_POLICY.minSourceFullFrameSsim
    && exitFullFrameSsim >= PET_VIDEO_POLICY.minSourceFullFrameSsim
    && entryRoiSsim >= PET_VIDEO_POLICY.minSourceRoiSsim
    && exitRoiSsim >= PET_VIDEO_POLICY.minSourceRoiSsim;
  return {
    enforced,
    passed,
    entryFullFrameSsim,
    exitFullFrameSsim,
    entryRoiSsim,
    exitRoiSsim,
    minimumFullFrameSsim: PET_VIDEO_POLICY.minSourceFullFrameSsim,
    minimumRoiSsim: PET_VIDEO_POLICY.minSourceRoiSsim,
  };
}

async function inspectFrameCadence(toolchain: MediaToolchain, videoFile: string) {
  const directory = join(tmpdir(), `pet-video-cadence-${randomUUID()}`);
  const fullFrameStatsFile = join(directory, 'adjacent-full-frame-ssim.log');
  const subjectRoiStatsFile = join(directory, 'adjacent-subject-roi-ssim.log');
  await mkdir(directory, { recursive: false });
  try {
    // Require both views. The subject crop stops the static background from
    // hiding a pet jump; the full frame catches a tail, bowl, or flash that
    // occurs in the 64px border outside that crop.
    const filter = `[0:v]split=2[fullSource][roiSource];`
      + `[fullSource]split=2[fullPreviousSource][fullNextSource];`
      + `[fullPreviousSource]trim=end_frame=${PET_VIDEO_POLICY.frames - 1},`
      + `setpts=N/(${PET_VIDEO_POLICY.fps}*TB)[fullPrevious];`
      + `[fullNextSource]trim=start_frame=1:end_frame=${PET_VIDEO_POLICY.frames},`
      + `setpts=N/(${PET_VIDEO_POLICY.fps}*TB)[fullNext];`
      + `[roiSource]crop=448:640:64:64,split=2[roiPreviousSource][roiNextSource];`
      + `[roiPreviousSource]trim=end_frame=${PET_VIDEO_POLICY.frames - 1},`
      + `setpts=N/(${PET_VIDEO_POLICY.fps}*TB)[roiPrevious];`
      + `[roiNextSource]trim=start_frame=1:end_frame=${PET_VIDEO_POLICY.frames},`
      + `setpts=N/(${PET_VIDEO_POLICY.fps}*TB)[roiNext];`
      + `[fullPrevious][fullNext]ssim=stats_file='${fullFrameStatsFile}'[fullOut];`
      + `[roiPrevious][roiNext]ssim=stats_file='${subjectRoiStatsFile}'[roiOut]`;
    await runBinary(toolchain.ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-i', videoFile,
      '-filter_complex', filter, '-map', '[fullOut]', '-map', '[roiOut]', '-f', 'null', '-',
    ]);
    const [fullFrameStats, subjectRoiStats] = await Promise.all([
      readFile(fullFrameStatsFile, 'utf8'),
      readFile(subjectRoiStatsFile, 'utf8'),
    ]);
    const values = (stats: string) => [...stats.matchAll(/\bAll:([0-9.]+)/g)]
      .map((match) => Number(match[1]));
    const fullFrame = analyzeAdjacentFrameSsim(values(fullFrameStats));
    const subjectRoi = analyzeAdjacentFrameSsim(values(subjectRoiStats));
    return {
      passed: fullFrame.passed && subjectRoi.passed,
      fullFrame,
      subjectRoi,
    } satisfies SpatialFrameCadenceAnalysis;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function qaCheck(key: string, passed: boolean, expected: string, actual: string) {
  return { key, passed, expected, actual };
}

export async function qaPetVideo(
  toolchain: MediaToolchain,
  videoFile: string,
  anchorFile: string,
  sourceGate: SourceGate,
  sourceCadence: SpatialFrameCadenceAnalysis,
): Promise<PetVideoQa> {
  await runBinary(toolchain.ffmpeg, [
    '-hide_banner', '-v', 'error', '-xerror', '-i', videoFile, '-map', '0:v:0', '-f', 'null', '-',
  ]);
  const [probe, frame0, frame1, frame150, frame151, cadence] = await Promise.all([
    probeVideo(toolchain, videoFile),
    endpointSsim(toolchain, videoFile, anchorFile, 0),
    endpointSsim(toolchain, videoFile, anchorFile, 1),
    endpointSsim(toolchain, videoFile, anchorFile, PET_VIDEO_POLICY.handoffOutFrame),
    endpointSsim(toolchain, videoFile, anchorFile, PET_VIDEO_POLICY.frames - 1),
    inspectFrameCadence(toolchain, videoFile),
  ]);
  const firstToAnchor = Math.min(frame0, frame1);
  const lastToAnchor = Math.min(frame150, frame151);
  const checks = [
    qaCheck(
      'source_seam',
      sourceGate.passed || !sourceGate.enforced,
      sourceGate.enforced
        ? `full>=${PET_VIDEO_POLICY.minSourceFullFrameSsim}, ROI>=${PET_VIDEO_POLICY.minSourceRoiSsim}`
        : 'POC salvage explicitly allowed',
      `full=${Math.min(sourceGate.entryFullFrameSsim, sourceGate.exitFullFrameSsim).toFixed(6)}, `
        + `ROI=${Math.min(sourceGate.entryRoiSsim, sourceGate.exitRoiSsim).toFixed(6)}`,
    ),
    ...([
      ['full_frame', sourceCadence.fullFrame],
      ['subject_roi', sourceCadence.subjectRoi],
    ] as const).flatMap(([region, analysis]) => analysis.checks.map((check) => qaCheck(
      `source_cadence_${region}_${check.key}`,
      check.passed,
      check.expected,
      check.actual,
    ))),
    qaCheck('codec', probe.codec === PET_VIDEO_POLICY.codec, PET_VIDEO_POLICY.codec, probe.codec),
    qaCheck(
      'codec_profile',
      probe.codecProfile === PET_VIDEO_POLICY.codecProfile,
      PET_VIDEO_POLICY.codecProfile,
      probe.codecProfile,
    ),
    qaCheck(
      'codec_level',
      probe.codecLevel === PET_VIDEO_POLICY.codecLevel,
      String(PET_VIDEO_POLICY.codecLevel),
      String(probe.codecLevel),
    ),
    qaCheck(
      'b_frames',
      probe.hasBFrames === PET_VIDEO_POLICY.maxBFrames && probe.decodedBFrames === 0,
      `stream=${PET_VIDEO_POLICY.maxBFrames}, decoded=0`,
      `stream=${String(probe.hasBFrames)}, decoded=${probe.decodedBFrames}`,
    ),
    qaCheck(
      'bitrate_vbv',
      Number.isFinite(probe.bitRate)
        && probe.bitRate > 0
        && probe.bitRate <= PET_VIDEO_POLICY.maxBitrateBitsPerSecond,
      `0<average bitrate<=${PET_VIDEO_POLICY.maxBitrateBitsPerSecond}; encoder VBV buffer=${PET_VIDEO_POLICY.vbvBufferBits}`,
      String(probe.bitRate),
    ),
    qaCheck(
      'keyframe_interval',
      probe.firstFrameIsKeyframe
        && probe.maxKeyframeGapFrames <= PET_VIDEO_POLICY.keyframeInterval,
      `first frame keyframe and maximum gap<=${PET_VIDEO_POLICY.keyframeInterval} frames`,
      `first=${probe.firstFrameIsKeyframe}, maximum gap=${probe.maxKeyframeGapFrames}`,
    ),
    qaCheck(
      'dimensions',
      probe.width === PET_VIDEO_POLICY.width && probe.height === PET_VIDEO_POLICY.height,
      `${PET_VIDEO_POLICY.width}x${PET_VIDEO_POLICY.height}`,
      `${probe.width}x${probe.height}`,
    ),
    qaCheck(
      'frame_rate',
      Math.abs(parseRate(probe.rFrameRate) - PET_VIDEO_POLICY.fps) < 0.001
        && Math.abs(parseRate(probe.avgFrameRate) - PET_VIDEO_POLICY.fps) < 0.001,
      `${PET_VIDEO_POLICY.fps}fps CFR`,
      `${probe.rFrameRate} / ${probe.avgFrameRate}`,
    ),
    qaCheck('frame_count', probe.frames === PET_VIDEO_POLICY.frames, String(PET_VIDEO_POLICY.frames), String(probe.frames)),
    qaCheck(
      'duration',
      Math.abs(probe.durationSeconds - (PET_VIDEO_POLICY.frames / PET_VIDEO_POLICY.fps)) <= 0.02,
      `${(PET_VIDEO_POLICY.frames / PET_VIDEO_POLICY.fps).toFixed(6)}s ±0.02s`,
      `${probe.durationSeconds.toFixed(6)}s`,
    ),
    qaCheck(
      'pixel_format',
      probe.pixelFormat === PET_VIDEO_POLICY.pixelFormat,
      PET_VIDEO_POLICY.pixelFormat,
      probe.pixelFormat,
    ),
    qaCheck('audio', probe.audioStreams === 0, '0 streams', `${probe.audioStreams} streams`),
    qaCheck(
      'pts_gap',
      probe.maxPtsGapSeconds <= PET_VIDEO_POLICY.maxPtsGapSeconds,
      `<=${PET_VIDEO_POLICY.maxPtsGapSeconds}s`,
      `${probe.maxPtsGapSeconds.toFixed(6)}s`,
    ),
    qaCheck(
      'first_anchor_ssim',
      firstToAnchor >= PET_VIDEO_POLICY.minEndpointSsim,
      `>=${PET_VIDEO_POLICY.minEndpointSsim}`,
      firstToAnchor.toFixed(6),
    ),
    qaCheck(
      'last_anchor_ssim',
      lastToAnchor >= PET_VIDEO_POLICY.minEndpointSsim,
      `>=${PET_VIDEO_POLICY.minEndpointSsim}`,
      lastToAnchor.toFixed(6),
    ),
    ...([
      ['full_frame', cadence.fullFrame],
      ['subject_roi', cadence.subjectRoi],
    ] as const).flatMap(([region, analysis]) => analysis.checks.map((check) => qaCheck(
      `cadence_${region}_${check.key}`,
      check.passed,
      check.expected,
      check.actual,
    ))),
  ];
  return {
    policyVersion: PET_VIDEO_POLICY.qaVersion,
    passed: checks.every((check) => check.passed),
    checkedAt: new Date().toISOString(),
    probe,
    endpointSsim: {
      firstToAnchor,
      lastToAnchor,
      minimumRequired: PET_VIDEO_POLICY.minEndpointSsim,
      anchorFrames: {
        '0': frame0,
        '1': frame1,
        '150': frame150,
        '151': frame151,
      },
    },
    sourceGate,
    sourceCadence,
    cadence,
    checks,
  };
}

export async function finalizePetVideo(options: {
  projectRoot: string;
  rawFile: string;
  anchorFile: string;
  outputFile: string;
  toolchain?: MediaToolchain;
  enforceSourceGate?: boolean;
}): Promise<FinalizedPetVideo> {
  const toolchain = options.toolchain ?? await resolveMediaToolchain(options.projectRoot);
  const enforceSourceGate = options.enforceSourceGate ?? true;
  const [raw, anchor, rawProbe] = await Promise.all([
    fileSha256(options.rawFile),
    fileSha256(options.anchorFile),
    probeVideo(toolchain, options.rawFile),
  ]);
  if (rawProbe.frames < 2 || rawProbe.width < 1 || rawProbe.height < 1) {
    throw new PetVideoContractError(`Raw video is not usable: ${options.rawFile}`);
  }
  const rawAspect = rawProbe.width / rawProbe.height;
  const expectedAspect = PET_VIDEO_POLICY.width / PET_VIDEO_POLICY.height;
  if (rawProbe.width > 4096 || rawProbe.height > 4096 || Math.abs(rawAspect - expectedAspect) > 0.03) {
    throw new PetVideoContractError(
      `Raw video must be a portrait 3:4 asset no larger than 4096px; got ${rawProbe.width}x${rawProbe.height}.`,
    );
  }
  if (rawProbe.durationSeconds < 4.8 || rawProbe.durationSeconds > 6.5) {
    throw new PetVideoContractError(
      `Raw video duration must be 4.8–6.5s for ${PET_VIDEO_POLICY.version}; got ${rawProbe.durationSeconds}s.`,
    );
  }
  await mkdir(dirname(options.outputFile), { recursive: true });
  const temporary = join(dirname(options.outputFile), `.${basename(options.outputFile)}.${randomUUID()}.tmp.mp4`);
  const normalized = join(dirname(options.outputFile), `.${basename(options.outputFile)}.${randomUUID()}.normalized.mp4`);
  try {
    // MCI is the expensive and least deterministic operation. Run it exactly
    // once, then reuse this lossless-normalized timeline for source gating and
    // final compilation instead of invoking MCI four more times.
    await runBinary(toolchain.ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', options.rawFile,
      '-vf', normalizeRawFilter(),
      '-frames:v', String(PET_VIDEO_POLICY.frames), '-an',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '0',
      '-pix_fmt', PET_VIDEO_POLICY.pixelFormat,
      '-r', String(PET_VIDEO_POLICY.fps), '-fps_mode', 'cfr',
      '-map_metadata', '-1', normalized,
    ], { timeoutMs: 10 * 60_000 });
    await fsyncFile(normalized);
    const [normalizedProbe, sourceGate, sourceCadence] = await Promise.all([
      probeVideo(toolchain, normalized),
      inspectSourceGate(toolchain, normalized, options.anchorFile, enforceSourceGate),
      inspectFrameCadence(toolchain, normalized),
    ]);
    if (normalizedProbe.frames !== PET_VIDEO_POLICY.frames
      || normalizedProbe.width !== PET_VIDEO_POLICY.width
      || normalizedProbe.height !== PET_VIDEO_POLICY.height
      || Math.abs(parseRate(normalizedProbe.avgFrameRate) - PET_VIDEO_POLICY.fps) > 0.001) {
      throw new PetVideoContractError(
        `Normalized source violated ${PET_VIDEO_POLICY.version}: ${normalizedProbe.width}x${normalizedProbe.height}, `
          + `${normalizedProbe.frames} frames, ${normalizedProbe.avgFrameRate}fps.`,
      );
    }
    if (enforceSourceGate && !sourceGate.passed) {
      throw new PetVideoSourceQaError(
        `SOURCE_SEAM_MISMATCH: ${basename(options.rawFile)} does not return close enough to the canonical master `
          + `(full entry/exit ${sourceGate.entryFullFrameSsim.toFixed(4)}/`
          + `${sourceGate.exitFullFrameSsim.toFixed(4)}, ROI entry/exit `
          + `${sourceGate.entryRoiSsim.toFixed(4)}/${sourceGate.exitRoiSsim.toFixed(4)}). `
          + 'Regenerate only this branch; do not hide it with a dissolve.',
        sourceGate,
        sourceCadence,
      );
    }
    if (!sourceCadence.passed) {
      const failures = ([
        ['full-frame', sourceCadence.fullFrame],
        ['subject-ROI', sourceCadence.subjectRoi],
      ] as const).flatMap(([region, analysis]) => analysis.checks
        .filter((check) => !check.passed)
        .map((check) => `${region}/${check.key} (${check.actual})`))
        .join(', ');
      throw new PetVideoSourceQaError(
        `SOURCE_SEAM_MISMATCH: ${basename(options.rawFile)} contains a raw cadence discontinuity: ${failures}. `
          + 'Regenerate only this branch; post-processing is not allowed to conceal a flash, jump, or frozen action.',
        sourceGate,
        sourceCadence,
      );
    }
    await runBinary(toolchain.ffmpeg, [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-i', normalized,
      '-loop', '1',
      '-framerate', String(PET_VIDEO_POLICY.fps),
      '-i', options.anchorFile,
      '-filter_complex', compileFilter(),
      '-map', '[out]',
      '-frames:v', String(PET_VIDEO_POLICY.frames),
      '-an',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '12',
      '-profile:v', PET_VIDEO_POLICY.codecProfile.toLowerCase(),
      '-level:v', String(PET_VIDEO_POLICY.codecLevel / 10),
      '-bf', String(PET_VIDEO_POLICY.maxBFrames),
      '-refs', '2',
      '-g', String(PET_VIDEO_POLICY.keyframeInterval),
      '-keyint_min', String(PET_VIDEO_POLICY.keyframeInterval),
      '-sc_threshold', '0',
      '-maxrate', String(PET_VIDEO_POLICY.maxBitrateBitsPerSecond),
      '-bufsize', String(PET_VIDEO_POLICY.vbvBufferBits),
      '-x264-params', 'nal-hrd=vbr',
      '-pix_fmt', PET_VIDEO_POLICY.pixelFormat,
      '-r', String(PET_VIDEO_POLICY.fps),
      '-fps_mode', 'cfr',
      '-color_primaries', 'bt709',
      '-color_trc', 'bt709',
      '-colorspace', 'bt709',
      '-movflags', '+faststart',
      '-map_metadata', '-1',
      temporary,
    ], { timeoutMs: 10 * 60_000 });
    await fsyncFile(temporary);
    const qa = await qaPetVideo(toolchain, temporary, options.anchorFile, sourceGate, sourceCadence);
    if (!qa.passed) throw new PetVideoQaError(`Compiled video failed ${PET_VIDEO_POLICY.qaVersion}.`, qa);
    const output = await fileSha256(temporary);
    try {
      await link(temporary, options.outputFile);
      await unlink(temporary);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existing = await fileSha256(options.outputFile);
      if (existing.sha256 !== output.sha256) {
        throw new PetVideoContractError(`Refusing to overwrite immutable artifact ${options.outputFile}.`);
      }
      await unlink(temporary);
    }
    return {
      outputFile: options.outputFile,
      outputSha256: output.sha256,
      bytes: output.bytes,
      rawSha256: raw.sha256,
      anchorSha256: anchor.sha256,
      timing: {
        fps: PET_VIDEO_POLICY.fps,
        frames: PET_VIDEO_POLICY.frames,
        entryAnchorFrame: 0,
        handoffOutFrame: PET_VIDEO_POLICY.handoffOutFrame,
      },
      qa,
    };
  } catch (error) {
    throw error;
  } finally {
    await Promise.all([temporary, normalized].map(async (file) => {
      try {
        await unlink(file);
      } catch (cleanupError) {
        if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') throw cleanupError;
      }
    }));
  }
}

function resolveInside(root: string, path: string) {
  if (isAbsolute(path)) throw new PetVideoContractError(`Absolute manifest path is forbidden: ${path}`);
  const resolvedRoot = resolve(root);
  const candidate = resolve(resolvedRoot, path);
  if (candidate !== resolvedRoot && !candidate.startsWith(`${resolvedRoot}${sep}`)) {
    throw new PetVideoContractError(`Manifest path escapes project root: ${path}`);
  }
  return candidate;
}

function resolveMasterFile(projectRoot: string, masterFile: string) {
  return masterFile.includes('/') || masterFile.includes('\\')
    ? resolveInside(projectRoot, masterFile)
    : resolveInside(projectRoot, join('public', 'assets', 'generated', masterFile));
}

function expectedRawOutput(
  branch: PetActionBatchManifest['branches'][number],
  runBranch: BatchRunBranch,
): BatchOutputRecord {
  const expected = branch.expectedOutput;
  if (!expected) throw new PetVideoContractError(`Branch ${branch.uiKey} has no expectedOutput contract.`);
  const match = runBranch.outputs.find((output) => output.nodeId === expected.nodeId
    && output.slot === expected.slot
    && output.index === expected.index);
  if (!match) {
    throw new PetVideoContractError(
      `Branch ${branch.uiKey} did not produce ${expected.nodeId}/${expected.slot}/${expected.index}.`,
    );
  }
  return match;
}

function relativeProjectPath(projectRoot: string, file: string) {
  const path = relative(projectRoot, file);
  if (path.startsWith('..')) throw new PetVideoContractError(`Artifact is outside project root: ${file}`);
  return path;
}

function publicUrlFor(projectRoot: string, file: string) {
  const publicRoot = join(resolve(projectRoot), 'public');
  const relativePath = relative(publicRoot, resolve(file));
  if (relativePath.startsWith('..')) throw new PetVideoContractError(`Published artifact is outside public/: ${file}`);
  return `/${relativePath.split(sep).join('/')}`;
}

function sanitizeArtifactPart(value: string) {
  const sanitized = value.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '');
  if (!sanitized) throw new PetVideoContractError(`Unsafe artifact identifier: ${value}`);
  return sanitized;
}

async function writeJsonAtomic(file: string, value: unknown) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, file);
}

type ImmutableArtifactExpectation = {
  filename: string;
  sha256: string;
  bytes: number;
};

/**
 * Recovery guard for the narrow crash window after the four-file directory
 * rename and before artifact-manifest.json is committed. A rerun may reuse the
 * already-public directory only when it is byte-for-byte the same immutable
 * set; anything partial, extra, or different fails closed.
 */
export async function assertImmutablePublishedDirectory(
  directory: string,
  expectations: readonly ImmutableArtifactExpectation[],
) {
  if (expectations.length !== 4 || new Set(expectations.map((item) => item.filename)).size !== 4) {
    throw new PetVideoContractError('Published recovery requires four uniquely named artifacts.');
  }
  if (expectations.some((item) => basename(item.filename) !== item.filename)) {
    throw new PetVideoContractError('Published recovery filenames must not contain a path.');
  }
  const entries = await readdir(directory, { withFileTypes: true });
  const expectedNames = [...expectations].map((item) => item.filename).sort();
  const actualNames = entries.map((entry) => entry.name).sort();
  if (entries.some((entry) => !entry.isFile())
    || actualNames.length !== expectedNames.length
    || actualNames.some((name, index) => name !== expectedNames[index])) {
    throw new PetVideoContractError(
      `Existing published artifact directory is not the expected immutable four-file set: ${directory}`,
    );
  }
  await Promise.all(expectations.map(async (expected) => {
    const actual = await fileSha256(join(directory, expected.filename));
    if (actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes) {
      throw new PetVideoContractError(
        `Existing published artifact differs for ${expected.filename}; refusing recovery reuse.`,
      );
    }
  }));
}

export function assertArtifactPublicationInvariant(
  status: PetActionArtifactManifest['status'],
  branches: PetActionArtifactManifest['branches'],
) {
  if (branches.length !== 4 || new Set(branches.map((branch) => branch.uiKey)).size !== 4) {
    throw new PetVideoContractError('An artifact manifest must contain four unique action branches.');
  }
  for (const branch of branches) {
    if (branch.state === 'published' && !branch.final?.publicUrl) {
      throw new PetVideoContractError(`Published branch ${branch.uiKey} requires an immutable public artifact.`);
    }
    if (branch.state === 'qa_failed' && branch.final) {
      throw new PetVideoContractError(`QA-failed branch ${branch.uiKey} must not expose a final artifact.`);
    }
  }
  if (status === 'published') {
    if (branches.some((branch) => branch.state !== 'published')) {
      throw new PetVideoContractError('A published artifact manifest must expose exactly four published branches.');
    }
    return;
  }
  if (branches.every((branch) => branch.state === 'published')) {
    throw new PetVideoContractError('A rejected artifact manifest must contain at least one QA-failed branch.');
  }
}

export function petActionBranchArtifactFile(runDirectory: string, uiKey: string) {
  return join(resolve(runDirectory), 'branch-artifacts', `${sanitizeArtifactPart(uiKey)}.json`);
}

function publishedPetActionDirectory(
  projectRoot: string,
  petId: string,
  batchId: string,
) {
  return join(
    resolve(projectRoot),
    'public',
    'assets',
    'generated',
    [
      sanitizeArtifactPart(petId),
      sanitizeArtifactPart(batchId),
      PET_VIDEO_POLICY.version,
    ].join('--'),
  );
}

async function recoverPublishedBranch(
  options: {
    projectRoot: string;
    batchId: string;
    manifest: PetActionBatchManifest;
    branch: PetActionBatchManifest['branches'][number];
    raw: BatchOutputRecord;
    recordFile: string;
  },
) {
  try {
    const record = JSON.parse(await readFile(options.recordFile, 'utf8')) as PetActionBranchArtifactRecord;
    if (record.schemaVersion !== 1
      || record.batchId !== options.batchId
      || record.petId !== options.manifest.petId
      || record.masterSha256 !== options.manifest.masterSha256
      || record.policyVersion !== PET_VIDEO_POLICY.version
      || record.qaPolicyVersion !== PET_VIDEO_POLICY.qaVersion
      || record.branch.uiKey !== options.branch.uiKey
      || record.branch.action !== options.branch.action
      || record.branch.raw.sha256 !== options.raw.sha256
      || record.branch.raw.bytes !== options.raw.bytes) return null;
    if (record.branch.state === 'qa_failed') return record.branch;
    if (!record.branch.final) return null;
    const finalFile = resolve(options.projectRoot, record.branch.final.file);
    const publicRoot = join(resolve(options.projectRoot), 'public');
    if (finalFile !== publicRoot && !finalFile.startsWith(`${publicRoot}${sep}`)) return null;
    const actual = await fileSha256(finalFile);
    if (actual.sha256 !== record.branch.final.sha256 || actual.bytes !== record.branch.final.bytes) return null;
    return record.branch;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function finalizePetActionBranch(options: {
  projectRoot: string;
  runDirectory: string;
  batchId: string;
  manifest: PetActionBatchManifest;
  branch: PetActionBatchManifest['branches'][number];
  runBranch: BatchRunBranch;
  toolchain?: MediaToolchain;
}): Promise<PetActionArtifactManifest['branches'][number]> {
  if (options.manifest.branches.length !== 4
    || options.runBranch.uiKey !== options.branch.uiKey
    || options.runBranch.state !== 'succeeded') {
    throw new PetVideoContractError('A succeeded generation branch from a four-action manifest is required.');
  }
  const toolchain = options.toolchain ?? await resolveMediaToolchain(options.projectRoot);
  const masterFile = resolveMasterFile(options.projectRoot, options.manifest.masterFile);
  const masterHash = await fileSha256(masterFile);
  if (!options.manifest.masterSha256 || options.manifest.masterSha256 !== masterHash.sha256) {
    throw new PetVideoContractError('Master image changed after generation; refusing to compile mixed-identity videos.');
  }
  const runDirectory = resolve(options.runDirectory);
  const publicRoot = join(resolve(options.projectRoot), 'public');
  if (runDirectory === publicRoot || runDirectory.startsWith(`${publicRoot}${sep}`)) {
    throw new PetVideoContractError('runDirectory must be outside public/.');
  }

  const raw = expectedRawOutput(options.branch, options.runBranch);
  const verifiedRaw = await fileSha256(raw.localFile);
  if (verifiedRaw.sha256 !== raw.sha256 || verifiedRaw.bytes !== raw.bytes) {
    throw new PetVideoContractError(
      `RAW_ARTIFACT_CHANGED: ${options.branch.uiKey} expected ${raw.sha256}/${raw.bytes}, `
        + `got ${verifiedRaw.sha256}/${verifiedRaw.bytes}.`,
    );
  }
  const recordFile = petActionBranchArtifactFile(runDirectory, options.branch.uiKey);
  const recovered = await recoverPublishedBranch({
    projectRoot: options.projectRoot,
    batchId: options.batchId,
    manifest: options.manifest,
    branch: options.branch,
    raw,
    recordFile,
  });
  if (recovered) return recovered;

  const rawArtifact = {
    file: relativeProjectPath(options.projectRoot, raw.localFile),
    sha256: verifiedRaw.sha256,
    bytes: verifiedRaw.bytes,
    nodeId: raw.nodeId,
    slot: raw.slot,
    index: raw.index,
  };
  let artifact: PetActionArtifactManifest['branches'][number];
  try {
    const filename = [
      sanitizeArtifactPart(options.manifest.petId),
      sanitizeArtifactPart(options.branch.uiKey),
      PET_VIDEO_POLICY.version,
      verifiedRaw.sha256.slice(0, 12),
    ].join('--') + '.mp4';
    const outputFile = join(
      publishedPetActionDirectory(options.projectRoot, options.manifest.petId, options.batchId),
      filename,
    );
    const finalized = await finalizePetVideo({
      projectRoot: options.projectRoot,
      rawFile: raw.localFile,
      anchorFile: masterFile,
      outputFile,
      toolchain,
    });
    artifact = {
      action: options.branch.action,
      uiKey: options.branch.uiKey,
      state: 'published',
      raw: rawArtifact,
      final: {
        file: relativeProjectPath(options.projectRoot, finalized.outputFile),
        publicUrl: publicUrlFor(options.projectRoot, finalized.outputFile),
        sha256: finalized.outputSha256,
        bytes: finalized.bytes,
        fps: finalized.timing.fps,
        frames: finalized.timing.frames,
        entryAnchorFrame: finalized.timing.entryAnchorFrame,
        handoffOutFrame: finalized.timing.handoffOutFrame,
      },
      qa: finalized.qa,
    };
  } catch (error) {
    if (!(error instanceof PetVideoQaError) && !(error instanceof PetVideoSourceQaError)) throw error;
    artifact = {
      action: options.branch.action,
      uiKey: options.branch.uiKey,
      state: 'qa_failed',
      raw: rawArtifact,
      ...(error instanceof PetVideoQaError ? { qa: error.qa } : {}),
      ...(error instanceof PetVideoSourceQaError ? {
        sourceQa: {
          sourceGate: error.sourceGate,
          sourceCadence: error.sourceCadence,
        },
      } : {}),
      error: safeText(error),
    };
  }
  await writeJsonAtomic(recordFile, {
    schemaVersion: 1,
    batchId: options.batchId,
    petId: options.manifest.petId,
    masterSha256: options.manifest.masterSha256,
    policyVersion: PET_VIDEO_POLICY.version,
    qaPolicyVersion: PET_VIDEO_POLICY.qaVersion,
    branch: artifact,
  } satisfies PetActionBranchArtifactRecord);
  return artifact;
}

export async function finalizePetActionBatch(options: {
  projectRoot: string;
  runDirectory: string;
  batchId: string;
  manifest: PetActionBatchManifest;
  runBranches: BatchRunBranch[];
  toolchain?: MediaToolchain;
}): Promise<{ manifestFile: string; manifest: PetActionArtifactManifest }> {
  if (options.manifest.branches.length !== 4 || options.runBranches.some((branch) => branch.state !== 'succeeded')) {
    throw new PetVideoContractError('All four generation branches must succeed before batch finalization starts.');
  }
  const toolchain = options.toolchain ?? await resolveMediaToolchain(options.projectRoot);
  const masterFile = resolveMasterFile(options.projectRoot, options.manifest.masterFile);
  const masterHash = await fileSha256(masterFile);
  if (!options.manifest.masterSha256) {
    throw new PetVideoContractError('A pinned masterSha256 is mandatory; refusing an unbound identity master.');
  }
  if (options.manifest.masterSha256 !== masterHash.sha256) {
    throw new PetVideoContractError('Master image changed after generation; refusing to compile mixed-identity videos.');
  }

  const finalizeBranch = async (branch: PetActionBatchManifest['branches'][number]) => {
    const runBranch = options.runBranches.find((item) => item.uiKey === branch.uiKey);
    if (!runBranch) throw new PetVideoContractError(`Missing run record for ${branch.uiKey}.`);
    return finalizePetActionBranch({
      projectRoot: options.projectRoot,
      runDirectory: options.runDirectory,
      batchId: options.batchId,
      manifest: options.manifest,
      branch,
      runBranch,
      toolchain,
    });
  };

  // Optical-flow compilation is CPU-heavy. Two lanes preserve the previous
  // throughput limit while allowing the first finished branch to publish.
  const branches: PetActionArtifactManifest['branches'] = [];
  for (let index = 0; index < options.manifest.branches.length; index += 2) {
    branches.push(...await Promise.all(options.manifest.branches.slice(index, index + 2).map(finalizeBranch)));
  }
  const status = branches.every((branch) => branch.state === 'published') ? 'published' : 'rejected';
    const artifactManifest: PetActionArtifactManifest = {
      schemaVersion: 1,
      batchId: options.batchId,
      petId: options.manifest.petId,
      status,
      policyVersion: PET_VIDEO_POLICY.version,
      qaPolicyVersion: PET_VIDEO_POLICY.qaVersion,
      createdAt: new Date().toISOString(),
      master: {
        file: relativeProjectPath(options.projectRoot, masterFile),
        sha256: masterHash.sha256,
      },
      outputContract: {
        width: PET_VIDEO_POLICY.width,
        height: PET_VIDEO_POLICY.height,
        fps: PET_VIDEO_POLICY.fps,
        frames: PET_VIDEO_POLICY.frames,
        codec: PET_VIDEO_POLICY.codec,
        codecProfile: PET_VIDEO_POLICY.codecProfile,
        codecLevel: PET_VIDEO_POLICY.codecLevel,
        maxBFrames: PET_VIDEO_POLICY.maxBFrames,
        keyframeInterval: PET_VIDEO_POLICY.keyframeInterval,
        maxBitrateBitsPerSecond: PET_VIDEO_POLICY.maxBitrateBitsPerSecond,
        vbvBufferBits: PET_VIDEO_POLICY.vbvBufferBits,
        pixelFormat: PET_VIDEO_POLICY.pixelFormat,
        audio: false,
      },
      branches,
    };
    assertArtifactPublicationInvariant(status, branches);
    const manifestFile = join(options.runDirectory, 'artifact-manifest.json');
    await writeJsonAtomic(manifestFile, artifactManifest);
    return { manifestFile, manifest: artifactManifest };
}
