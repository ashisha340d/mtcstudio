const express = require('express');
const router  = express.Router();
const { google } = require('googleapis');
const fs   = require('fs');
const path = require('path');
const { dbGet, dbAll, dbRun } = require('../database/db');

const TOKEN_PATH = path.join(__dirname, '..', 'google-tokens.json');
const ACCOUNT_PATH = path.join(__dirname, '..', 'google-account.json');
const TAG_IMPORTED = 'Imported from Google Contacts';
const TAG_EXPORTED = 'Exported to Google Contacts';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

if (fs.existsSync(TOKEN_PATH)) {
  try {
    oauth2Client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')));
  } catch (e) {
    console.error(JSON.stringify({ endpoint: 'google-token-load', error: e.message }));
  }
}

// Persist tokens whenever the library silently refreshes the access token. A
// refresh response omits the refresh_token, so keep the stored one.
oauth2Client.on('tokens', (tokens) => {
  try {
    const prev = fs.existsSync(TOKEN_PATH) ? JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')) : {};
    const merged = { ...prev, ...tokens };
    if (!merged.refresh_token && prev.refresh_token) merged.refresh_token = prev.refresh_token;
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(merged, null, 2), { mode: 0o600 });
    oauth2Client.setCredentials(merged);
  } catch (e) {
    console.error(JSON.stringify({ endpoint: 'google-token-refresh', error: e.message }));
  }
});

// Connected == we hold a refresh_token (or a live access_token). With a
// refresh_token present the library auto-refreshes on the next API call, so no
// popup is needed until the user revokes or switches accounts.
function isConnected() {
  const c = oauth2Client.credentials;
  return !!(c && (c.refresh_token || c.access_token));
}

function readAccount() {
  try { return fs.existsSync(ACCOUNT_PATH) ? JSON.parse(fs.readFileSync(ACCOUNT_PATH, 'utf8')) : null; } catch { return null; }
}

// contacts (read+write) needed for the writeback step, not just contacts.readonly
const SCOPES = [
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/userinfo.profile'
];

function normalizePhone(raw) {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('977') && d.length > 10) d = d.slice(3);
  if (d.startsWith('0') && d.length > 10) d = d.slice(1);
  return d.length >= 7 ? d : null;
}

function toProperCase(str) {
  return str.toLowerCase().replace(/\b\p{L}/gu, ch => ch.toUpperCase());
}

function hasTag(notes, tag) {
  return (notes || '').toLowerCase().includes(tag.toLowerCase());
}

function appendTag(notes, tag) {
  if (hasTag(notes, tag)) return notes || '';
  return notes ? `${notes} | ${tag}` : tag;
}

// "YYYY-MM-DD" -> Google's date object shape.
function toGoogleDate(str) {
  if (!str) return null;
  const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

// Map of Google contactGroup resourceName -> user-visible label name, limited
// to user-created labels (Google's own system groups like "myContacts" are
// skipped so they don't pollute the tag list).
async function fetchGroupsMap(people) {
  const map = {};
  try {
    let pageToken;
    do {
      const { data } = await people.contactGroups.list({ pageSize: 200, pageToken });
      for (const g of data.contactGroups || []) {
        if (g.groupType === 'USER_CONTACT_GROUP') map[g.resourceName] = g.name;
      }
      pageToken = data.nextPageToken;
    } while (pageToken);
  } catch (e) {
    console.error(JSON.stringify({ endpoint: 'fetchGroupsMap', error: e.message }));
  }
  return map;
}

// Ensure a 'google'-sourced tag exists, returning its id. Cached per-request.
async function ensureGoogleTag(name, cache) {
  const key = name.trim();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);
  let row = await dbGet('SELECT id FROM crm_tags WHERE name=?', [key]);
  if (!row) {
    const r = await dbRun('INSERT INTO crm_tags (name,color,source) VALUES (?,?,?)', [key, '#4285f4', 'google']);
    row = { id: r.lastID ?? r.insertId };
  }
  cache.set(key, row.id);
  return row.id;
}

// User-created Google labels: name -> resourceName map + set of valid group
// resourceNames (used to ignore Google's system groups on writeback).
async function fetchGroups(people) {
  const byName = new Map();
  const userResources = new Set();
  let pageToken;
  do {
    const { data } = await people.contactGroups.list({ pageSize: 200, pageToken });
    for (const g of data.contactGroups || []) {
      if (g.groupType === 'USER_CONTACT_GROUP') { byName.set(g.name, g.resourceName); userResources.add(g.resourceName); }
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return { byName, userResources };
}

// Get (or create) a Google label by name, returning its resourceName. Cached.
async function ensureGoogleGroup(people, name, groupByName) {
  const key = (name || '').trim();
  if (!key) return null;
  if (groupByName.has(key)) return groupByName.get(key);
  const { data } = await people.contactGroups.create({ requestBody: { contactGroup: { name: key } } });
  groupByName.set(key, data.resourceName);
  return data.resourceName;
}

// Reconcile a contact's Google label memberships to match its CRM tag set:
// add labels the CRM has, drop user labels the CRM no longer has.
async function syncMemberships(people, personResourceName, currentMemberships, tagNames, groupByName, userResources) {
  const desired = new Set();
  for (const name of tagNames) {
    const gr = await ensureGoogleGroup(people, name, groupByName);
    if (gr) desired.add(gr);
  }
  const current = new Set(
    (currentMemberships || [])
      .map(m => m.contactGroupMembership?.contactGroupResourceName)
      .filter(r => r && userResources.has(r))
  );
  for (const gr of [...desired].filter(r => !current.has(r))) {
    await people.contactGroups.members.modify({ resourceName: gr, requestBody: { resourceNamesToAdd: [personResourceName] } });
  }
  for (const gr of [...current].filter(r => !desired.has(r))) {
    await people.contactGroups.members.modify({ resourceName: gr, requestBody: { resourceNamesToRemove: [personResourceName] } });
  }
}

// Reconcile the auto system tag "MTC Customers" from order history.
async function reconcileMtcTag() {
  const tag = await dbGet("SELECT id FROM crm_tags WHERE name='MTC Customers'");
  if (!tag) return;
  await dbRun(
    `INSERT IGNORE INTO customer_tags (customer_phone, tag_id)
     SELECT DISTINCT o.customer_phone, ?
     FROM pos_orders o JOIN customers c ON c.phone = o.customer_phone
     WHERE o.customer_phone IS NOT NULL AND o.customer_phone <> ''`, [tag.id]);
}

// One-way pull FROM Google into the CRM. Inserts new contacts, fills gaps on
// existing ones (CRM stays source of truth for name), and imports each
// contact's Google labels as tags. Returns totals + the phones it saw.
async function importFromGoogle(people, send) {
  const groupsMap = await fetchGroupsMap(people);
  const tagCache = new Map();

  let connections = [];
  let pageToken;
  do {
    const { data } = await people.people.connections.list({
      resourceName: 'people/me',
      personFields: 'names,phoneNumbers,emailAddresses,birthdays,organizations,events,memberships',
      pageSize: 1000,
      pageToken
    });
    connections = connections.concat(data.connections || []);
    pageToken = data.nextPageToken;
  } while (pageToken);

  const contacts = connections
    .map(p => {
      const phone = p.phoneNumbers?.map(n => normalizePhone(n.value)).find(Boolean) || null;
      const rawName = p.names?.[0]?.displayName?.trim() || null;
      const bday = p.birthdays?.find(b => b.date)?.date;
      const birthday = bday ? `${bday.year || 1900}-${String(bday.month).padStart(2, '0')}-${String(bday.day).padStart(2, '0')}` : null;
      const anniv = p.events?.find(e => e.type === 'anniversary')?.date;
      const anniversary = anniv ? `${anniv.year || 1900}-${String(anniv.month).padStart(2, '0')}-${String(anniv.day).padStart(2, '0')}` : null;
      const labels = (p.memberships || [])
        .map(m => groupsMap[m.contactGroupMembership?.contactGroupResourceName])
        .filter(Boolean);
      return {
        phone,
        resourceName: p.resourceName,
        name: rawName ? toProperCase(rawName) : null,
        company: p.organizations?.[0]?.name || null,
        jobTitle: p.organizations?.[0]?.title || null,
        email: p.emailAddresses?.[0]?.value || null,
        birthday, anniversary, labels
      };
    })
    .filter(c => c.phone && c.name);

  const total = contacts.length;
  send('start', { total });

  const seenPhones = new Set();
  let imported = 0, updated = 0, processed = 0;

  for (const c of contacts) {
    seenPhones.add(c.phone);
    const row = await dbGet('SELECT phone, name, notes FROM customers WHERE phone = ?', [c.phone]);

    if (row) {
      const notes = appendTag(row.notes, TAG_IMPORTED);
      await dbRun(
        `UPDATE customers SET
           email = COALESCE(email, ?), birthday = COALESCE(birthday, ?),
           company_name = COALESCE(company_name, ?), job_title = COALESCE(job_title, ?),
           anniversary = COALESCE(anniversary, ?), google_resource_name = ?, notes = ?
         WHERE phone = ?`,
        [c.email, c.birthday, c.company, c.jobTitle, c.anniversary, c.resourceName, notes, c.phone]
      );
      updated++;
    } else {
      await dbRun(
        `INSERT INTO customers (phone, name, company_name, job_title, email, birthday, anniversary, google_resource_name, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [c.phone, c.name, c.company, c.jobTitle, c.email, c.birthday, c.anniversary, c.resourceName, TAG_IMPORTED]
      );
      imported++;
    }

    // Import Google labels as tags on this contact.
    for (const label of c.labels) {
      const tagId = await ensureGoogleTag(label, tagCache);
      if (tagId) await dbRun('INSERT IGNORE INTO customer_tags (customer_phone, tag_id) VALUES (?,?)', [c.phone, tagId]);
    }

    processed++;
    send('progress', { processed, total, phone: c.phone });
  }

  return { total, imported, updated, seenPhones };
}

router.get('/auth/google', (req, res) => {
  try {
    const url = oauth2Client.generateAuthUrl({ access_type: 'offline', prompt: 'consent select_account', scope: SCOPES });
    res.redirect(url);
  } catch (e) {
    console.error(JSON.stringify({ endpoint: '/auth/google', error: e.message }));
    res.status(500).json({ error: 'Failed to generate auth URL', details: e.message });
  }
});

// popup flow: this page posts a message to the opener window and closes itself
router.get('/oauth2callback', async (req, res) => {
  const { code, error } = req.query;

  const send = (payload) => res.send(`<!DOCTYPE html><html><body><script>
    window.opener && window.opener.postMessage(${JSON.stringify(payload)}, window.location.origin);
    window.close();
  </script></body></html>`);

  if (error) {
    console.error(JSON.stringify({ endpoint: '/oauth2callback', error }));
    return send({ type: 'google-auth', ok: false, error });
  }
  if (!code) return send({ type: 'google-auth', ok: false, error: 'missing_code' });

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2), { mode: 0o600 });
    // Cache which Google account this is, so the CRM can show it.
    try {
      const people = google.people({ version: 'v1', auth: oauth2Client });
      const { data } = await people.people.get({ resourceName: 'people/me', personFields: 'names,emailAddresses' });
      fs.writeFileSync(ACCOUNT_PATH, JSON.stringify({
        email: data.emailAddresses?.[0]?.value || null,
        name: data.names?.[0]?.displayName || null
      }, null, 2));
    } catch (e) {
      console.error(JSON.stringify({ endpoint: '/oauth2callback account', error: e.message }));
    }
    send({ type: 'google-auth', ok: true });
  } catch (e) {
    console.error(JSON.stringify({ endpoint: '/oauth2callback', error: e.message }));
    send({ type: 'google-auth', ok: false, error: e.message });
  }
});

// SSE: one-way IMPORT from Google — pulls contacts + labels in, no writeback.
router.get('/api/import-contacts', async (req, res) => {
  if (!isConnected()) {
    return res.status(401).json({ error: 'Not authenticated. Visit /auth/google first.' });
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  try {
    const people = google.people({ version: 'v1', auth: oauth2Client });
    const { total, imported, updated } = await importFromGoogle(people, send);
    await reconcileMtcTag();
    send('done', { total, imported, updated, exported: 0, pushed: 0 });
    res.end();
  } catch (e) {
    console.error(JSON.stringify({ endpoint: '/api/import-contacts', error: e.message }));
    send('error', { error: e.message });
    res.end();
  }
});

// SSE: two-way SYNC — imports, then pushes CRM (source of truth) up to Google:
// creates contacts that were never linked, and updates ones already linked.
router.get('/api/sync-contacts', async (req, res) => {
  if (!isConnected()) {
    return res.status(401).json({ error: 'Not authenticated. Visit /auth/google first.' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    const people = google.people({ version: 'v1', auth: oauth2Client });
    const { total, imported, updated, seenPhones } = await importFromGoogle(people, send);

    // writeback part 1: CRM customers never linked to a Google contact at all —
    // create them fresh on the Google side.
    const crmCustomers = await dbAll(
      "SELECT phone, name, company_name, job_title, email, birthday, anniversary, notes, google_resource_name FROM customers WHERE status = 'active'");
    const missing = crmCustomers.filter(cust => !cust.google_resource_name && !seenPhones.has(cust.phone));

    let exported = 0;
    send('writeback-start', { total: missing.length });

    for (const cust of missing) {
      try {
        const body = { names: [{ givenName: cust.name }], phoneNumbers: [{ value: cust.phone }] };
        if (cust.email) body.emailAddresses = [{ value: cust.email }];
        if (cust.birthday) body.birthdays = [{ date: toGoogleDate(cust.birthday) }];
        if (cust.company_name || cust.job_title) body.organizations = [{ name: cust.company_name || undefined, title: cust.job_title || undefined }];
        const { data: created } = await people.people.createContact({ requestBody: body });
        await dbRun('UPDATE customers SET notes = ?, google_resource_name = ? WHERE phone = ?',
          [appendTag(cust.notes, TAG_EXPORTED), created.resourceName, cust.phone]);
        exported++;
      } catch (e) {
        console.error(JSON.stringify({ endpoint: '/api/sync-contacts writeback-create', phone: cust.phone, error: e.message }));
      }
      send('writeback-progress', { processed: exported, total: missing.length });
    }

    // writeback part 2: CRM customers already linked to a Google contact — push
    // the CRM's current values over, since the CRM is the source of truth for
    // day-to-day edits (name fixes, new company/anniversary, corrected phone).
    const linked = crmCustomers.filter(cust => cust.google_resource_name);
    let pushed = 0;
    send('writeback-update-start', { total: linked.length });

    for (const cust of linked) {
      try {
        const { data: current } = await people.people.get({
          resourceName: cust.google_resource_name, personFields: 'names,phoneNumbers,emailAddresses,birthdays,organizations'
        });
        const body = { etag: current.etag, names: [{ givenName: cust.name }], phoneNumbers: [{ value: cust.phone }] };
        if (cust.email) body.emailAddresses = [{ value: cust.email }];
        if (cust.birthday) body.birthdays = [{ date: toGoogleDate(cust.birthday) }];
        if (cust.company_name || cust.job_title) body.organizations = [{ name: cust.company_name || undefined, title: cust.job_title || undefined }];
        await people.people.updateContact({
          resourceName: cust.google_resource_name,
          updatePersonFields: 'names,phoneNumbers,emailAddresses,birthdays,organizations',
          requestBody: body
        });
        pushed++;
      } catch (e) {
        console.error(JSON.stringify({ endpoint: '/api/sync-contacts writeback-update', phone: cust.phone, error: e.message }));
      }
      send('writeback-update-progress', { processed: pushed, total: linked.length });
    }

    await reconcileMtcTag();
    send('done', { total, imported, updated, exported, pushed });
    res.end();
  } catch (e) {
    console.error(JSON.stringify({ endpoint: '/api/sync-contacts', error: e.message }));
    send('error', { error: e.message });
    res.end();
  }
});

// SSE (POST): export ONLY the selected CRM contacts up to Google. Creates ones
// never linked, updates ones already linked. Called from the CRM bulk action so
// slow Google writes stay scoped to the user's selection, not the whole table.
router.post('/api/export-contacts', async (req, res) => {
  if (!isConnected()) {
    return res.status(401).json({ error: 'Not authenticated. Visit /auth/google first.' });
  }
  const phones = Array.isArray(req.body?.phones) ? req.body.phones : [];

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    const people = google.people({ version: 'v1', auth: oauth2Client });
    const { byName: groupByName, userResources } = await fetchGroups(people);
    const total = phones.length;
    send('start', { total });

    let created = 0, updated = 0, deleted = 0, processed = 0;

    for (const phone of phones) {
      const cust = await dbGet(
        'SELECT phone, name, status, company_name, job_title, email, birthday, anniversary, notes, google_resource_name FROM customers WHERE phone = ?',
        [phone]);
      if (cust) {
        try {
          // CRM "Move to Bin" -> trash the linked Google contact (Google keeps it
          // in Trash ~30 days), then unlink so a later export won't retouch it.
          if (cust.status === 'deleted') {
            if (cust.google_resource_name) {
              await people.people.deleteContact({ resourceName: cust.google_resource_name });
              await dbRun('UPDATE customers SET google_resource_name = NULL WHERE phone = ?', [cust.phone]);
              deleted++;
            }
            processed++;
            send('progress', { processed, total });
            continue;
          }

          const tagNames = (await dbAll(
            'SELECT t.name FROM customer_tags ct JOIN crm_tags t ON t.id = ct.tag_id WHERE ct.customer_phone = ?',
            [cust.phone])).map(r => r.name).filter(Boolean);

          let resourceName = cust.google_resource_name;
          let currentMemberships = [];

          if (resourceName) {
            const { data: current } = await people.people.get({
              resourceName, personFields: 'names,phoneNumbers,emailAddresses,birthdays,organizations,memberships'
            });
            const body = { etag: current.etag, names: [{ givenName: cust.name }], phoneNumbers: [{ value: cust.phone }] };
            if (cust.email) body.emailAddresses = [{ value: cust.email }];
            if (cust.birthday) body.birthdays = [{ date: toGoogleDate(cust.birthday) }];
            if (cust.company_name || cust.job_title) body.organizations = [{ name: cust.company_name || undefined, title: cust.job_title || undefined }];
            await people.people.updateContact({
              resourceName,
              updatePersonFields: 'names,phoneNumbers,emailAddresses,birthdays,organizations',
              requestBody: body
            });
            currentMemberships = current.memberships || [];
            updated++;
          } else {
            const body = { names: [{ givenName: cust.name }], phoneNumbers: [{ value: cust.phone }] };
            if (cust.email) body.emailAddresses = [{ value: cust.email }];
            if (cust.birthday) body.birthdays = [{ date: toGoogleDate(cust.birthday) }];
            if (cust.company_name || cust.job_title) body.organizations = [{ name: cust.company_name || undefined, title: cust.job_title || undefined }];
            const { data: cr } = await people.people.createContact({ requestBody: body });
            resourceName = cr.resourceName;
            await dbRun('UPDATE customers SET notes = ?, google_resource_name = ? WHERE phone = ?',
              [appendTag(cust.notes, TAG_EXPORTED), resourceName, cust.phone]);
            created++;
          }

          await syncMemberships(people, resourceName, currentMemberships, tagNames, groupByName, userResources);
        } catch (e) {
          console.error(JSON.stringify({ endpoint: '/api/export-contacts', phone, error: e.message }));
        }
      }
      processed++;
      send('progress', { processed, total });
    }

    send('done', { total, created, updated, deleted });
    res.end();
  } catch (e) {
    console.error(JSON.stringify({ endpoint: '/api/export-contacts', error: e.message }));
    send('error', { error: e.message });
    res.end();
  }
});

// Connection status for the CRM's "Login to Google" panel.
router.get('/api/google-status', (req, res) => {
  res.json({ connected: isConnected(), account: readAccount() });
});

// Disconnect / switch account: revoke Google's side, wipe local tokens.
router.post('/api/google-disconnect', async (req, res) => {
  try {
    if (isConnected()) await oauth2Client.revokeCredentials().catch(() => {});
  } catch (e) {
    console.error(JSON.stringify({ endpoint: '/api/google-disconnect', error: e.message }));
  }
  try { if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH); } catch {}
  try { if (fs.existsSync(ACCOUNT_PATH)) fs.unlinkSync(ACCOUNT_PATH); } catch {}
  oauth2Client.setCredentials({});
  res.json({ ok: true });
});

module.exports = router;
