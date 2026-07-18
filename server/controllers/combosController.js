const svc = require('../services/combosService');

async function list(req, res, next) {
  try { res.json(await svc.getAll({ search: req.query.search || '' })); }
  catch (e) { next(e); }
}

async function getOne(req, res, next) {
  try {
    const combo = await svc.getOne(req.params.id);
    if (!combo) return res.status(404).json({ error: 'Not found' });
    res.json(combo);
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  try { res.json({ success: true, combo: await svc.create(req.body) }); }
  catch (e) { next(e); }
}

async function update(req, res, next) {
  try { res.json({ success: true, combo: await svc.update(req.params.id, req.body) }); }
  catch (e) { next(e); }
}

async function remove(req, res, next) {
  try { await svc.remove(req.params.id); res.json({ success: true }); }
  catch (e) { next(e); }
}

module.exports = { list, getOne, create, update, remove };
