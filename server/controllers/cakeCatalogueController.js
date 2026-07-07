const svc = require('../services/cakeCatalogueService');
const { syncCakeCatalog } = require('../services/cakeCatalogSyncService');

async function list(req, res, next) {
    try {
        const { search, status } = req.query;
        const [designs, lookups] = await Promise.all([
            svc.getAllDesigns({ search, status }),
            svc.getLookups(),
        ]);
        res.json({ designs, lookups });
    } catch (e) { next(e); }
}

async function show(req, res, next) {
    try {
        const design = await svc.getDesignById(req.params.id);
        if (!design) return res.status(404).json({ error: 'Design not found' });
        res.json({ design });
    } catch (e) { next(e); }
}

async function create(req, res, next) {
    try {
        const id = await svc.createDesign(req.body);
        res.json({ success: true, id, design: await svc.getDesignById(id) });
    } catch (e) { next(e); }
}

async function update(req, res, next) {
    try {
        await svc.updateDesign(req.params.id, req.body);
        res.json({ success: true, design: await svc.getDesignById(req.params.id) });
    } catch (e) { next(e); }
}

async function remove(req, res, next) {
    try {
        await svc.removeDesign(req.params.id);
        res.json({ success: true });
    } catch (e) { next(e); }
}

async function bulkAction(req, res, next) {
    try {
        const { action, ids } = req.body;
        if (!action || !Array.isArray(ids)) return res.status(400).json({ error: 'action and ids required' });
        await svc.bulkAction(action, ids);
        res.json({ success: true });
    } catch (e) { next(e); }
}

async function reorder(req, res, next) {
    try {
        const { order } = req.body;
        if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' });
        await svc.reorder(order);
        res.json({ success: true });
    } catch (e) { next(e); }
}

async function listCollections(req, res, next) {
    try { res.json({ collections: await svc.getCollections() }); } catch (e) { next(e); }
}
async function createCollection(req, res, next) {
    try { res.json({ success: true, id: await svc.createCollection(req.body) }); } catch (e) { next(e); }
}
async function updateCollection(req, res, next) {
    try { await svc.updateCollection(req.params.id, req.body); res.json({ success: true }); } catch (e) { next(e); }
}
async function removeCollection(req, res, next) {
    try { await svc.removeCollection(req.params.id); res.json({ success: true }); } catch (e) { next(e); }
}
async function reorderCollections(req, res, next) {
    try {
        const { order } = req.body;
        if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' });
        await svc.reorderCollections(order);
        res.json({ success: true });
    } catch (e) { next(e); }
}

async function syncNow(req, res) {
    try {
        const result = await syncCakeCatalog();
        res.json({ success: true, ...result });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
}

module.exports = {
    list, show, create, update, remove, bulkAction, reorder,
    listCollections, createCollection, updateCollection, removeCollection, reorderCollections,
    syncNow,
};
