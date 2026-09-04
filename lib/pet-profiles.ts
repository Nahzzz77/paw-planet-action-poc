export type SavedPetProfile = {
  jobId: string;
  petName: string;
  kind: 'cat' | 'dog';
  ageOrBirthday: string;
  gender: 'male' | 'female' | null;
};

export type SavedPetStore = {
  version: 3;
  activeJobId: string;
  pets: SavedPetProfile[];
};

export const emptyPetStore = (): SavedPetStore => ({ version: 3, activeJobId: '', pets: [] });

const normalizeProfile = (value: unknown): SavedPetProfile | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.jobId !== 'string' || !record.jobId) return null;
  return {
    jobId: record.jobId,
    petName: typeof record.petName === 'string' && record.petName.trim()
      ? record.petName.trim().slice(0, 12)
      : '我的宝贝',
    kind: record.kind === 'dog' ? 'dog' : 'cat',
    ageOrBirthday: typeof record.ageOrBirthday === 'string'
      ? record.ageOrBirthday.slice(0, 24)
      : '',
    gender: record.gender === 'male' || record.gender === 'female' ? record.gender : null,
  };
};

export function parsePetStore(raw: string | null): SavedPetStore {
  if (!raw) return emptyPetStore();
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const pets = Array.isArray(parsed.pets)
      ? parsed.pets.map(normalizeProfile).filter((pet): pet is SavedPetProfile => Boolean(pet))
      : [normalizeProfile(parsed)].filter((pet): pet is SavedPetProfile => Boolean(pet));
    const uniquePets = [...new Map(pets.map((pet) => [pet.jobId, pet])).values()];
    const requestedActive = typeof parsed.activeJobId === 'string' ? parsed.activeJobId : '';
    return {
      version: 3,
      activeJobId: uniquePets.some((pet) => pet.jobId === requestedActive)
        ? requestedActive
        : uniquePets[0]?.jobId ?? '',
      pets: uniquePets,
    };
  } catch {
    return emptyPetStore();
  }
}

export function upsertPet(store: SavedPetStore, pet: SavedPetProfile): SavedPetStore {
  return {
    version: 3,
    activeJobId: pet.jobId,
    pets: [...store.pets.filter((item) => item.jobId !== pet.jobId), pet],
  };
}

export function selectPet(store: SavedPetStore, jobId: string): SavedPetStore {
  return store.pets.some((pet) => pet.jobId === jobId)
    ? { ...store, activeJobId: jobId }
    : store;
}

export function removePet(store: SavedPetStore, jobId: string): SavedPetStore {
  const pets = store.pets.filter((pet) => pet.jobId !== jobId);
  return {
    version: 3,
    activeJobId: store.activeJobId === jobId ? pets[0]?.jobId ?? '' : store.activeJobId,
    pets,
  };
}
