const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/categoriesController');
const menuVersion = require('../pos/menuVersion');

// Category writes also invalidate the POS menu cache
router.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  res.on('finish', () => { if (res.statusCode < 400) menuVersion.bump(); });
  next();
});

router.get('/', ctrl.list);
router.post('/reorder', ctrl.reorder);
router.post('/', ctrl.create);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
