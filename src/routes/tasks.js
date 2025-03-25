const express = require('express');
const { createTask, updateTask, deleteTask } = require('../controllers/taskController');
const { validateTaskUpdate, validateTaskCreation } = require('../middleware/validation');
const auth = require('../middleware/auth');

const router = express.Router();

// Combinar middleware de autenticación y validación en una sola ruta
router.post('/', auth, validateTaskCreation, createTask);
router.put('/:id', auth, validateTaskUpdate, updateTask);
router.delete('/:id', auth, deleteTask);

module.exports = router;