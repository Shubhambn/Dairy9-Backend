const router = require('express').Router();
const customerController = require('../controllers/customer.controller');
const auth = require('../middlewares/auth');

// All routes are protected
router.use(auth);

router.post('/profile', customerController.createUpdateProfile);
router.get('/profile', customerController.getProfile);
router.post('/orders', customerController.addOrder);
router.get('/orders', customerController.getOrderHistory);

module.exports = router;