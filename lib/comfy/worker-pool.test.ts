import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { collectSaveVideoOutputs, ComfyWorkerClient } from './worker-client.ts';
import {
  ComfyWorkerPool,
  decideAutomaticQaRetry,
  hashBatchManifest,
  markQaFailedBranchesForRetry,
  runPetActionBatch,
  type PetActionBatchManifest,
} from './worker-pool.ts';

const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

async function writeFixtureFile(root: string, path: string, bytes: Uint8Array | string) {
  const destination = join(root, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
  return destination;
}

async function createFixture() {
  const projectRoot = await mkdtemp(join(tmpdir(), 'pet-4gpu-runner-'));
  const master = Buffer.from('real-master-image-bytes');
  await writeFixtureFile(projectRoot, 'public/assets/generated/master.png', master);
  const uiKeys = ['idle', 'lick', 'feed', 'pet'];
  const branches = [];
  for (let index = 0; index < 4; index += 1) {
    const driver = Buffer.from(`driver-${index + 1}-bytes`);
    const driverFile = `workflows/drivers/driver-${index + 1}.mp4`;
    await writeFixtureFile(projectRoot, driverFile, driver);
    const workflow = {
      '30': { class_type: 'LoadImage', inputs: { image: 'master.png' } },
      '155': { class_type: 'LoadVideo', inputs: { file: `driver-${index + 1}.mp4` } },
      '213:19': { class_type: 'SamplerCustom', inputs: { noise_seed: 1000 + index } },
      '202': {
        class_type: 'SaveVideo',
        inputs: { filename_prefix: `pet_poc/test/${uiKeys[index]}`, video: ['201', 0] },
      },
      '999': { class_type: 'SaveImage', inputs: { filename_prefix: 'ignored' } },
    };
    const workflowFile = `workflows/compiled/workflow-${index + 1}.json`;
    const workflowBytes = Buffer.from(`${JSON.stringify(workflow, null, 2)}\n`);
    await writeFixtureFile(projectRoot, workflowFile, workflowBytes);
    branches.push({
      action: uiKeys[index],
      uiKey: uiKeys[index],
      workerSlot: `gpu-${index + 1}`,
      compileStatus: 'compiled',
      dispatchAllowed: true,
      workflowFile,
      workflowSha256: digest(workflowBytes),
      driverFile,
      driverSha256: digest(driver),
      retrySeeds: [1000 + index, 2000 + index] as [number, number],
      expectedOutput: {
        nodeId: '202' as const,
        slot: 'videos' as const,
        index: 0 as const,
      },
    });
  }
  const manifest: PetActionBatchManifest = {
    schemaVersion: 1,
    petId: 'fixture_pet',
    masterFile: 'master.png',
    masterSha256: digest(master),
    generationRetryPolicy: {
      maxAttemptsPerBranch: 2,
    },
    postprocessPolicyVersion: 'pet-video-v2',
    outputContract: {
      width: 576,
      height: 768,
      fps: 30,
      frames: 152,
      codec: 'h264',
      codecProfile: 'Main',
      codecLevel: 31,
      maxBFrames: 0,
      keyframeInterval: 30,
      maxBitrateBitsPerSecond: 8000000,
      vbvBufferBits: 8000000,
      pixfmt: 'yuv420p',
      audio: false,
    },
    seamPolicy: {
      canonical: 'master',
      anchorHoldFrames: 2,
      bridgeFrames: 10,
      handoffOutFrame: 150,
    },
    qaPolicyVersion: 'pet-video-qa-v2',
    branches,
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  return { projectRoot, manifest, manifestSha256: hashBatchManifest(manifestBytes) };
}

class MockComfyCluster {
  readonly requests: string[] = [];
  readonly promptPosts = new Map<string, number>();
  readonly uploads = new Map<string, number>();
  readonly maxPromptConcurrency = new Map<string, number>();
  readonly promptSeeds = new Map<string, number[]>();
  readonly #activePrompts = new Map<string, number>();
  readonly #promptHost = new Map<string, string>();
  readonly failExecution = new Set<string>();
  readonly failUpload = new Set<string>();
  readonly rejectSubmissionSafe = new Set<string>();
  readonly loseSubmissionResponse = new Set<string>();
  readonly pendingHistory = new Set<string>();

  fetch = async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
    this.requests.push(url.toString());
    const host = url.hostname.split('.')[0];
    if (url.pathname.endsWith('/queue')) {
      const pending = [...this.#promptHost.entries()]
        .filter(([, promptHost]) => promptHost === host && this.pendingHistory.has(host))
        .map(([promptId], index) => [index, promptId]);
      return Response.json({ queue_running: pending, queue_pending: [] });
    }
    if (url.pathname.endsWith('/upload/image')) {
      this.uploads.set(host, (this.uploads.get(host) ?? 0) + 1);
      if (this.failUpload.has(host)) return new Response('upload unavailable', { status: 503 });
      const form = init?.body as FormData;
      const file = form.get('image');
      const subfolder = String(form.get('subfolder') ?? '');
      assert.ok(file instanceof Blob);
      return Response.json({
        name: 'name' in file && typeof file.name === 'string' ? file.name : 'input.bin',
        subfolder,
        type: 'input',
      });
    }
    if (url.pathname.endsWith('/prompt')) {
      const payload = JSON.parse(String(init?.body)) as {
        prompt: Record<string, { inputs?: Record<string, unknown> }>;
      };
      const seed = payload.prompt['213:19']?.inputs?.noise_seed;
      assert.equal(typeof seed, 'number');
      this.promptSeeds.set(host, [...(this.promptSeeds.get(host) ?? []), seed as number]);
      const active = (this.#activePrompts.get(host) ?? 0) + 1;
      this.#activePrompts.set(host, active);
      this.maxPromptConcurrency.set(host, Math.max(active, this.maxPromptConcurrency.get(host) ?? 0));
      this.promptPosts.set(host, (this.promptPosts.get(host) ?? 0) + 1);
      await Promise.resolve();
      this.#activePrompts.set(host, active - 1);
      if (this.rejectSubmissionSafe.has(host)) {
        return Response.json({ error: 'workflow rejected before queueing' }, { status: 400 });
      }
      if (this.loseSubmissionResponse.has(host)) throw new TypeError('socket closed after POST');
      const promptId = `${host}-prompt-${this.promptPosts.get(host)}`;
      this.#promptHost.set(promptId, host);
      return Response.json({ prompt_id: promptId, number: 1, node_errors: {} });
    }
    if (url.pathname.includes('/history/')) {
      const promptId = decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/') + 1));
      const promptHost = this.#promptHost.get(promptId);
      if (!promptHost || this.pendingHistory.has(promptHost)) return Response.json({});
      if (this.failExecution.has(promptHost)) {
        return Response.json({
          [promptId]: {
            status: {
              completed: false,
              status_str: 'error',
              messages: [['execution_error', { exception_message: `failed on ${promptHost}`, node_id: '77' }]],
            },
            outputs: {},
          },
        });
      }
      return Response.json({
        [promptId]: {
          status: { completed: true, status_str: 'success', messages: [] },
          outputs: {
            '202': {
              videos: [{ filename: `${promptHost}-main.mp4`, subfolder: 'pet/test', type: 'output' }],
              previews: [{ filename: `${promptHost}-preview.webm`, subfolder: 'pet/test', type: 'output' }],
            },
            '999': {
              images: [{ filename: 'must-not-download.png', subfolder: '', type: 'output' }],
            },
          },
        },
      });
    }
    if (url.pathname.endsWith('/view')) {
      return new Response(Buffer.from(`downloaded:${url.searchParams.get('filename')}`));
    }
    return new Response('not found', { status: 404 });
  };

  workers(secretCookies = false) {
    const result = new Map<string, ComfyWorkerClient>();
    for (let number = 1; number <= 4; number += 1) {
      const slot = `gpu-${number}`;
      result.set(slot, new ComfyWorkerClient({
        id: slot,
        baseUrl: `https://${slot}.test/comfy/`,
        authCookie: secretCookies ? `private-cookie-${number}` : undefined,
      }, this.fetch as typeof fetch));
    }
    return result;
  }
}

function clock() {
  let milliseconds = 0;
  return {
    now: () => new Date(milliseconds),
    sleep: async (duration: number) => { milliseconds += duration; },
  };
}

test('normalizes modern ComfyUI animated MP4 image outputs to the videos slot', () => {
  const workflow = { '202': { class_type: 'SaveVideo', inputs: {} } };
  const outputs = collectSaveVideoOutputs({
    outputs: {
      '202': {
        images: [{ filename: 'pet.mp4', subfolder: 'pet/test', type: 'output' }],
        animated: [true],
      },
    },
  }, workflow);
  assert.deepEqual(outputs, [{
    nodeId: '202',
    slot: 'videos',
    index: 0,
    filename: 'pet.mp4',
    subfolder: 'pet/test',
    type: 'output',
  }]);
});

test('four distinct workers upload inputs, submit concurrently, parse every SaveVideo slot, and hash downloads', async () => {
  const fixture = await createFixture();
  const cluster = new MockComfyCluster();
  const runDirectory = join(fixture.projectRoot, 'workflows/runs/first');
  const fakeClock = clock();
  const finalized: string[] = [];
  const result = await runPetActionBatch({
    ...fixture,
    runDirectory,
    workers: cluster.workers(true),
    pollIntervalMs: 1,
    timeoutMs: 20,
    onBranchSucceeded: (branch) => { finalized.push(branch.uiKey); },
    ...fakeClock,
  });

  assert.equal(result.settled.length, 4);
  assert.ok(result.settled.every((item) => item.status === 'fulfilled'));
  assert.deepEqual(new Set(finalized), new Set(['idle', 'lick', 'feed', 'pet']));
  for (let number = 1; number <= 4; number += 1) {
    const host = `gpu-${number}`;
    assert.equal(cluster.uploads.get(host), 2, `${host} receives one master and one driver`);
    assert.equal(cluster.promptPosts.get(host), 1);
    assert.deepEqual(cluster.promptSeeds.get(host), [999 + number]);
    assert.equal(cluster.maxPromptConcurrency.get(host), 1);
  }
  for (const branch of result.branches) {
    assert.equal(branch.state, 'succeeded');
    assert.equal(branch.attempt, 1);
    assert.equal(branch.outputs.length, 2, 'all media slots from SaveVideo are retained');
    for (const output of branch.outputs) {
      const bytes = await readFile(output.localFile);
      assert.equal(output.sha256, digest(bytes));
      assert.notEqual(output.filename, 'must-not-download.png');
    }
  }
  const recordText = await readFile(result.runRecordFile, 'utf8');
  assert.doesNotMatch(recordText, /private-cookie/);
  assert.doesNotMatch(recordText, /https:\/\//);
});

test('partial failure keeps three successes and --retry-failed submits only the failed branch', async () => {
  const fixture = await createFixture();
  const cluster = new MockComfyCluster();
  cluster.failExecution.add('gpu-4');
  const runDirectory = join(fixture.projectRoot, 'workflows/runs/partial');
  const fakeClock = clock();
  const first = await runPetActionBatch({
    ...fixture,
    runDirectory,
    workers: cluster.workers(),
    pollIntervalMs: 1,
    timeoutMs: 20,
    ...fakeClock,
  });
  assert.equal(first.branches.filter((branch) => branch.state === 'succeeded').length, 3);
  assert.equal(first.branches.find((branch) => branch.uiKey === 'pet')?.state, 'failed');

  cluster.failExecution.delete('gpu-4');
  const second = await runPetActionBatch({
    ...fixture,
    runDirectory,
    workers: cluster.workers(),
    retryFailed: true,
    pollIntervalMs: 1,
    timeoutMs: 20,
    ...fakeClock,
  });
  assert.equal(second.settled.length, 1);
  assert.equal(second.settled[0].status, 'fulfilled');
  assert.ok(second.branches.every((branch) => branch.state === 'succeeded'));
  for (let number = 1; number <= 3; number += 1) {
    assert.equal(cluster.promptPosts.get(`gpu-${number}`), 1);
    assert.equal(cluster.uploads.get(`gpu-${number}`), 2);
  }
  assert.equal(cluster.promptPosts.get('gpu-4'), 2);
  assert.deepEqual(cluster.promptSeeds.get('gpu-4'), [1003, 2003]);
  assert.equal(cluster.uploads.get('gpu-4'), 4);
  const retried = second.branches.find((branch) => branch.uiKey === 'pet');
  assert.equal(retried?.attempt, 2);
  assert.deepEqual(retried?.previousPromptIds, ['gpu-4-prompt-1']);
});

test('QA rejection marks only selected successes, preserves audit, retries with seed two, and forbids attempt three', async () => {
  const fixture = await createFixture();
  const cluster = new MockComfyCluster();
  const runDirectory = join(fixture.projectRoot, 'workflows/runs/qa-retry');
  const fakeClock = clock();
  const first = await runPetActionBatch({
    ...fixture,
    runDirectory,
    workers: cluster.workers(),
    pollIntervalMs: 1,
    timeoutMs: 20,
    ...fakeClock,
  });
  const untouchedBefore = first.branches.filter((branch) => branch.uiKey !== 'lick');

  const marked = await markQaFailedBranchesForRetry({
    runDirectory,
    failures: [{ uiKey: 'lick', reason: 'endpoint SSIM below threshold' }],
    ...fakeClock,
  });
  const markedLick = marked.branches.find((branch) => branch.uiKey === 'lick');
  assert.equal(markedLick?.state, 'failed');
  assert.equal(markedLick?.attempt, 1);
  assert.equal(markedLick?.outputs.length, 0);
  assert.deepEqual(markedLick?.previousPromptIds, ['gpu-2-prompt-1']);
  assert.equal(markedLick?.outputHistory.length, 1);
  assert.equal(markedLick?.outputHistory[0]?.outputs.length, 2);
  assert.deepEqual(markedLick?.qaFailures.map((failure) => failure.reason), ['endpoint SSIM below threshold']);
  assert.deepEqual(
    marked.branches.filter((branch) => branch.uiKey !== 'lick'),
    untouchedBefore,
    'branches not named by QA remain byte-for-byte unchanged',
  );

  const second = await runPetActionBatch({
    ...fixture,
    runDirectory,
    workers: cluster.workers(),
    retryFailed: true,
    pollIntervalMs: 1,
    timeoutMs: 20,
    ...fakeClock,
  });
  assert.equal(second.settled.length, 1);
  assert.equal(second.settled[0]?.status, 'fulfilled');
  assert.deepEqual(cluster.promptSeeds.get('gpu-2'), [1001, 2001]);
  assert.equal(cluster.promptPosts.get('gpu-1'), 1);
  assert.equal(cluster.promptPosts.get('gpu-2'), 2);
  assert.equal(cluster.promptPosts.get('gpu-3'), 1);
  assert.equal(cluster.promptPosts.get('gpu-4'), 1);
  const retriedLick = second.branches.find((branch) => branch.uiKey === 'lick');
  assert.equal(retriedLick?.attempt, 2);
  assert.equal(retriedLick?.seed, 2001);
  assert.equal(retriedLick?.outputHistory.length, 1);

  await markQaFailedBranchesForRetry({
    runDirectory,
    failures: [{ uiKey: 'lick', reason: 'second candidate also failed QA' }],
    ...fakeClock,
  });
  const third = await runPetActionBatch({
    ...fixture,
    runDirectory,
    workers: cluster.workers(),
    retryFailed: true,
    pollIntervalMs: 1,
    timeoutMs: 20,
    ...fakeClock,
  });
  assert.equal(third.settled.length, 1);
  assert.equal(third.settled[0]?.status, 'rejected');
  if (third.settled[0]?.status === 'rejected') {
    assert.match(String(third.settled[0].reason), /exhausted its 2 generation attempts/);
  }
  assert.equal(cluster.promptPosts.get('gpu-2'), 2, 'attempt three never reaches paid submission');
  assert.equal(cluster.uploads.get('gpu-2'), 4, 'attempt three never uploads inputs');
  const exhausted = third.branches.find((branch) => branch.uiKey === 'lick');
  assert.deepEqual(exhausted?.previousPromptIds, ['gpu-2-prompt-1', 'gpu-2-prompt-2']);
  assert.equal(exhausted?.outputHistory.length, 2);
  assert.equal(exhausted?.qaFailures.length, 2);
});

test('automatic QA retry fuse allows one isolated source mismatch but blocks a 4/4 mismatch wave', async () => {
  const fixture = await createFixture();
  const cluster = new MockComfyCluster();
  const fakeClock = clock();
  const result = await runPetActionBatch({
    ...fixture,
    runDirectory: join(fixture.projectRoot, 'workflows/runs/fuse'),
    workers: cluster.workers(),
    pollIntervalMs: 1,
    timeoutMs: 20,
    ...fakeClock,
  });
  const one = decideAutomaticQaRetry(
    [{ uiKey: 'lick', reason: 'SOURCE_SEAM_MISMATCH: endpoint drift' }],
    result.branches,
  );
  assert.equal(one.reason, 'single_source_seam_mismatch');
  assert.equal(one.retry?.uiKey, 'lick');

  const four = decideAutomaticQaRetry(
    result.branches.map((branch) => ({
      uiKey: branch.uiKey,
      reason: 'SOURCE_SEAM_MISMATCH: shared master drift',
    })),
    result.branches,
  );
  assert.deepEqual(four, { retry: null, reason: 'batch_fuse' });
});

test('a unique persisted SOURCE_SEAM_MISMATCH resumes on an ordinary run after process restart', async () => {
  const fixture = await createFixture();
  const cluster = new MockComfyCluster();
  const runDirectory = join(fixture.projectRoot, 'workflows/runs/persisted-qa-retry');
  const fakeClock = clock();
  await runPetActionBatch({
    ...fixture,
    runDirectory,
    workers: cluster.workers(),
    pollIntervalMs: 1,
    timeoutMs: 20,
    ...fakeClock,
  });
  await markQaFailedBranchesForRetry({
    runDirectory,
    failures: [{ uiKey: 'lick', reason: 'SOURCE_SEAM_MISMATCH: raw endpoint below threshold' }],
    ...fakeClock,
  });

  const resumed = await runPetActionBatch({
    ...fixture,
    runDirectory,
    workers: cluster.workers(),
    // Intentionally no retryFailed flag: eligibility comes from run-record.json.
    pollIntervalMs: 1,
    timeoutMs: 20,
    ...fakeClock,
  });
  assert.equal(resumed.settled.length, 1);
  assert.equal(resumed.settled[0]?.status, 'fulfilled');
  assert.deepEqual(cluster.promptSeeds.get('gpu-2'), [1001, 2001]);
  assert.equal(resumed.branches.find((branch) => branch.uiKey === 'lick')?.attempt, 2);
});

test('upload and explicit retry-safe rejection do not consume attempts or alternate seeds', async () => {
  for (const failureMode of ['upload', 'safe-rejection'] as const) {
    const fixture = await createFixture();
    const cluster = new MockComfyCluster();
    const runDirectory = join(fixture.projectRoot, `workflows/runs/free-${failureMode}`);
    const fakeClock = clock();
    if (failureMode === 'upload') cluster.failUpload.add('gpu-1');
    else cluster.rejectSubmissionSafe.add('gpu-1');

    const first = await runPetActionBatch({
      ...fixture,
      runDirectory,
      workers: cluster.workers(),
      pollIntervalMs: 1,
      timeoutMs: 20,
      ...fakeClock,
    });
    const failed = first.branches.find((branch) => branch.uiKey === 'idle');
    assert.equal(failed?.state, 'failed');
    assert.equal(failed?.attempt, 0, `${failureMode} is not a paid attempt`);
    assert.equal(failed?.seed, null);

    cluster.failUpload.delete('gpu-1');
    cluster.rejectSubmissionSafe.delete('gpu-1');
    const second = await runPetActionBatch({
      ...fixture,
      runDirectory,
      workers: cluster.workers(),
      retryFailed: true,
      pollIntervalMs: 1,
      timeoutMs: 20,
      ...fakeClock,
    });
    const recovered = second.branches.find((branch) => branch.uiKey === 'idle');
    assert.equal(recovered?.state, 'succeeded');
    assert.equal(recovered?.attempt, 1);
    assert.equal(recovered?.seed, 1000, 'first seed remains available');
    assert.deepEqual(
      cluster.promptSeeds.get('gpu-1'),
      failureMode === 'upload' ? [1000] : [1000, 1000],
    );
  }
});

test('lost POST response becomes submission_unknown and is never blindly retried', async () => {
  const fixture = await createFixture();
  const cluster = new MockComfyCluster();
  cluster.loseSubmissionResponse.add('gpu-1');
  const runDirectory = join(fixture.projectRoot, 'workflows/runs/unknown');
  const fakeClock = clock();
  const first = await runPetActionBatch({
    ...fixture,
    runDirectory,
    workers: cluster.workers(),
    pollIntervalMs: 1,
    timeoutMs: 20,
    ...fakeClock,
  });
  assert.equal(first.branches.find((branch) => branch.uiKey === 'idle')?.state, 'submission_unknown');
  assert.equal(first.branches.find((branch) => branch.uiKey === 'idle')?.attempt, 1);
  assert.equal(first.branches.find((branch) => branch.uiKey === 'idle')?.seed, 1000);
  assert.equal(cluster.promptPosts.get('gpu-1'), 1);

  cluster.loseSubmissionResponse.delete('gpu-1');
  const second = await runPetActionBatch({
    ...fixture,
    runDirectory,
    workers: cluster.workers(),
    retryFailed: true,
    pollIntervalMs: 1,
    timeoutMs: 20,
    ...fakeClock,
  });
  assert.equal(second.settled.length, 1);
  assert.equal(second.settled[0].status, 'rejected');
  assert.equal(cluster.promptPosts.get('gpu-1'), 1, 'ambiguous prompt is not POSTed again');
});

test('a timed-out prompt resumes by prompt id without a second POST', async () => {
  const fixture = await createFixture();
  const cluster = new MockComfyCluster();
  cluster.pendingHistory.add('gpu-1');
  const runDirectory = join(fixture.projectRoot, 'workflows/runs/resume');
  const fakeClock = clock();
  const first = await runPetActionBatch({
    ...fixture,
    runDirectory,
    workers: cluster.workers(),
    pollIntervalMs: 2,
    timeoutMs: 3,
    allowBusyWorkers: true,
    ...fakeClock,
  });
  const pending = first.branches.find((branch) => branch.uiKey === 'idle');
  assert.equal(pending?.state, 'submitted');
  assert.equal(pending?.promptId, 'gpu-1-prompt-1');

  cluster.pendingHistory.delete('gpu-1');
  const second = await runPetActionBatch({
    ...fixture,
    runDirectory,
    workers: cluster.workers(),
    pollIntervalMs: 1,
    timeoutMs: 20,
    ...fakeClock,
  });
  assert.equal(second.settled.length, 1);
  assert.equal(second.settled[0].status, 'fulfilled');
  assert.equal(cluster.promptPosts.get('gpu-1'), 1);
  assert.equal(second.branches.find((branch) => branch.uiKey === 'idle')?.state, 'succeeded');
});

test('worker pool enforces concurrency one and duplicate endpoints fail before any network preflight', async () => {
  const cluster = new MockComfyCluster();
  const workers = cluster.workers();
  const pool = new ComfyWorkerPool(workers);
  let active = 0;
  let maximum = 0;
  let releaseFirst!: () => void;
  const gate = new Promise<void>((resolvePromise) => { releaseFirst = resolvePromise; });
  const first = pool.run('gpu-1', async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await gate;
    active -= 1;
  });
  const second = pool.run('gpu-1', async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    active -= 1;
  });
  await Promise.resolve();
  releaseFirst();
  await Promise.all([first, second]);
  assert.equal(maximum, 1);

  const fixture = await createFixture();
  const duplicate = new Map<string, ComfyWorkerClient>();
  for (let number = 1; number <= 4; number += 1) {
    duplicate.set(`gpu-${number}`, new ComfyWorkerClient({
      id: `gpu-${number}`,
      baseUrl: 'https://same-worker.test/',
    }, cluster.fetch as typeof fetch));
  }
  await assert.rejects(
    runPetActionBatch({
      ...fixture,
      runDirectory: join(fixture.projectRoot, 'workflows/runs/duplicate'),
      workers: duplicate,
    }),
    /four different ComfyUI worker endpoints/,
  );
  assert.equal(cluster.uploads.size, 0);
});

test('postprocess, seam, QA, and expected-output contracts fail before any paid prompt submission', async () => {
  const fixture = await createFixture();
  const cases: Array<{
    label: string;
    pattern: RegExp;
    mutate: (manifest: Record<string, unknown>) => void;
  }> = [
    {
      label: 'required master hash',
      pattern: /masterSha256 must be a required 64-character/,
      mutate: (manifest) => { manifest.masterSha256 = null; },
    },
    {
      label: 'master hash content mismatch',
      pattern: /master image SHA-256 mismatch/,
      mutate: (manifest) => { manifest.masterSha256 = '0'.repeat(64); },
    },
    {
      label: 'generation retry policy',
      pattern: /generationRetryPolicy.maxAttemptsPerBranch=2/,
      mutate: (manifest) => {
        (manifest.generationRetryPolicy as Record<string, unknown>).maxAttemptsPerBranch = 3;
      },
    },
    {
      label: 'retry seeds',
      pattern: /retrySeeds must contain two different/,
      mutate: (manifest) => {
        const branches = manifest.branches as Array<Record<string, unknown>>;
        branches[0].retrySeeds = [1000, 1000];
      },
    },
    {
      label: 'postprocess version',
      pattern: /postprocessPolicyVersion=pet-video-v2/,
      mutate: (manifest) => { manifest.postprocessPolicyVersion = 'legacy'; },
    },
    {
      label: 'output contract',
      pattern: /outputContract must be 576x768, 30fps, 152 frames/,
      mutate: (manifest) => {
        (manifest.outputContract as Record<string, unknown>).fps = 16;
      },
    },
    {
      label: 'seam contract',
      pattern: /seamPolicy must use the canonical master/,
      mutate: (manifest) => {
        (manifest.seamPolicy as Record<string, unknown>).handoffOutFrame = 151;
      },
    },
    {
      label: 'QA version',
      pattern: /qaPolicyVersion=pet-video-qa-v2/,
      mutate: (manifest) => { manifest.qaPolicyVersion = 'legacy'; },
    },
    {
      label: 'expected output',
      pattern: /expectedOutput must be node 202, videos slot, index 0/,
      mutate: (manifest) => {
        const branches = manifest.branches as Array<Record<string, unknown>>;
        (branches[0].expectedOutput as Record<string, unknown>).index = 1;
      },
    },
  ];

  for (const item of cases) {
    const manifest = structuredClone(fixture.manifest) as unknown as Record<string, unknown>;
    item.mutate(manifest);
    const cluster = new MockComfyCluster();
    await assert.rejects(
      runPetActionBatch({
        ...fixture,
        manifest: manifest as unknown as PetActionBatchManifest,
        runDirectory: join(fixture.projectRoot, `workflows/runs/invalid-${item.label.replaceAll(' ', '-')}`),
        workers: cluster.workers(),
      }),
      item.pattern,
      item.label,
    );
    assert.equal(cluster.promptPosts.size, 0, `${item.label} cannot submit a paid prompt`);
    assert.equal(cluster.uploads.size, 0, `${item.label} cannot upload branch inputs`);
    assert.equal(cluster.requests.length, 0, `${item.label} fails before worker network preflight`);
  }
});

test('an exclusive run-directory lock prevents concurrent CLI processes from double-submitting', async () => {
  const fixture = await createFixture();
  const cluster = new MockComfyCluster();
  for (let number = 1; number <= 4; number += 1) cluster.pendingHistory.add(`gpu-${number}`);
  const runDirectory = join(fixture.projectRoot, 'workflows/runs/locked');
  let milliseconds = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolvePromise) => { release = resolvePromise; });
  const firstRun = runPetActionBatch({
    ...fixture,
    runDirectory,
    workers: cluster.workers(),
    pollIntervalMs: 1,
    timeoutMs: 2,
    allowBusyWorkers: true,
    now: () => new Date(milliseconds),
    sleep: async () => {
      await gate;
      milliseconds += 10;
    },
  });
  while ([...cluster.promptPosts.values()].reduce((sum, count) => sum + count, 0) < 4) {
    await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
  }

  await assert.rejects(
    runPetActionBatch({
      ...fixture,
      runDirectory,
      workers: cluster.workers(),
      pollIntervalMs: 1,
      timeoutMs: 2,
      allowBusyWorkers: true,
    }),
    /Another batch runner owns/,
  );
  assert.equal([...cluster.promptPosts.values()].reduce((sum, count) => sum + count, 0), 4);
  release();
  await firstRun;
});
