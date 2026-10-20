import test from 'node:test';
import assert from 'node:assert/strict';
import { createFacebook } from '../src/channels/facebook.js';
import { config } from '../src/config.js';
import { Store } from '../src/db.js';

test('Kết nối Facebook: đổi code lấy token dài hạn, đọc danh sách Trang, bật Trang thì đăng ký nhận tin', async () => {
  const old = { ...config.facebook };
  Object.assign(config.facebook, { appId: 'APP', appSecret: 'SEC', pageToken: '' });
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    calls.push({ method: opts.method, path: u.pathname, q: Object.fromEntries(u.searchParams), body: opts.body && JSON.parse(opts.body) });
    let data = {};
    if (u.pathname.endsWith('/oauth/access_token')) data = { access_token: u.searchParams.get('grant_type') ? 'LONG' : 'SHORT' };
    else if (u.pathname.endsWith('/me/accounts')) data = { data: [{ id: 'P1', name: 'EIV for Kids', access_token: 'tokP1', tasks: ['MESSAGING'] }, { id: 'P2', name: 'EIV Education - Đào Tạo Tiếng Anh Cho Doanh Nghiệp', access_token: 'tokP2', tasks: ['MESSAGING'] }] };
    else if (u.pathname.endsWith('/subscribed_apps')) data = { success: true };
    else if (u.pathname.endsWith('/me/messages')) data = { message_id: 'mid' };
    return { ok: true, status: 200, json: async () => data };
  };
  try {
    const store = new Store(':memory:');
    const fb = createFacebook(store);
    assert.equal(fb.enabled(), false);
    const url = new URL(fb.authorizeUrl());
    assert.match(url.searchParams.get('scope'), /pages_messaging/);
    assert.match(url.searchParams.get('redirect_uri'), /\/webhooks\/facebook\/oauth$/);
    await assert.rejects(fb.handleCallback({ code: 'x', state: 'sai' }), /hết hạn|không hợp lệ/);
    const r = await fb.handleCallback({ code: 'CODE', state: url.searchParams.get('state') });
    assert.equal(r.count, 2);
    assert.equal(calls.find((c) => c.path.endsWith('/me/accounts')).q.access_token, 'LONG');
    assert.deepEqual(fb.listPages().map((p) => [p.name, p.enabled]), [['EIV for Kids', false], ['EIV Education - Đào Tạo Tiếng Anh Cho Doanh Nghiệp', false]]);
    assert.ok(!('token' in fb.listPages()[0])); // không lộ token ra dashboard
    assert.equal(fb.isActive('P1'), false);

    await fb.setPageEnabled('P1', true);
    const sub = calls.find((c) => c.path.endsWith('/P1/subscribed_apps'));
    assert.equal(sub.method, 'POST');
    assert.equal(sub.q.access_token, 'tokP1');
    assert.equal(fb.isActive('P1'), true);
    assert.equal(fb.enabled(), true);

    await fb.send('psid1', 'xin chào', { pageId: 'P1' });
    const msg = calls.find((c) => c.path.endsWith('/me/messages'));
    assert.equal(msg.q.access_token, 'tokP1');
    assert.equal(msg.body.recipient.id, 'psid1');

    await fb.setPageEnabled('P1', false);
    assert.equal(calls.filter((c) => c.path.endsWith('/P1/subscribed_apps')).at(-1).method, 'DELETE');
  } finally {
    globalThis.fetch = realFetch;
    Object.assign(config.facebook, old);
  }
});
