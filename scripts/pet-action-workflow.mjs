#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const workflowsDir = join(projectRoot, 'workflows');
const baseUiPath = join(workflowsDir, 'SCAIL-2-Int8-Pet-POC-lick-cn-template-v1.json');
const baseApiPath = join(workflowsDir, 'SCAIL-2-Int8-Pet-POC-lick-cn-template-v1-API.json');
const QUALITY_INFERENCE_STEPS = 6;
const FAST_PREVIEW_INFERENCE_STEPS = 4;

const petVideoPostprocessContract = {
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
};

const generationRetryPolicy = {
  maxAttemptsPerBranch: 2,
};

const commonCatPrefix = '参考图中是同一只需要被动画化的猫。它的可见特征为：{{PET_PROFILE_CN}}。严格保持参考图中的同一身份、物种、年龄感、脸型、口鼻比例、眼睛颜色、耳朵形状、毛发长度、毛量、毛色、可见花纹、颈胸毛、身体比例和三维卡通材质。猫以标准中性坐姿位于暖白色无缝影棚背景中央，双前爪清晰分开并放在地面上，尾巴位于{{TAIL_SAFE_SCREEN_SIDE_CN}}地面。固定镜头、固定构图、固定角色大小、固定背景。';

const actionSpecs = {
  idle: {
    canonicalId: 'idle',
    uiKey: 'idle',
    workerSlot: 'gpu-1',
    templateStem: 'SCAIL-2-Int8-Pet-POC-idle-cn-template-v1',
    workflowId: '841bf45f-1f09-4dbd-8d75-cc6519162db2',
    driver: 'cat-idle-driver-poc-v1.mp4',
    outputStem: 'cat_idle_v1',
    capability: 'poc',
    dispatchAllowed: true,
    reasonCode: 'TAIL_AMPLITUDE_TOO_LARGE',
    fixedReplacements: {},
    prompt: `${commonCatPrefix}\n\n猫始终保持双前爪落地的中性坐姿，自然、快速地眨眼一次，只有尾巴尖发生非常轻微的放松摆动，随后回到与第一帧完全一致的姿势。头部、身体、四肢和尾巴主体保持稳定。不得走动、转身、抬爪、长时间闭眼、低头打瞌睡、改变脸型、改变毛色、出现额外肢体、镜头运动、文字、标志或水印。`,
  },
  lick: {
    canonicalId: 'lick',
    uiKey: 'lick',
    workerSlot: 'gpu-2',
    templateStem: 'SCAIL-2-Int8-Pet-POC-lick-cn-template-v1',
    workflowId: 'bc0308e6-8ee8-4382-9b5e-85fa57980fd9',
    driver: 'cat-lick-paw-driver-poc-v1.mp4',
    outputStem: 'cat_lick_paw_v1',
    capability: 'validated',
    dispatchAllowed: true,
    reasonCode: 'READY',
    fixedReplacements: {
      ACTIVE_FRONT_PAW_CN: '画面左侧的前爪，也就是猫的右前爪',
    },
    prompt: '参考图中的已确认卡通宠物是唯一身份和外观来源。它的可见特征为：{{PET_PROFILE_CN}}。全程保持同一物种、年龄感、脸型、口鼻比例、眼色、耳形、毛长、毛量、毛色、花纹、体型、尾巴和卡通材质。动作从参考图中的中性坐姿开始，最后完整回到同一姿势。固定镜头、固定角色大小、固定背景；只有动作必需部位可以运动。前腿、前爪和尾巴始终保持清楚分离。动作开始时，两只前爪自然、清晰地放在地面上。只有{{ACTIVE_FRONT_PAW_CN}}平稳抬起并靠近嘴部。猫自然伸出舌头，轻柔舔舐这只前爪两到三次，然后完全收回舌头，将同一只前爪平稳放回地面，最终恢复到双前爪落地的初始中性坐姿。尾巴必须始终位于{{TAIL_SAFE_SCREEN_SIDE_CN}}的地面上，全程保持静止，不得抬起、不得靠近嘴部、不得遮挡前爪、不得与前腿或前爪融合。除指定前爪、头部和舌头外，身体其他部分保持稳定。不得出现额外肢体、额外尾巴、尾爪融合、毛发缩短、身份漂移、镜头运动、文字、标志或水印。',
  },
  feed: {
    canonicalId: 'eat',
    uiKey: 'feed',
    workerSlot: 'gpu-3',
    templateStem: 'SCAIL-2-Int8-Pet-POC-feed-cn-template-v1',
    workflowId: '475d30ad-a541-4acf-8038-2bf4c26be73b',
    driver: 'cat-feed-bowl-driver-seedance-v1.mp4',
    outputStem: 'cat_feed_v1',
    capability: 'validated',
    dispatchAllowed: true,
    reasonCode: 'READY',
    replaceMode: true,
    fixedReplacements: {},
    prompt: `${commonCatPrefix}\n\n使用驱动视频中的同一只浅米白色低矮陶瓷猫碗和碗内多粒棕色干猫粮；猫碗、猫粮、暖白色无缝背景和固定镜头属于场景，必须保持驱动中的位置、形状、数量关系与进退场时序，不得生成第二只碗。猫保持坐姿，猫碗从画面正下方平稳进入中央进食区后，猫平稳低头，使鼻口真实进入碗口内侧，在碗内连续做两到三次小幅自然的舔食和咀嚼动作；舌头只能短暂出现在碗内，碗前沿应自然遮挡舌尖。随后猫完全收回舌头、抬头，恢复到双前爪落地的初始中性坐姿；猫碗再沿原路从画面正下方退出，最后一帧不留猫碗或猫粮。尾巴和双前爪不得靠近嘴部，不得遮挡碗，不得与碗、猫粮或舌头融合。不得出现碗外猫粮、额外猫碗、额外肢体、额外尾巴、毛发缩短、身份漂移、镜头运动、文字、标志或水印。`,
  },
  'head-pet': {
    canonicalId: 'head-pet',
    uiKey: 'pet',
    workerSlot: 'gpu-4',
    templateStem: 'SCAIL-2-Int8-Pet-POC-head-pet-cn-template-v2',
    workflowId: 'e23c127c-9920-43e0-9e57-09ff2165484e',
    driver: 'cat-head-pet-driver-poc-v1.mp4',
    outputStem: 'cat_head_pet_v1',
    capability: 'validated',
    dispatchAllowed: true,
    reasonCode: 'READY',
    fixedReplacements: {},
    prompt: `${commonCatPrefix}\n\n猫保持坐姿，轻轻抬起下巴，放松面部并自然闭眼，短暂停留，随后重新睁眼、放低头部并恢复到双前爪落地的初始中性坐姿。视频与网页界面均不得出现人手、手臂、手指、手形图标或“轻点摸头”引导文字。尾巴和四肢保持稳定。不得出现额外肢体、额外尾巴、伸出的舌头、镜头运动、文字、标志或水印。`,
  },
};

const parseJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const clone = (value) => structuredClone(value);

function getUiNode(workflow, id, expectedType) {
  const node = workflow.nodes?.find((candidate) => candidate.id === id);
  if (!node || (expectedType && node.type !== expectedType)) {
    throw new Error(`UI workflow node ${id} is missing or has an unexpected type.`);
  }
  return node;
}

function getApiNode(workflow, id, expectedType) {
  const node = workflow[id];
  if (!node || node.class_type !== expectedType) {
    throw new Error(`API workflow node ${id} is missing or has an unexpected type.`);
  }
  return node;
}

function configureUi(base, spec) {
  const workflow = clone(base);
  workflow.id = spec.workflowId;
  workflow.revision = 0;

  const image = getUiNode(workflow, 30, 'LoadImage');
  image.widgets_values[0] = '__PET_AVATAR_IMAGE__';
  image.widgets_values_named.image = '__PET_AVATAR_IMAGE__';

  const driver = getUiNode(workflow, 155, 'LoadVideo');
  driver.widgets_values[0] = spec.driver;
  driver.widgets_values_named.file = spec.driver;

  for (const nodeId of [213, 262]) {
    const actionNode = getUiNode(workflow, nodeId);
    actionNode.widgets_values[0] = spec.prompt;
    actionNode.widgets_values[2] = spec.replaceMode ?? false;
    actionNode.widgets_values_named.text = spec.prompt;
    actionNode.widgets_values_named.value_2 = spec.replaceMode ?? false;
  }

  const firstOutput = getUiNode(workflow, 202, 'SaveVideo');
  firstOutput.widgets_values[0] = `pet_poc/__PET_ID__/${spec.outputStem}`;
  firstOutput.widgets_values_named.filename_prefix = `pet_poc/__PET_ID__/${spec.outputStem}`;

  const finalOutput = getUiNode(workflow, 271, 'SaveVideo');
  finalOutput.widgets_values[0] = `pet_poc/__PET_ID__/${spec.outputStem}_final`;
  finalOutput.widgets_values_named.filename_prefix = `pet_poc/__PET_ID__/${spec.outputStem}_final`;
  return workflow;
}

function configureApi(base, spec) {
  const workflow = clone(base);
  getApiNode(workflow, '30', 'LoadImage').inputs.image = '__PET_AVATAR_IMAGE__';
  getApiNode(workflow, '155', 'LoadVideo').inputs.file = spec.driver;
  getApiNode(workflow, '202', 'SaveVideo').inputs.filename_prefix = `pet_poc/__PET_ID__/${spec.outputStem}`;
  getApiNode(workflow, '213:3', 'CLIPTextEncode').inputs.text = spec.prompt;
  getApiNode(workflow, '213:203', 'PrimitiveBoolean').inputs.value = spec.replaceMode ?? false;
  return workflow;
}

function assertTemplate(workflow, spec, kind) {
  const serialized = JSON.stringify(workflow);
  const required = ['__PET_AVATAR_IMAGE__', '__PET_ID__', '{{PET_PROFILE_CN}}', '{{TAIL_SAFE_SCREEN_SIDE_CN}}'];
  for (const token of Object.keys(spec.fixedReplacements)) required.push(`{{${token}}}`);
  for (const token of required) {
    if (!serialized.includes(token)) throw new Error(`${kind} template is missing ${token}.`);
  }
  if (!serialized.includes(spec.driver) || !serialized.includes(spec.outputStem)) {
    throw new Error(`${kind} template action binding is incomplete.`);
  }
  for (const otherSpec of Object.values(actionSpecs)) {
    if (otherSpec === spec) continue;
    if (serialized.includes(otherSpec.driver) || serialized.includes(otherSpec.outputStem)) {
      throw new Error(`${kind} template still contains the ${otherSpec.canonicalId} action binding.`);
    }
  }
}

async function writeNewJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  try {
    await access(path, constants.F_OK);
    throw new Error(`Refusing to overwrite existing file: ${path}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}

function validateProfile(profile) {
  for (const field of ['petId', 'avatarFile', 'profileCn', 'tailSafeScreenSideCn']) {
    if (typeof profile[field] !== 'string' || !profile[field].trim()) throw new Error(`Profile field ${field} is required.`);
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(profile.petId)) {
    throw new Error('Profile field petId must be a safe lowercase identifier.');
  }
  if (profile.avatarFile.includes('/') || profile.avatarFile.includes('\\') || profile.avatarFile.includes('..')) {
    throw new Error('Profile field avatarFile must be a plain filename.');
  }
  if (profile.profileCn.length > 1200) throw new Error('Profile field profileCn is too long.');
  if (profile.tailSafeScreenSideCn !== '身体左后侧') {
    throw new Error('Profile field tailSafeScreenSideCn must match the approved driver side: 身体左后侧.');
  }
  return profile;
}

function fillTemplate(workflow, profile, fixedReplacements = {}) {
  const replacements = new Map([
    ['__PET_AVATAR_IMAGE__', profile.avatarFile],
    ['__PET_ID__', profile.petId],
    ['{{PET_PROFILE_CN}}', profile.profileCn],
    ['{{TAIL_SAFE_SCREEN_SIDE_CN}}', profile.tailSafeScreenSideCn],
  ]);
  for (const [token, replacement] of Object.entries(fixedReplacements)) {
    replacements.set(`{{${token}}}`, replacement);
  }
  const replaceString = (value) => {
    let result = value;
    for (const [token, replacement] of replacements) result = result.split(token).join(replacement);
    return result;
  };
  const replaceValue = (value) => {
    if (typeof value === 'string') return replaceString(value);
    if (Array.isArray(value)) return value.map(replaceValue);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceValue(item)]));
    }
    return value;
  };
  const compiled = replaceValue(workflow);
  const serialized = JSON.stringify(compiled);
  if (/{{[^}]+}}|__[A-Z0-9_]+__/.test(serialized)) {
    throw new Error('Compiled workflow still contains unresolved placeholders.');
  }
  return compiled;
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hashFile = async (path) => sha256(await readFile(path));

function deterministicAlternateSeed(baseSeed, petId, uiKey) {
  const digest = createHash('sha256')
    .update(`pet-video-retry-v1\0${petId}\0${uiKey}\0${baseSeed}`)
    .digest('hex');
  const candidate = Number.parseInt(digest.slice(0, 12), 16);
  return candidate === baseSeed ? candidate + 1 : candidate;
}

async function loadCompiledAction(action, profilePath) {
  const spec = actionSpecs[action];
  if (!spec) throw new Error(`Unsupported action: ${action}.`);
  const templatePath = join(workflowsDir, `${spec.templateStem}-API.json`);
  const [template, rawProfile] = await Promise.all([parseJson(templatePath), parseJson(profilePath)]);
  const profile = validateProfile(rawProfile);
  assertTemplate(template, spec, 'API');
  const workflow = fillTemplate(template, profile, spec.fixedReplacements);
  return { workflow, profile, spec, templatePath };
}

async function buildTemplate(action) {
  const spec = actionSpecs[action];
  if (!spec) throw new Error(`Unsupported action: ${action}.`);
  const [baseUi, baseApi] = await Promise.all([parseJson(baseUiPath), parseJson(baseApiPath)]);
  const ui = configureUi(baseUi, spec);
  const api = configureApi(baseApi, spec);
  assertTemplate(ui, spec, 'UI');
  assertTemplate(api, spec, 'API');
  const uiPath = join(workflowsDir, `${spec.templateStem}.json`);
  const apiPath = join(workflowsDir, `${spec.templateStem}-API.json`);
  await writeNewJson(uiPath, ui);
  await writeNewJson(apiPath, api);
  console.log(JSON.stringify({ uiPath, apiPath }, null, 2));
}

async function compileAction(action, profilePath, outputPath) {
  if (!profilePath || !outputPath) {
    throw new Error('Usage: npm run pet:workflow -- compile <idle|lick|feed|head-pet> <profile.json> <output.json>');
  }
  const { workflow } = await loadCompiledAction(action, profilePath);
  await writeNewJson(outputPath, workflow);
  console.log(JSON.stringify({ outputPath }, null, 2));
}

async function compileBatch(profilePath, outputDir, fastPreview = false) {
  if (!profilePath || !outputDir) {
    throw new Error('Usage: npm run pet:workflow -- compile-batch <profile.json> <output-dir> [--fast-preview]');
  }

  const compiledActions = await Promise.all(
    ['idle', 'lick', 'feed', 'head-pet'].map((action) => loadCompiledAction(action, profilePath)),
  );
  const profile = compiledActions[0].profile;
  const profileBytes = await readFile(profilePath);
  const masterCandidate = join(projectRoot, 'public', 'assets', 'generated', profile.avatarFile);
  let masterSha256;
  try {
    masterSha256 = await hashFile(masterCandidate);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`Avatar master file is required before compiling a paid batch: ${masterCandidate}`);
    }
    throw error;
  }
  const branchByUiKey = new Map();
  const inferenceSteps = fastPreview ? FAST_PREVIEW_INFERENCE_STEPS : QUALITY_INFERENCE_STEPS;

  for (const item of compiledActions) {
    getApiNode(item.workflow, '213:168', 'PrimitiveInt').inputs.value = inferenceSteps;
    const outputPath = join(outputDir, `${profile.petId}-${item.spec.outputStem}-API.json`);
    await writeNewJson(outputPath, item.workflow);
    const driverPath = join(workflowsDir, 'drivers', item.spec.driver);
    const sampler = item.workflow['213:19']?.inputs ?? {};
    const baseSeed = sampler.noise_seed;
    if (!Number.isSafeInteger(baseSeed) || baseSeed < 0) {
      throw new Error(`${item.spec.uiKey} workflow SamplerCustom 213:19 requires a non-negative safe noise_seed.`);
    }
    branchByUiKey.set(item.spec.uiKey, {
      action: item.spec.canonicalId,
      uiKey: item.spec.uiKey,
      workerSlot: item.spec.workerSlot,
      compileStatus: 'compiled',
      dispatchAllowed: item.spec.dispatchAllowed,
      readiness: item.spec.capability,
      runState: 'not_started',
      reasonCode: item.spec.reasonCode,
      workflowFile: relative(projectRoot, outputPath),
      workflowSha256: await hashFile(outputPath),
      templateVersion: item.spec.templateStem,
      templateSha256: await hashFile(item.templatePath),
      driverFile: relative(projectRoot, driverPath),
      driverSha256: await hashFile(driverPath),
      modelVersion: item.workflow['213:154']?.inputs?.unet_name ?? null,
      seed: baseSeed,
      retrySeeds: [
        baseSeed,
        deterministicAlternateSeed(baseSeed, profile.petId, item.spec.uiKey),
      ],
      outputSha256: null,
      expectedOutput: {
        nodeId: '202',
        slot: 'videos',
        index: 0,
      },
    });
  }

  const manifest = {
    schemaVersion: 1,
    registryVersion: 'pet-actions-v4',
    mode: 'plan_only',
    billingStarted: false,
    createdAt: new Date().toISOString(),
    petId: profile.petId,
    profileFile: relative(projectRoot, profilePath),
    profileSha256: sha256(profileBytes),
    masterFile: profile.avatarFile,
    masterSha256,
    generationProfile: {
      name: fastPreview ? 'fast-preview-4-step' : 'quality-6-step',
      inferenceSteps,
      experimental: fastPreview,
    },
    generationRetryPolicy,
    ...petVideoPostprocessContract,
    branches: [
      branchByUiKey.get('idle'),
      branchByUiKey.get('lick'),
      branchByUiKey.get('feed'),
      branchByUiKey.get('pet'),
    ],
  };
  if (manifest.branches.some((item) => !item) || new Set(manifest.branches.map((item) => item.uiKey)).size !== 4) {
    throw new Error('Batch manifest must contain four unique action branches.');
  }
  const manifestPath = join(outputDir, `${profile.petId}-pet-actions-batch-v1.json`);
  await writeNewJson(manifestPath, manifest);
  console.log(JSON.stringify({ manifestPath, mode: manifest.mode, billingStarted: false }, null, 2));
}

const [command, action, ...rest] = process.argv.slice(2);
if (command === 'build-template') {
  await buildTemplate(action);
} else if (command === 'compile') {
  await compileAction(action, rest[0], rest[1]);
} else if (command === 'compile-batch') {
  const option = rest[1];
  if (option !== undefined && option !== '--fast-preview') {
    throw new Error(`Unknown compile-batch option: ${option}`);
  }
  await compileBatch(action, rest[0], option === '--fast-preview');
} else {
  throw new Error('Usage: npm run pet:workflow -- <build-template|compile|compile-batch> ...');
}
