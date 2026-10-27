import { afterEach, describe, expect, it } from 'vitest';
import { once } from 'node:events';
import { app } from '../src/app.js';

let server;

afterEach(() => {
  if (server) {
    server.close();
    server = null;
  }
});

async function start() {
  server = app.listen(0);
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

describe('health and errors', () => {
  it('returns service status', async () => {
    const base = await start();
    const response = await fetch(`${base}/health`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.service).toBe('meditrust-api');
    expect(body.db).toBe('disconnected');
    expect(typeof body.uptime).toBe('number');
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const base = await start();
    const response = await fetch(`${base}/nope`);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Not found');
  });

  it('validates search input before touching the database', async () => {
    const base = await start();
    const response = await fetch(`${base}/api/search?q=`);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid search query');
    expect(Array.isArray(body.details)).toBe(true);
  });

  it('validates drug ids', async () => {
    const base = await start();
    const response = await fetch(`${base}/api/drugs/not-an-id/equivalents`);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid drug id');
  });

  it('rejects unconfirmed substitution audits', async () => {
    const base = await start();
    const response = await fetch(`${base}/api/audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromProduct: '64b000000000000000000001',
        toProduct: '64b000000000000000000002',
        confirmed: false,
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid audit payload');
  });

  it('serves the narrow therapeutic index config', async () => {
    const base = await start();
    const response = await fetch(`${base}/api/config/narrow-therapeutic-index`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(body.salts)).toBe(true);
    expect(body.salts).toContain('Warfarin');
  });
});
