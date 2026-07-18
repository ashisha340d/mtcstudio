const express = require('express');
const router  = express.Router();
const { google } = require('googleapis');
const fs   = require('fs');
const path = require('path');
const { dbGet, dbAll, dbRun } = require('../database/db');

const TOKEN_PATH = path.join(__dirname, '..', 'google-tokens.json');
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

router.get('/auth/google', (req, res) => {
  try {
    const url = oauth2Client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES });
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
    send({ type: 'google-auth', ok: true });
  } catch (e) {
    console.error(JSON.stringify({ endpoint: '/oauth2callback', error: e.message }));
    send({ type: 'google-auth', ok: false, error: e.message });
  }
});

// SSE: live import progress, straight into the customers table, then writeback
router.get('/api/sync-contacts', async (req, res) => {
  if (!oauth2Client.credentials?.access_token) {
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
    let connections = [];
    let pageToken;
    do {
      const { data } = await people.people.connections.list({
        resourceName: 'people/me',
        personFields: 'names,phoneNumbers,emailAddresses,birthdays',
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
        return {
          phone,
          name: rawName ? toProperCase(rawName) : null,
          email: p.emailAddresses?.[0]?.value || null,
          birthday
        };
      })
      .filter(c => c.phone && c.name); // phone AND name are must

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
          'UPDATE customers SET name = ?, email = COALESCE(?, email), birthday = COALESCE(?, birthday), notes = ? WHERE phone = ?',
          [c.name, c.email, c.birthday, notes, c.phone]
        );
        updated++;
      } else {
        await dbRun(
          'INSERT INTO customers (phone, name, email, birthday, notes) VALUES (?, ?, ?, ?, ?)',
          [c.phone, c.name, c.email, c.birthday, TAG_IMPORTED]
        );
        imported++;
      }

      processed++;
      send('progress', { processed, total, phone: c.phone });
    }

    // writeback: CRM customers absent from this Google pull, not already exported/imported
    const crmCustomers = await dbAll("SELECT phone, name, notes FROM customers WHERE status = 'active'");
    const missing = crmCustomers.filter(cust =>
      !seenPhones.has(cust.phone) &&
      !hasTag(cust.notes, TAG_IMPORTED) &&
      !hasTag(cust.notes, TAG_EXPORTED)
    );

    let exported = 0;
    send('writeback-start', { total: missing.length });

    for (const cust of missing) {
      try {
        await people.people.createContact({
          requestBody: {
            names: [{ givenName: cust.name }],
            phoneNumbers: [{ value: cust.phone }]
          }
        });
        await dbRun('UPDATE customers SET notes = ? WHERE phone = ?', [appendTag(cust.notes, TAG_EXPORTED), cust.phone]);
        exported++;
      } catch (e) {
        console.error(JSON.stringify({ endpoint: '/api/sync-contacts writeback', phone: cust.phone, error: e.message }));
      }
      send('writeback-progress', { processed: exported, total: missing.length });
    }

    send('done', { total, imported, updated, exported });
    res.end();
  } catch (e) {
    console.error(JSON.stringify({ endpoint: '/api/sync-contacts', error: e.message }));
    send('error', { error: e.message });
    res.end();
  }
});

module.exports = router;
