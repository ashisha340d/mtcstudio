const svc = require('../services/categoriesService');

async function list(req, res, next) {
    try {
        const categories = await svc.getAll({ search: req.query.search || '', sort: req.query.sort || 'sort_order' });
        res.json(categories);
    } catch (e) { next(e); }
}

async function create(req, res, next) {
    try {
        const category = await svc.create(req.body);
        res.json({ success: true, category });
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

async function reorder(req, res, next) {
    try {
        await svc.reorder(req.body.order);
        res.json({ success: true });
    } catch (e) { next(e); }
}

module.exports = { list, create, update, remove, reorder };
