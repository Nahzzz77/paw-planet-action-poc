import type { PetActionBatch } from './pet-action-branches';

export type PetAvatarStatus =
  | 'submitting'
  | 'queued'
  | 'generating'
  | 'ready_for_review'
  | 'approved'
  | 'rejected'
  | 'failed';

export type ComfyImageReference = {
  filename: string;
  subfolder: string;
  type: string;
};

export type PetGender = 'male' | 'female';

export type PetDetails = {
  ageOrBirthday: string;
  gender: PetGender | null;
};

export function normalizePetDetails(ageOrBirthday: unknown, gender: unknown): PetDetails {
  const normalizedAge = typeof ageOrBirthday === 'string' ? ageOrBirthday.trim() : '';
  if (normalizedAge.length > 24) throw new Error('年龄或生日最多填写 24 个字');
  if (gender !== null && gender !== undefined && gender !== '' && gender !== 'male' && gender !== 'female') {
    throw new Error('宠物性别不正确');
  }
  return {
    ageOrBirthday: normalizedAge,
    gender: gender === 'male' || gender === 'female' ? gender : null,
  };
}

export type PetAvatarJob = {
  id: string;
  promptId: string | null;
  status: PetAvatarStatus;
  petName: string;
  ageOrBirthday: string;
  gender: PetGender | null;
  createdAt: number;
  expiresAt: number;
  profileId?: string;
  masterSha256?: string;
  actionBatch?: PetActionBatch;
  output?: ComfyImageReference;
  previewUrl?: string;
  message?: string;
};

declare global {
  var __pawPlanetPetAvatarJobs: Map<string, PetAvatarJob> | undefined;
  var __pawPlanetPetAvatarRequestKeys: Map<string, string> | undefined;
}

const jobs = globalThis.__pawPlanetPetAvatarJobs ?? new Map<string, PetAvatarJob>();
globalThis.__pawPlanetPetAvatarJobs = jobs;
const requestKeys = globalThis.__pawPlanetPetAvatarRequestKeys ?? new Map<string, string>();
globalThis.__pawPlanetPetAvatarRequestKeys = requestKeys;

export function pruneExpiredJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.expiresAt <= now) {
      jobs.delete(id);
      for (const [key, mappedId] of requestKeys) {
        if (mappedId === id) requestKeys.delete(key);
      }
    }
  }
}

export function saveJob(job: PetAvatarJob) {
  pruneExpiredJobs();
  jobs.set(job.id, job);
  return job;
}

export function getJob(id: string) {
  pruneExpiredJobs();
  return jobs.get(id) ?? null;
}

export function saveRequestKey(key: string, jobId: string) {
  requestKeys.set(key, jobId);
}

export function getJobByRequestKey(key: string) {
  pruneExpiredJobs();
  const jobId = requestKeys.get(key);
  if (!jobId) return null;
  const job = jobs.get(jobId) ?? null;
  if (!job) requestKeys.delete(key);
  return job;
}
