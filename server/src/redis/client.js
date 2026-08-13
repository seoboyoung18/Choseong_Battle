/**
 * Redis 연결.
 *
 * 주의 — 로컬 개발은 Windows 포터블 빌드(5.0.14)이고 운영은 Linux Redis 7.x다.
 * 5.0에 없는 명령(GETDEL·SINTERCARD·EXPIRETIME 등)을 쓰면 로컬에서만 깨지므로
 * SET NX EX · ZADD · ZPOPMIN · Hash · TTL · pub/sub 범위 안에서만 쓴다.
 *
 * 연결은 import 시점이 아니라 처음 필요할 때 연다. 모듈을 불러오는 것만으로
 * 소켓이 열리면 Redis를 쓰지 않는 테스트까지 프로세스가 종료되지 않는다.
 */

import Redis from 'ioredis';

import { config } from '../config.js';

/**
 * 새 연결을 만든다. pub/sub은 구독 전용 연결이 따로 필요하므로 팩토리로 둔다.
 * @param {string} [role] 로그 식별용 이름
 * @returns {import('ioredis').Redis}
 */
export function createRedis(role = 'main') {
  const client = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    maxRetriesPerRequest: 3,
  });

  client.on('error', (err) => {
    console.error(`[redis:${role}] ${err.message}`);
  });

  return client;
}

/** @type {import('ioredis').Redis | null} */
let shared = null;

/**
 * 애플리케이션 공용 연결. 처음 호출할 때 열린다.
 * @returns {import('ioredis').Redis}
 */
export function getRedis() {
  shared ??= createRedis('main');
  return shared;
}

/** 공용 연결을 닫는다 (graceful shutdown). */
export async function closeRedis() {
  if (!shared) return;
  await shared.quit();
  shared = null;
}
