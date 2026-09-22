const express = require('express');
const { authenticate } = require('../middleware/auth');
const { getResourceAvailability } = require('../controllers/resourceController');

const router = express.Router();

router.use(authenticate);

router.get('/availability', getResourceAvailability);

module.exports = router;