const svc = require('../services/dashboardService');

async function stats(req, res, next) {
    try {
        const data = await svc.getStats();
        res.json(data);
    } catch (e) { next(e); }
}

module.exports = { stats };
