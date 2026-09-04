import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PetActionCoordinator } from './pet-action-coordinator.ts';
import { petActionBranchArtifactFile } from '../lib/video/pet-video-finalizer.ts';

const PROFILE = 'orange_test';
const MASTER = 'a'.repeat(64);

test('durable coordinator deduplicates enqueue and survives process recreation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pet-action-coordinator-'));
  try {
    const manifestFile = 'batch.json';
    await writeFile(join(root, manifestFile), JSON.stringify({
      schemaVersion: 1,
      petId: PROFILE,
      masterSha256: MASTER,
      branches: ['idle', 'lick', 'feed', 'pet'].map((uiKey) => ({ uiKey })),
    }));
    let runs = 0;
    const coordinator = new PetActionCoordinator({
      projectRoot: root,
      dataDirectory: join(root, 'data'),
      registry: [{ profileId: PROFILE, masterSha256: MASTER, manifestFile }],
      runBatch: async ({ runDirectory }) => {
        runs += 1;
        const directory = join(root, runDirectory);
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, 'artifact-manifest.json'), JSON.stringify({
          schemaVersion: 1,
          batchId: 'batch-1',
          petId: PROFILE,
          status: 'published',
          branches: ['idle', 'lick', 'feed', 'pet'].map((uiKey, index) => ({
            uiKey,
            state: 'published',
            final: {
              file: `public/${uiKey}.mp4`,
              publicUrl: `/${uiKey}.mp4`,
              sha256: String(index + 1).repeat(64),
              bytes: 10,
              fps: 30,
              frames: 152,
              entryAnchorFrame: 0,
              handoffOutFrame: 150,
            },
          })),
        }));
      },
    });

    const [first, duplicate] = await Promise.all([
      coordinator.enqueue({ avatarJobId: 'avatar-1', profileId: PROFILE, masterSha256: MASTER }),
      coordinator.enqueue({ avatarJobId: 'avatar-1', profileId: PROFILE, masterSha256: MASTER }),
    ]);
    assert.equal(first.id, duplicate.id);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if ((await coordinator.get(first.id)).state === 'complete') break;
      await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
    }
    assert.equal((await coordinator.get(first.id)).state, 'complete');
    assert.equal(runs, 1);
    await coordinator.waitForIdle();

    const recreated = new PetActionCoordinator({
      projectRoot: root,
      dataDirectory: join(root, 'data'),
      registry: [{ profileId: PROFILE, masterSha256: MASTER, manifestFile }],
      runBatch: async () => { throw new Error('completed job must not run again'); },
    });
    await recreated.resume();
    const restored = await recreated.get(first.id);
    assert.equal(restored.state, 'complete');
    assert.equal(restored.branches.every((branch) => branch.state === 'succeeded'), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a strict single-branch artifact becomes playable while sibling branches are still running', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pet-action-progress-'));
  let release!: () => void;
  const gate = new Promise<void>((resolvePromise) => { release = resolvePromise; });
  let published!: () => void;
  const branchPublished = new Promise<void>((resolvePromise) => { published = resolvePromise; });
  let coordinator: PetActionCoordinator | null = null;
  try {
    const manifestFile = 'batch.json';
    const manifestText = JSON.stringify({
      schemaVersion: 1,
      petId: PROFILE,
      masterSha256: MASTER,
      branches: ['idle', 'lick', 'feed', 'pet'].map((uiKey) => ({ uiKey })),
    });
    await writeFile(join(root, manifestFile), manifestText);
    const batchId = `${PROFILE}-${createHash('sha256').update(manifestText).digest('hex').slice(0, 12)}`;
    const videoBytes = Buffer.from('strictly-validated-video');
    const videoSha256 = createHash('sha256').update(videoBytes).digest('hex');
    coordinator = new PetActionCoordinator({
      projectRoot: root,
      dataDirectory: join(root, 'data'),
      registry: [{ profileId: PROFILE, masterSha256: MASTER, manifestFile }],
      runBatch: async ({ runDirectory }) => {
        const videoFile = join(root, 'public', 'idle.mp4');
        await mkdir(join(root, 'public'), { recursive: true });
        await writeFile(videoFile, videoBytes);
        const recordFile = petActionBranchArtifactFile(join(root, runDirectory), 'idle');
        await mkdir(join(root, runDirectory, 'branch-artifacts'), { recursive: true });
        await writeFile(recordFile, JSON.stringify({
          schemaVersion: 1,
          batchId,
          petId: PROFILE,
          masterSha256: MASTER,
          policyVersion: 'pet-video-v2',
          qaPolicyVersion: 'pet-video-qa-v2',
          branch: {
            action: 'idle',
            uiKey: 'idle',
            state: 'published',
            raw: {
              file: 'raw-idle.mp4', sha256: 'c'.repeat(64), bytes: 10,
              nodeId: '202', slot: 'videos', index: 0,
            },
            final: {
              file: 'public/idle.mp4', publicUrl: '/idle.mp4', sha256: videoSha256,
              bytes: videoBytes.byteLength, fps: 30, frames: 152,
              entryAnchorFrame: 0, handoffOutFrame: 150,
            },
          },
        }));
        published();
        await gate;
      },
    });

    const queued = await coordinator.enqueue({
      avatarJobId: 'avatar-progress', profileId: PROFILE, masterSha256: MASTER,
    });
    await branchPublished;
    const partial = await coordinator.get(queued.id);
    assert.equal(partial.state, 'partial_ready');
    assert.equal(partial.branches.find((branch) => branch.action === 'idle')?.state, 'succeeded');
    assert.equal(partial.branches.filter((branch) => branch.state === 'succeeded').length, 1);
    assert.equal(await coordinator.videoFile(queued.id, 'idle'), join(root, 'public', 'idle.mp4'));
    release();
    await coordinator.waitForIdle();
  } finally {
    release?.();
    await coordinator?.waitForIdle();
    await rm(root, { recursive: true, force: true });
  }
});
