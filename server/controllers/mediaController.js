const svc = require('../services/mediaService');
const { syncMedia } = require('../services/mediaSyncService');

// Fire-and-forget export — never blocks or fails the CRUD response.
function triggerExport() {
    syncMedia().catch(e => console.warn('[Media] auto-export failed:', e.message));
}

async function list(req, res, next) {
    try {
        const media = await svc.getAll({ search: req.query.search || '', unassigned: req.query.unassigned === '1', section: req.query.section || '' });
        res.json(media);
    } catch (e) { next(e); }
}

async function apiList(req, res, next) {
    try {
        const media = await svc.getList({ search: req.query.search || '', unassigned: req.query.unassigned === '1', section: req.query.section || '', page: req.query.page, perPage: req.query.perPage });
        res.json(media);
    } catch (e) { next(e); }
}

async function upload(req, res, next) {
    try {
        if (!req.files || !req.files.length) return res.status(400).json({ error: 'No files uploaded' });
        const results = await Promise.all(req.files.map(f => svc.saveFileEntry(f)));
        const inserted = results.filter(r => r && r.id);
        res.json({ success: true, inserted, errors: [] });
        triggerExport();
    } catch (e) { next(e); }
}

async function update(req, res, next) {
    try {
        await svc.update(req.params.id, req.body);
        res.json({ success: true });
        triggerExport();
    } catch (e) { next(e); }
}

async function remove(req, res, next) {
    try {
        await svc.remove(req.params.id);
        res.json({ success: true });
        triggerExport();
    } catch (e) { next(e); }
}

async function bulkDelete(req, res, next) {
    try {
        const ids = req.body.ids;
        if (!Array.isArray(ids) || !ids.length) return res.json({ success: true, deleted: 0 });
        const deleted = await svc.bulkDelete(ids);
        res.json({ success: true, deleted });
        triggerExport();
    } catch (e) { next(e); }
}

module.exports = { list, apiList, upload, update, remove, bulkDelete };
