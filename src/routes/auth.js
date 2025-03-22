const express = require('express');
const { login } = require('../controllers/authController');

const router = express.Router();

// Ruta para iniciar sesión y obtener token
router.post('/login', login);

module.exports = router;
