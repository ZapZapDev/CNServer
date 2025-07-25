const express = require('express');
const historyController = require('../controllers/historyController');

const router = express.Router();

router.get('/history', historyController.getHistory);

module.exports = router;