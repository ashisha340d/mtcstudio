const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/mediaController');
const { upload } = require('../middleware/upload');
const { syncMedia } = require('../services/mediaSyncService');

router.get('/', ctrl.list);
router.get('/list', ctrl.apiList);
router.post('/upload', upload.array('images', 20), ctrl.upload);
router.post('/bulk-delete', ctrl.bulkDelete);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

router.post('/sync', async (req, res) => {
    try {
        const result = await syncMedia();
        res.json({ success: true, ...result });
    } catch (err) {
        console.error('[Media Sync Route]', err);
        res.status(500).json({ success: false, error: err.message, synced: 0, skipped: 0, failed: 0, total: 0 });
    }
});

module.exports = router;
