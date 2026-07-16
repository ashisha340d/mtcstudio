const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/productsController');
const menuVersion = require('../pos/menuVersion');

// Product writes (incl. images/variants) invalidate the POS menu cache
router.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  res.on('finish', () => { if (res.statusCode < 400) menuVersion.bump(); });
  next();
});

router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.get('/export', ctrl.exportCsv);
router.get('/template', ctrl.getTemplate);
router.post('/import', express.raw({ type: 'text/csv', limit: '10mb' }), ctrl.importCsv);
router.post('/bulk-save', ctrl.bulkSave);
router.post('/bulk-action', ctrl.bulkAction);
router.post('/reorder', ctrl.reorder);
router.post('/sync-catalog', ctrl.syncCatalog);
router.get('/:id', ctrl.show);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);
router.post('/:id/variants', ctrl.addVariant);
router.put('/:id/variants/:vid', ctrl.updateVariant);
router.delete('/:id/variants/:vid', ctrl.removeVariant);
router.post('/:id/set-image', ctrl.setImage);
module.exports = router;
