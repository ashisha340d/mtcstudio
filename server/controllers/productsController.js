const svc = require('../services/productsService');
const { syncMenuCatalog } = require('../services/menuCatalogSyncService');

async function list(req, res, next) {
    try {
        const q = req.query;
        const data = await svc.getAll({
            search: (q.search || '').trim(),
            category: q.category || '',
            statusFilter: q.status || '',
            featuredFilter: q.featured !== undefined ? q.featured : '',
            station: q.station || '',
            liveShop: q.live_shop || '',
            storefrontCat: q.storefront_cat || '',
            qrActive: q.qr_active || '',
            blankMax: q.blank_max || '',
            badge: q.badge || '',
            fastFilter: q.fast || '',
            sort: q.sort || 'id',
            sortDir: q.sort_dir || 'desc',
            page: q.page || 1
        });
        res.json(data);
    } catch (e) { next(e); }
}

async function show(req, res, next) {
    try {
        const data = await svc.getById(req.params.id);
        if (!data) return res.status(404).json({ error: 'Not found' });
        res.json(data);
    } catch (e) { next(e); }
}

async function create(req, res, next) {
    try {
        const ids = await svc.create(req.body);
        res.json({ success: true, product: { id: ids.product_id } });
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

async function addVariant(req, res, next) {
    try {
        const variantId = await svc.addVariant(req.params.id, req.body);
        res.json({ success: true, variant_id: variantId });
    } catch (e) { next(e); }
}

async function updateVariant(req, res, next) {
    try {
        await svc.updateVariant(req.params.id, req.params.vid, req.body);
        res.json({ success: true });
    } catch (e) { next(e); }
}

async function removeVariant(req, res, next) {
    try {
        await svc.removeVariant(req.params.id, req.params.vid);
        res.json({ success: true });
    } catch (e) { next(e); }
}

async function setImage(req, res, next) {
    try {
        const result = await svc.setImage(req.params.id, req.body.media_id);
        res.json({ success: true, ...result });
    } catch (e) { next(e); }
}

async function bulkSave(req, res, next) {
    try {
        const errors = await svc.bulkSave(req.body.rows || []);
        res.json(errors.length ? { error: errors.join('; ') } : { success: true });
    } catch (e) { next(e); }
}

async function bulkAction(req, res, next) {
    try {
        await svc.bulkAction(req.body);
        res.json({ success: true });
    } catch (e) { next(e); }
}

async function reorder(req, res, next) {
    try {
        await svc.reorder(req.body.order || []);
        res.json({ success: true });
    } catch (e) { next(e); }
}

async function exportCsv(req, res, next) {
    try {
        const csv = await svc.exportCsv();
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="products.csv"');
        res.send(csv);
    } catch (e) { next(e); }
}

async function getTemplate(req, res, next) {
    try {
        const { stringify } = require('csv-stringify/sync');
        const headers = ['category_id', 'product_name', 'slug', 'short_description', 'description', 'featured', 'product_status', 'product_sort_order',
            'pos_price', 'prep_time_minutes', 'is_fast_moving', 'pos_station_id', 'pos_active', 'badge', 'storefront_category', 'customer_visible', 'customer_max_qty',
            'variant_name', 'sku', 'selling_price', 'cost_price', 'stock', 'reorder_level', 'unit', 'barcode', 'variant_status'];
        const example = ['1', 'Black Forest Cake', 'black-forest-cake', 'A rich layered cake', 'Full description here', '0', 'active', '0',
            '350', '20', '0', '', '1', '', '', '0', '',
            '500g', 'BFC-500G', '350', '200', '10', '3', 'pcs', '', 'active'];
        const csv = stringify([headers, example]);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="products_template.csv"');
        res.send(csv);
    } catch (e) { next(e); }
}

async function importCsv(req, res, next) {
    try {
        if (!req.body || !Buffer.isBuffer(req.body))
            return res.status(400).json({ error: 'Send CSV as raw body with Content-Type: text/csv' });
        const result = await svc.importCsv(req.body);
        res.json({ success: true, ...result });
    } catch (e) { next(e); }
}

async function syncCatalog(req, res, next) {
    try {
        const result = await syncMenuCatalog();
        res.json({ success: true, ...result });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
}

module.exports = { list, show, create, update, remove, addVariant, updateVariant, removeVariant, setImage, bulkSave, bulkAction, reorder, exportCsv, getTemplate, importCsv, syncCatalog };
