import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizePetDetails } from './pet-avatar-jobs.ts';
import { parsePetStore, removePet, selectPet, upsertPet } from './pet-profiles.ts';

test('keeps optional pet details small and explicit', () => {
  assert.deepEqual(normalizePetDetails(' 3岁 ', 'female'), {
    ageOrBirthday: '3岁',
    gender: 'female',
  });
  assert.deepEqual(normalizePetDetails('', ''), {
    ageOrBirthday: '',
    gender: null,
  });
  assert.throws(() => normalizePetDetails('1', 'unknown'), /性别/);
  assert.throws(() => normalizePetDetails('x'.repeat(25), null), /24/);
});

test('migrates one pet and keeps multiple selectable pet profiles', () => {
  const migrated = parsePetStore(JSON.stringify({
    version: 2,
    jobId: 'gray-job',
    petName: '小灰',
    ageOrBirthday: '5岁',
    gender: 'male',
  }));
  assert.equal(migrated.pets.length, 1);
  assert.equal(migrated.activeJobId, 'gray-job');

  const withOrange = upsertPet(migrated, {
    jobId: 'orange-job',
    petName: '小橘',
    kind: 'cat',
    ageOrBirthday: '',
    gender: null,
  });
  assert.deepEqual(withOrange.pets.map((pet) => pet.petName), ['小灰', '小橘']);
  assert.equal(withOrange.activeJobId, 'orange-job');
  assert.equal(selectPet(withOrange, 'gray-job').activeJobId, 'gray-job');
  assert.equal(removePet(withOrange, 'orange-job').activeJobId, 'gray-job');
});
