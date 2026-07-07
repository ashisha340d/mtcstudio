const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/cakeCatalogueController');

router.get('/', ctrl.list);
router.post('/bulk-action', ctrl.bulkAction);
router.post('/reorder', ctrl.reorder);
router.post('/sync', ctrl.syncNow);

router.get('/collections', ctrl.listCollections);
router.post('/collections', ctrl.createCollection);
router.post('/collections/reorder', ctrl.reorderCollections);
router.put('/collections/:id', ctrl.updateCollection);
router.delete('/collections/:id', ctrl.removeCollection);

router.post('/', ctrl.create);
router.get('/:id', ctrl.show);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
