const svc = require('../services/blogsService');

async function list(req, res, next) {
    try {
        const blogs = await svc.getAll({ search: req.query.search || '' });
        res.json({ blogs, topics: svc.TOPICS });
    } catch (e) { next(e); }
}

async function show(req, res, next) {
    try {
        const blog = await svc.getById(req.params.id);
        if (!blog) return res.status(404).json({ error: 'Blog not found' });
        res.json({ blog, topics: svc.TOPICS });
    } catch (e) { next(e); }
}

async function preview(req, res, next) {
    try {
        const data = await svc.getPreview(req.params.id);
        if (!data) return res.status(404).json({ error: 'Blog not found' });
        res.json(data);
    } catch (e) { next(e); }
}

async function create(req, res, next) {
    try {
        const id = await svc.create(req.body, req.files);
        res.json({ success: true, id });
    } catch (e) { next(e); }
}

async function update(req, res, next) {
    try {
        await svc.update(req.params.id, req.body, req.files);
        res.json({ success: true });
    } catch (e) { next(e); }
}

async function remove(req, res, next) {
    try {
        await svc.remove(req.params.id);
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

module.exports = { list, show, preview, create, update, remove, bulkAction, reorder };
