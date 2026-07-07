const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/generateBlogController');

router.get('/stats', ctrl.stats);
router.post('/generate', ctrl.generate);

module.exports = router;
