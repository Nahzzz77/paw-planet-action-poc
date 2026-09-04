import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createPetActionBatch,
  ORANGE_ACTION_MASTER_SHA256,
  ORANGE_LONGHAIR_PROFILE_ID,
  playableBranchCount,
} from './pet-action-branches.ts';
import { applyCoordinatorSnapshot } from './pet-action-coordinator.ts';

const preparedBatch = () => createPetActionBatch(
  'avatar-job-1',
  ORANGE_LONGHAIR_PROFILE_ID,
  ORANGE_ACTION_MASTER_SHA256,
  { useKnownCache: false },
);

test('coordinator snapshot unlocks a validated branch without exposing unfinished videos', () => {
  const batch = applyCoordinatorSnapshot(preparedBatch(), {
    id: 'actions-1',
    avatarJobId: 'avatar-job-1',
    profileId: ORANGE_LONGHAIR_PROFILE_ID,
    masterSha256: ORANGE_ACTION_MASTER_SHA256,
    state: 'partial_ready',
    billingStarted: true,
    branches: [
      {
        action: 'idle',
        state: 'succeeded',
        outputSha256: '1'.repeat(64),
        fps: 30,
        frameCount: 152,
        handoffOutFrame: 150,
      },
      { action: 'lick', state: 'generating' },
      { action: 'feed', state: 'queued' },
      { action: 'pet', state: 'failed', error: 'worker unavailable' },
    ],
  });

  assert.equal(batch.mode, 'coordinated');
  assert.equal(batch.billingStarted, true);
  assert.equal(batch.coordinatorJobId, 'actions-1');
  assert.equal(playableBranchCount(batch), 1);
  assert.equal(batch.branches.find((branch) => branch.action === 'idle')?.videoUrl, '/api/pet-avatar/action-videos/actions-1/idle');
  assert.equal(batch.branches.find((branch) => branch.action === 'lick')?.runState, 'generating');
  assert.equal(batch.branches.find((branch) => branch.action === 'feed')?.videoUrl, undefined);
  assert.equal(batch.branches.find((branch) => branch.action === 'pet')?.runState, 'failed');
});

test('coordinator result is rejected when it belongs to another master', () => {
  assert.throws(() => applyCoordinatorSnapshot(preparedBatch(), {
    id: 'actions-2',
    avatarJobId: 'avatar-job-1',
    profileId: ORANGE_LONGHAIR_PROFILE_ID,
    masterSha256: '0'.repeat(64),
    state: 'queued',
    billingStarted: false,
    branches: [
      { action: 'idle', state: 'queued' },
      { action: 'lick', state: 'queued' },
      { action: 'feed', state: 'queued' },
      { action: 'pet', state: 'queued' },
    ],
  }), /母版不匹配/);
});
