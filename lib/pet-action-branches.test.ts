import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createPetActionBatch,
  getPetAvatarDemoCache,
  GRAY_ACTION_MASTER_SHA256,
  GRAY_CAT_PROFILE_ID,
  isAtomicPlayablePetActionBatch,
  ORANGE_ACTION_MASTER_SHA256,
  ORANGE_LONGHAIR_PROFILE_ID,
  PET_ACTION_KEYS,
  playableBranchCount,
} from './pet-action-branches.ts';

test('only the exact gray and orange demo photos hit the avatar cache', () => {
  assert.deepEqual(getPetAvatarDemoCache(GRAY_ACTION_MASTER_SHA256), {
    previewUrl: '/assets/gray-cat-idle.png',
    profileId: GRAY_CAT_PROFILE_ID,
    masterSha256: GRAY_ACTION_MASTER_SHA256,
  });
  assert.equal(
    getPetAvatarDemoCache('a78c038573c5cac4dcc66975687abe3add76d2b258b7ce497900493efd86ad37')?.profileId,
    ORANGE_LONGHAIR_PROFILE_ID,
  );
  assert.equal(getPetAvatarDemoCache('0'.repeat(64)), null);
});

test('exact gray demo master exposes its four cached actions', () => {
  const batch = createPetActionBatch('gray-avatar-job', GRAY_CAT_PROFILE_ID, GRAY_ACTION_MASTER_SHA256);
  assert.equal(playableBranchCount(batch), 4);
  assert.equal(isAtomicPlayablePetActionBatch(batch), true);
  assert.equal(batch.branches.every((branch) => branch.cacheHit), true);
});

test('exact approved orange master exposes four explicitly labelled POC salvage artifacts', () => {
  const batch = createPetActionBatch(
    'avatar-job-1',
    ORANGE_LONGHAIR_PROFILE_ID,
    ORANGE_ACTION_MASTER_SHA256,
  );

  assert.equal(batch.mode, 'plan_only');
  assert.equal(batch.registryVersion, 'pet-actions-v3');
  assert.equal(batch.billingStarted, false);
  assert.equal(batch.profileId, ORANGE_LONGHAIR_PROFILE_ID);
  assert.equal(batch.masterSha256, ORANGE_ACTION_MASTER_SHA256);
  assert.equal(batch.branches.length, 4);
  assert.deepEqual(new Set(batch.branches.map((branch) => branch.action)), new Set(PET_ACTION_KEYS));
  assert.equal(playableBranchCount(batch), 4);

  const idle = batch.branches.find((branch) => branch.action === 'idle');
  const lick = batch.branches.find((branch) => branch.action === 'lick');
  const feed = batch.branches.find((branch) => branch.action === 'feed');
  const pet = batch.branches.find((branch) => branch.action === 'pet');
  assert.equal(idle?.capability, 'poc');
  assert.equal(idle?.reasonCode, 'POC_SOURCE_GATE_BYPASSED');
  assert.equal(lick?.capability, 'poc');
  assert.equal(lick?.runState, 'succeeded');
  assert.equal(feed?.capability, 'poc');
  assert.equal(feed?.runState, 'succeeded');
  assert.equal(feed?.dispatchAllowed, true);
  assert.equal(feed?.reasonCode, 'POC_SOURCE_GATE_BYPASSED');
  assert.equal(feed?.videoUrl, '/assets/generated/cat-feed-orange-longhair-anchor30-poc-v2.mp4');
  assert.equal(feed?.outputSha256, 'bd296b4fe3340d53e37cb298453c0b2cf068fa45d2d718045f842fbbb2b27ba5');
  assert.equal(feed?.cacheHit, true);
  assert.equal(pet?.capability, 'poc');
  assert.equal(pet?.runState, 'succeeded');
  assert.equal(pet?.dispatchAllowed, true);
  assert.equal(pet?.reasonCode, 'POC_SOURCE_GATE_BYPASSED');
  assert.equal(pet?.videoUrl, '/assets/generated/cat-head-pet-orange-longhair-anchor30-poc-v2.mp4');
  assert.equal(pet?.outputSha256, '81374e89fbda2d61931dc2d774e59d67c445ac09f83bd81e14f7fed42b742329');
  assert.equal(pet?.cacheHit, true);
  assert.equal(batch.branches.every((branch) => branch.fps === 30), true);
  assert.equal(batch.branches.every((branch) => branch.frameCount === 152), true);
  assert.equal(batch.branches.every((branch) => branch.handoffOutFrame === 150), true);
  assert.equal(batch.branches.every((branch) => branch.publishState === 'poc_salvage'), true);
  assert.equal(isAtomicPlayablePetActionBatch(batch), true);
});

test('playback publication is fail-closed for partial, mixed, or hash-mismatched batches', () => {
  const original = createPetActionBatch(
    'avatar-job-atomic',
    ORANGE_LONGHAIR_PROFILE_ID,
    ORANGE_ACTION_MASTER_SHA256,
  );

  const partial = structuredClone(original);
  partial.branches.pop();
  assert.equal(isAtomicPlayablePetActionBatch(partial), false);
  assert.equal(playableBranchCount(partial), 0);

  const oneReadyWhileOthersGenerate = structuredClone(original);
  oneReadyWhileOthersGenerate.branches.slice(1).forEach((branch) => Object.assign(branch, {
    capability: 'prepared',
    runState: 'generating',
    publishState: undefined,
    videoUrl: undefined,
    outputSha256: undefined,
  }));
  assert.equal(isAtomicPlayablePetActionBatch(oneReadyWhileOthersGenerate), false);
  assert.equal(playableBranchCount(oneReadyWhileOthersGenerate), 1);

  const wrongBytes = structuredClone(original);
  wrongBytes.branches[2].outputSha256 = 'not-a-sha';
  assert.equal(isAtomicPlayablePetActionBatch(wrongBytes), false);

  const mixedPolicy = structuredClone(original);
  Object.assign(mixedPolicy.branches[0], {
    capability: 'validated',
    reasonCode: 'READY',
    publishState: 'published',
    mediaPolicyVersion: 'pet-video-v2',
    qaPolicyVersion: 'pet-video-qa-v2',
  });
  assert.equal(isAtomicPlayablePetActionBatch(mixedPolicy), false);

  const formal = structuredClone(original);
  formal.branches.forEach((branch) => Object.assign(branch, {
    capability: 'validated',
    reasonCode: 'READY',
    publishState: 'published',
    mediaPolicyVersion: 'pet-video-v2',
    qaPolicyVersion: 'pet-video-qa-v2',
  }));
  assert.equal(isAtomicPlayablePetActionBatch(formal), true);
  assert.equal(playableBranchCount(formal), 4);
});

test('wrong master hash never reuses the known orange action artifacts', () => {
  const batch = createPetActionBatch(
    'avatar-job-2',
    ORANGE_LONGHAIR_PROFILE_ID,
    `${ORANGE_ACTION_MASTER_SHA256.slice(0, -1)}0`,
  );

  assert.equal(playableBranchCount(batch), 0);
  assert.equal(batch.branches.every((branch) => !branch.videoUrl), true);
  assert.equal(batch.branches.find((branch) => branch.action === 'idle')?.reasonCode, 'MASTER_HASH_MISMATCH');
  assert.equal(batch.branches.find((branch) => branch.action === 'feed')?.reasonCode, 'MASTER_HASH_MISMATCH');
  assert.equal(batch.branches.find((branch) => branch.action === 'pet')?.reasonCode, 'MASTER_HASH_MISMATCH');
  assert.equal(batch.branches.find((branch) => branch.action === 'pet')?.videoUrl, undefined);
});

test('unprofiled user master never receives another pet cached artifact', () => {
  const batch = createPetActionBatch('avatar-job-3');

  assert.equal(playableBranchCount(batch), 0);
  assert.equal(batch.branches.every((branch) => !branch.videoUrl), true);
  assert.equal(batch.branches.every((branch) => branch.runState === 'not_started'), true);
  assert.equal(batch.branches.find((branch) => branch.action === 'feed')?.reasonCode, 'IDENTITY_PROFILE_REQUIRED');
});

test('known profile can be prepared for a controlled real four-worker acceptance run without cache reuse', () => {
  const batch = createPetActionBatch(
    'avatar-job-live-1',
    ORANGE_LONGHAIR_PROFILE_ID,
    ORANGE_ACTION_MASTER_SHA256,
    { useKnownCache: false },
  );

  assert.equal(batch.mode, 'plan_only');
  assert.equal(batch.billingStarted, false);
  assert.equal(playableBranchCount(batch), 0);
  assert.equal(batch.branches.every((branch) => branch.capability === 'prepared'), true);
  assert.equal(batch.branches.every((branch) => branch.dispatchAllowed), true);
  assert.equal(batch.branches.every((branch) => branch.runState === 'not_started'), true);
  assert.equal(batch.branches.every((branch) => !branch.videoUrl), true);
});

test('cached master and action files still match the hashes in the branch contract', async () => {
  const batch = createPetActionBatch(
    'avatar-job-4',
    ORANGE_LONGHAIR_PROFILE_ID,
    ORANGE_ACTION_MASTER_SHA256,
  );
  const files: Array<[string, string]> = [
    ['public/assets/generated/pet-avatar-orange-longhair-motion-safe-v3.png', ORANGE_ACTION_MASTER_SHA256],
  ];
  for (const branch of batch.branches) {
    if (branch.videoUrl && branch.outputSha256) files.push([`public${branch.videoUrl}`, branch.outputSha256]);
  }

  for (const [relativePath, expectedHash] of files) {
    const bytes = await readFile(join(process.cwd(), relativePath));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedHash);
  }
});

test('gray cached master and action files still match the branch contract', async () => {
  const batch = createPetActionBatch('gray-avatar-files', GRAY_CAT_PROFILE_ID, GRAY_ACTION_MASTER_SHA256);
  const files: Array<[string, string]> = [
    ['public/assets/gray-cat-idle.png', GRAY_ACTION_MASTER_SHA256],
  ];
  for (const branch of batch.branches) {
    if (branch.videoUrl && branch.outputSha256) files.push([`public${branch.videoUrl}`, branch.outputSha256]);
  }
  for (const [relativePath, expectedHash] of files) {
    const bytes = await readFile(join(process.cwd(), relativePath));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedHash);
  }
});
