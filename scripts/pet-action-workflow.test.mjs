import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const compiler = join(projectRoot, 'scripts', 'pet-action-workflow.mjs');

const validProfile = {
  petId: 'special_char_cat',
  avatarFile: 'pet-avatar-orange-longhair-motion-safe-v3.png',
  profileCn: '长毛“猫” "quote" \\ path\n第二行',
  tailSafeScreenSideCn: '身体左后侧',
};

async function runCompiler(args) {
  return execFileAsync(process.execPath, [compiler, ...args], { cwd: projectRoot });
}

test('compile-batch writes four versioned workflows and all four are dispatchable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pet-action-workflow-'));
  const profilePath = join(root, 'profile.json');
  const outputDir = join(root, 'batch');
  await writeFile(profilePath, JSON.stringify(validProfile));

  await runCompiler(['compile-batch', profilePath, outputDir]);
  const manifest = JSON.parse(await readFile(
    join(outputDir, 'special_char_cat-pet-actions-batch-v1.json'),
    'utf8',
  ));

  assert.equal(manifest.mode, 'plan_only');
  assert.equal(manifest.registryVersion, 'pet-actions-v4');
  assert.equal(manifest.billingStarted, false);
  assert.deepEqual(manifest.generationProfile, {
    name: 'quality-6-step',
    inferenceSteps: 6,
    experimental: false,
  });
  assert.deepEqual(manifest.generationRetryPolicy, { maxAttemptsPerBranch: 2 });
  assert.equal(manifest.postprocessPolicyVersion, 'pet-video-v2');
  assert.deepEqual(manifest.outputContract, {
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
  });
  assert.deepEqual(manifest.seamPolicy, {
    canonical: 'master',
    anchorHoldFrames: 2,
    bridgeFrames: 10,
    handoffOutFrame: 150,
  });
  assert.equal(manifest.qaPolicyVersion, 'pet-video-qa-v2');
  assert.match(manifest.masterSha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.branches.length, 4);
  assert.equal(new Set(manifest.branches.map((branch) => branch.uiKey)).size, 4);

  const feed = manifest.branches.find((branch) => branch.uiKey === 'feed');
  const pet = manifest.branches.find((branch) => branch.uiKey === 'pet');
  assert.equal(typeof feed.workflowFile, 'string');
  assert.equal(feed.dispatchAllowed, true);
  assert.equal(feed.readiness, 'validated');
  assert.equal(feed.reasonCode, 'READY');
  assert.equal(pet.dispatchAllowed, true);
  assert.equal(pet.readiness, 'validated');
  assert.equal(pet.reasonCode, 'READY');

  const outputStemByUiKey = {
    idle: 'cat_idle_v1',
    lick: 'cat_lick_paw_v1',
    feed: 'cat_feed_v1',
    pet: 'cat_head_pet_v1',
  };
  for (const uiKey of ['idle', 'lick', 'feed', 'pet']) {
    const branch = manifest.branches.find((item) => item.uiKey === uiKey);
    const workflowPath = join(outputDir, `special_char_cat-${outputStemByUiKey[uiKey]}-API.json`);
    const workflow = JSON.parse(await readFile(workflowPath, 'utf8'));
    assert.equal(Object.keys(workflow).length, 48);
    assert.equal(/{{[^}]+}}|__[A-Z0-9_]+__/.test(JSON.stringify(workflow)), false);
    assert.equal(workflow['213:168'].inputs.value, 6);
    assert.equal(typeof branch.templateSha256, 'string');
    assert.equal(typeof branch.driverSha256, 'string');
    assert.deepEqual(branch.expectedOutput, {
      nodeId: '202',
      slot: 'videos',
      index: 0,
    });
    const expectedAlternateSeed = Number.parseInt(
      createHash('sha256')
        .update(`pet-video-retry-v1\0${validProfile.petId}\0${uiKey}\0${112358}`)
        .digest('hex')
        .slice(0, 12),
      16,
    );
    assert.deepEqual(branch.retrySeeds, [112358, expectedAlternateSeed]);
    assert.notEqual(branch.retrySeeds[0], branch.retrySeeds[1]);
    assert.equal(
      branch.workflowSha256,
      createHash('sha256').update(await readFile(workflowPath)).digest('hex'),
    );
    assert.match(workflow['213:3'].inputs.text, /"quote" \\ path\n第二行/);
    assert.equal(workflow['213:203'].inputs.value, uiKey === 'feed');
  }
  const lick = JSON.parse(await readFile(join(outputDir, 'special_char_cat-cat_lick_paw_v1-API.json'), 'utf8'));
  assert.match(lick['213:3'].inputs.text, /画面左侧的前爪，也就是猫的右前爪/);
});

test('fast-preview batch is isolated and lowers only the distilled inference step count', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pet-action-fast-preview-'));
  const profilePath = join(root, 'profile.json');
  const outputDir = join(root, 'batch');
  await writeFile(profilePath, JSON.stringify(validProfile));

  await runCompiler(['compile-batch', profilePath, outputDir, '--fast-preview']);
  const manifest = JSON.parse(await readFile(
    join(outputDir, 'special_char_cat-pet-actions-batch-v1.json'),
    'utf8',
  ));
  assert.deepEqual(manifest.generationProfile, {
    name: 'fast-preview-4-step',
    inferenceSteps: 4,
    experimental: true,
  });
  for (const stem of ['cat_idle_v1', 'cat_lick_paw_v1', 'cat_feed_v1', 'cat_head_pet_v1']) {
    const workflow = JSON.parse(await readFile(join(outputDir, `special_char_cat-${stem}-API.json`), 'utf8'));
    assert.equal(workflow['213:168'].inputs.value, 4);
    assert.equal(workflow['213:165'].inputs.value, 40);
  }
});

test('compiler rejects a tail side that does not match the approved drivers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pet-action-tail-'));
  const profilePath = join(root, 'profile.json');
  await writeFile(profilePath, JSON.stringify({ ...validProfile, tailSafeScreenSideCn: '身体右后侧' }));

  await assert.rejects(
    runCompiler(['compile', 'idle', profilePath, join(root, 'idle.json')]),
    /approved driver side/,
  );
});

test('compiler rejects avatar path traversal and unknown actions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pet-action-path-'));
  const profilePath = join(root, 'profile.json');
  await writeFile(profilePath, JSON.stringify({ ...validProfile, avatarFile: '../wrong.png' }));

  await assert.rejects(
    runCompiler(['compile', 'idle', profilePath, join(root, 'idle.json')]),
    /plain filename/,
  );
  await assert.rejects(
    runCompiler(['compile', 'dance', profilePath, join(root, 'dance.json')]),
    /Unsupported action/,
  );
});

test('compile-batch requires the immutable avatar master before producing a dispatch manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pet-action-master-'));
  const profilePath = join(root, 'profile.json');
  await writeFile(profilePath, JSON.stringify({ ...validProfile, avatarFile: 'missing-master.png' }));

  await assert.rejects(
    runCompiler(['compile-batch', profilePath, join(root, 'batch')]),
    /Avatar master file is required before compiling a paid batch/,
  );
});
