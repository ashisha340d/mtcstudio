const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/combosController');
const menuVersion = require('../pos/menuVersion');

// Combo writes also invalidate the POS menu cache (same as categories/products)
router.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  res.on('finish', () => { if (res.statusCode < 400) menuVersion.bump(); });
  next();
});

router.get('/', ctrl.list);
router.get('/:id', ctrl.getOne);
router.post('/', ctrl.create);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
