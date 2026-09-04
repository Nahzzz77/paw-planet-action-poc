import workflowTemplate from '@/workflows/Pet-Avatar-Master-Qwen2511-Int8-API.json';
import type { ComfyApiWorkflow } from './types';

const STYLE_NODE = '41';
const USER_PHOTO_NODE = '196';
const OUTPUT_NODE = '195';
const SAMPLER_NODE = '170:169';
const FAST_MODE_NODE = '170:168';

function requireNode(workflow: ComfyApiWorkflow, id: string, classType: string) {
  const node = workflow[id];
  if (!node || node.class_type !== classType) {
    throw new Error(`工作流节点 ${id} 已变化，请重新导出 API 工作流`);
  }
  return node;
}

function randomSeed() {
  const values = crypto.getRandomValues(new Uint32Array(2));
  return values[0] * 2_097_152 + (values[1] >>> 11);
}

export function createPetAvatarWorkflow(jobId: string, styleImage: string, uploadedImage: string) {
  const workflow = structuredClone(workflowTemplate) as ComfyApiWorkflow;
  const style = requireNode(workflow, STYLE_NODE, 'LoadImage');
  const userPhoto = requireNode(workflow, USER_PHOTO_NODE, 'LoadImage');
  const output = requireNode(workflow, OUTPUT_NODE, 'SaveImageAdvanced');
  const sampler = requireNode(workflow, SAMPLER_NODE, 'KSampler');
  const fastMode = requireNode(workflow, FAST_MODE_NODE, 'PrimitiveBoolean');

  if (style._meta?.title !== '2 · Style-only cartoon rendering reference') {
    throw new Error('固定风格节点标题已变化，请重新核对工作流');
  }
  if (userPhoto._meta?.title !== '1 · User pet identity and anatomy source') {
    throw new Error('用户照片节点标题已变化，请重新核对工作流');
  }
  if (fastMode.inputs.value !== true) {
    throw new Error('快速预览节点未启用，拒绝把 40 步工作流放进同步请求');
  }

  style.inputs.image = styleImage;
  userPhoto.inputs.image = uploadedImage;
  sampler.inputs.seed = randomSeed();
  output.inputs.filename_prefix = `pet_avatar/jobs/${jobId}/master`;
  return workflow;
}
