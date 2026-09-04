import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  analyzeAdjacentFrameSsim,
  assertArtifactPublicationInvariant,
  assertImmutablePublishedDirectory,
  PET_VIDEO_POLICY,
  PetVideoContractError,
  rawWeightAtFrame,
  type PetActionArtifactManifest,
} from './pet-video-finalizer.ts';

const healthyCadence = (): number[] => Array.from(
  { length: PET_VIDEO_POLICY.frames - 1 },
  (_, index) => (index < PET_VIDEO_POLICY.bridgeFrames
    || index >= PET_VIDEO_POLICY.frames - 1 - PET_VIDEO_POLICY.bridgeFrames ? 0.97 : 0.94),
);

test('canonical anchor and handoff frame contract is fixed', () => {
  assert.equal(PET_VIDEO_POLICY.version, 'pet-video-v2');
  assert.equal(PET_VIDEO_POLICY.qaVersion, 'pet-video-qa-v2');
  assert.deepEqual({
    size: `${PET_VIDEO_POLICY.width}x${PET_VIDEO_POLICY.height}`,
    fps: PET_VIDEO_POLICY.fps,
    frames: PET_VIDEO_POLICY.frames,
    anchorHold: PET_VIDEO_POLICY.anchorHoldFrames,
    bridge: PET_VIDEO_POLICY.bridgeFrames,
    handoff: PET_VIDEO_POLICY.handoffOutFrame,
    codecProfile: PET_VIDEO_POLICY.codecProfile,
    codecLevel: PET_VIDEO_POLICY.codecLevel,
    maxBFrames: PET_VIDEO_POLICY.maxBFrames,
    keyframeInterval: PET_VIDEO_POLICY.keyframeInterval,
    maxBitrateBitsPerSecond: PET_VIDEO_POLICY.maxBitrateBitsPerSecond,
    vbvBufferBits: PET_VIDEO_POLICY.vbvBufferBits,
  }, {
    size: '576x768',
    fps: 30,
    frames: 152,
    anchorHold: 2,
    bridge: 10,
    handoff: 150,
    codecProfile: 'Main',
    codecLevel: 31,
    maxBFrames: 0,
    keyframeInterval: 30,
    maxBitrateBitsPerSecond: 8_000_000,
    vbvBufferBits: 8_000_000,
  });
});

test('cadence gate accepts gradual seams and continuously moving action frames', () => {
  const analysis = analyzeAdjacentFrameSsim(healthyCadence());
  assert.equal(analysis.passed, true);
  assert.equal(analysis.pairCount, 151);
  assert.equal(analysis.extremeJumpPairs.length, 0);
  assert.equal(analysis.longestFrozenRunPairs, 0);
});

test('cadence gate rejects a hard jump hidden inside the entry seam window', () => {
  const values = healthyCadence();
  values[6] = 0.8;
  const analysis = analyzeAdjacentFrameSsim(values);
  assert.equal(analysis.passed, false);
  assert.equal(analysis.checks.find((check) => check.key === 'seam_windows')?.passed, false);
  assert.equal(analysis.checks.find((check) => check.key === 'adjacent_floor')?.passed, true);
});

test('cadence gate rejects a one-frame flash as two extreme adjacent outliers', () => {
  const values = healthyCadence();
  values[74] = 0.52;
  values[75] = 0.51;
  const analysis = analyzeAdjacentFrameSsim(values);
  assert.equal(analysis.passed, false);
  assert.deepEqual(analysis.extremeJumpPairs, [74, 75]);
  assert.equal(analysis.checks.find((check) => check.key === 'adjacent_floor')?.passed, false);
  assert.equal(analysis.checks.find((check) => check.key === 'extreme_jump_outliers')?.passed, false);
});

test('cadence gate rejects a long frozen section in the middle of an action', () => {
  const values = healthyCadence();
  values.fill(0.9998, 60, 60 + PET_VIDEO_POLICY.maxFrozenRunPairs + 1);
  const analysis = analyzeAdjacentFrameSsim(values);
  assert.equal(analysis.passed, false);
  assert.equal(analysis.longestFrozenRunPairs, PET_VIDEO_POLICY.maxFrozenRunPairs + 1);
  assert.equal(analysis.checks.find((check) => check.key === 'middle_freeze')?.passed, false);
});

test('cadence gate rejects incomplete or corrupt per-frame measurements', () => {
  assert.throws(() => analyzeAdjacentFrameSsim([0.9]), PetVideoContractError);
  const values = healthyCadence();
  values[3] = Number.NaN;
  assert.throws(() => analyzeAdjacentFrameSsim(values), PetVideoContractError);
});

test('rejected batch keeps independently validated siblings playable but never publishes a QA failure', () => {
  const raw = { file: 'raw.mp4', sha256: 'a'.repeat(64), bytes: 1, nodeId: '202', slot: 'videos', index: 0 };
  const published = (uiKey: string): PetActionArtifactManifest['branches'][number] => ({
    action: uiKey, uiKey, state: 'published' as const, raw,
    final: {
      file: `public/${uiKey}.mp4`, publicUrl: `/${uiKey}.mp4`, sha256: 'b'.repeat(64), bytes: 1,
      fps: 30, frames: 152, entryAnchorFrame: 0, handoffOutFrame: 150,
    },
  });
  const mixed: PetActionArtifactManifest['branches'] = [published('idle'), published('lick'), published('feed'), {
    action: 'pet', uiKey: 'pet', state: 'qa_failed' as const, raw, error: 'SOURCE_SEAM_MISMATCH',
  }];
  assert.doesNotThrow(() => assertArtifactPublicationInvariant('rejected', mixed));
  assert.throws(
    () => assertArtifactPublicationInvariant('rejected', [
      published('idle'), published('lick'), published('feed'), published('pet'),
    ]),
    PetVideoContractError,
  );
  assert.throws(() => assertArtifactPublicationInvariant('rejected', [
    published('idle'), published('lick'), published('feed'), {
      ...published('pet'), state: 'qa_failed' as const,
    },
  ]), PetVideoContractError);
});

test('crash recovery reuses only an exact immutable four-file publication', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pet-artifact-recovery-'));
  const expectations = Array.from({ length: 4 }, (_, index) => {
    const bytes = Buffer.from(`artifact-${index}`);
    return {
      filename: `action-${index}.mp4`,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.byteLength,
      contents: bytes,
    };
  });
  try {
    await Promise.all(expectations.map((item) => writeFile(join(directory, item.filename), item.contents)));
    await assert.doesNotReject(assertImmutablePublishedDirectory(directory, expectations));

    await writeFile(join(directory, expectations[2].filename), 'different bytes');
    await assert.rejects(assertImmutablePublishedDirectory(directory, expectations), PetVideoContractError);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('raw frame weights keep two exact anchor frames at both ends', () => {
  assert.equal(rawWeightAtFrame(0), 0);
  assert.equal(rawWeightAtFrame(1), 0);
  assert.equal(rawWeightAtFrame(2), 0.125);
  assert.equal(rawWeightAtFrame(9), 1);
  assert.equal(rawWeightAtFrame(10), 1);
  assert.equal(rawWeightAtFrame(142), 1);
  assert.equal(rawWeightAtFrame(143), 0.875);
  assert.equal(rawWeightAtFrame(149), 0.125);
  assert.equal(rawWeightAtFrame(150), 0);
  assert.equal(rawWeightAtFrame(151), 0);
});

test('raw frame weights reject values outside the compiled timeline', () => {
  assert.throws(() => rawWeightAtFrame(-1), PetVideoContractError);
  assert.throws(() => rawWeightAtFrame(152), PetVideoContractError);
  assert.throws(() => rawWeightAtFrame(1.5), PetVideoContractError);
});
