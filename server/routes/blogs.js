const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/blogsController');
const { upload } = require('../middleware/upload');

const blogUpload = upload.fields([
    { name: 'featured_image_file', maxCount: 1 },
    { name: 'author_image_file', maxCount: 1 }
]);

router.get('/', ctrl.list);
router.post('/bulk-action', ctrl.bulkAction);
router.post('/reorder', ctrl.reorder);
router.post('/', blogUpload, ctrl.create);
router.get('/:id', ctrl.show);
router.put('/:id', blogUpload, ctrl.update);
router.delete('/:id', ctrl.remove);
router.get('/:id/preview', ctrl.preview);

module.exports = router;
