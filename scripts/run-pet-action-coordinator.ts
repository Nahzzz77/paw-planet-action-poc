#!/usr/bin/env node

import { timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PET_ACTION_KEYS, type PetActionKey } from '../lib/pet-action-branches.ts';
import { PetActionCoordinator } from './pet-action-coordinator.ts';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const configuredToken = process.env.PET_ACTION_COORDINATOR_TOKEN?.trim();
if (!configuredToken) throw new Error('PET_ACTION_COORDINATOR_TOKEN is required.');
const token = configuredToken;
const port = Number(process.env.PET_ACTION_COORDINATOR_PORT || 4317);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('PET_ACTION_COORDINATOR_PORT is invalid.');
const host = process.env.PET_ACTION_COORDINATOR_HOST?.trim() || '127.0.0.1';
const dataDirectory = process.env.PET_ACTION_COORDINATOR_DATA_DIR?.trim();
const coordinator = new PetActionCoordinator({
  projectRoot,
  dataDirectory: dataDirectory ? resolve(projectRoot, dataDirectory) : undefined,
});

function authorized(request: IncomingMessage) {
  const value = request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
  const left = Buffer.from(value);
  const right = Buffer.from(token);
  return left.length === right.length && timingSafeEqual(left, right);
}

function json(response: ServerResponse, status: number, value: unknown) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(body.byteLength),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > 64 * 1024) throw new Error('请求内容过大');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

const server = createServer(async (request, response) => {
  try {
    if (!authorized(request)) {
      json(response, 401, { status: 'error', message: '动作调度器密钥不正确' });
      return;
    }
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (request.method === 'POST' && url.pathname === '/v1/action-batches') {
      const body = await readJson(request);
      const snapshot = await coordinator.enqueue({
        avatarJobId: typeof body.avatarJobId === 'string' ? body.avatarJobId : '',
        profileId: typeof body.profileId === 'string' ? body.profileId : '',
        masterSha256: typeof body.masterSha256 === 'string' ? body.masterSha256 : '',
      });
      json(response, snapshot.state === 'complete' ? 200 : 202, snapshot);
      return;
    }
    const match = url.pathname.match(/^\/v1\/action-batches\/([a-z0-9_-]+)(?:\/videos\/(idle|lick|feed|pet))?$/i);
    if (!match) {
      json(response, 404, { status: 'error', message: '接口不存在' });
      return;
    }
    const [, id, action] = match;
    if (request.method !== 'GET') {
      json(response, 405, { status: 'error', message: '请求方法不正确' });
      return;
    }
    if (!action) {
      json(response, 200, await coordinator.get(id));
      return;
    }
    if (!PET_ACTION_KEYS.includes(action as PetActionKey)) {
      json(response, 404, { status: 'error', message: '动作不存在' });
      return;
    }
    const file = await coordinator.videoFile(id, action as PetActionKey);
    const info = await stat(file);
    response.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Content-Length': String(info.size),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    createReadStream(file).pipe(response);
  } catch (error) {
    json(response, 400, {
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

await coordinator.resume();
server.listen(port, host, () => {
  console.log(`Pet action coordinator listening on http://${host}:${port}`);
});
