import assert from 'node:assert/strict';

const port = process.env.Z12_TEST_PORT || '3102';
if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw Error('Z12_TEST_PORT_INVALID');
const expected = process.env.Z12_EXPECT_READY;
if (!['0', '1'].includes(expected)) throw Error('Z12_EXPECT_READY_REQUIRED');
const base = `http://127.0.0.1:${port}`;
const check = async (path, status, body) => {
  const response = await fetch(base + path, {signal: AbortSignal.timeout(5000)});
  assert.equal(response.status, status);
  assert.match(response.headers.get('cache-control') || '', /\bno-store\b/i);
  assert.deepEqual(await response.json(), {status: body});
};
await check('/api/health/live', 200, 'live');
await check('/api/health/ready', expected === '1' ? 200 : 503, expected === '1' ? 'ready' : 'unavailable');
console.log('Z12: salud HTTP y ausencia de caché: OK');
