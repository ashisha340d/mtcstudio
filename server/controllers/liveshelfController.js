const svc = require('../services/liveshelfService');

async function list(req, res, next) {
    try {
        const data = await svc.getAll({ search: req.query.search || '', category: req.query.category || '' });
        res.json(data);
    } catch (e) { next(e); }
}

async function publicList(req, res, next) {
    try {
        const items = await svc.getPublic({ category: req.query.category || '' });
        res.json(items);
    } catch (e) { next(e); }
}

async function show(req, res, next) {
    try {
        const item = await svc.getById(req.params.id);
        if (!item) return res.status(404).json({ error: 'Not found' });
        res.json(item);
    } catch (e) { next(e); }
}

async function create(req, res, next) {
    try {
        const id = await svc.create(req.body);
        res.json({ success: true, id });
    } catch (e) { next(e); }
}

async function update(req, res, next) {
    try {
        await svc.update(req.params.id, req.body);
        res.json({ success: true });
    } catch (e) { next(e); }
}

async function remove(req, res, next) {
    try {
        await svc.remove(req.params.id);
        res.json({ success: true });
    } catch (e) { next(e); }
}

module.exports = { list, publicList, show, create, update, remove };
