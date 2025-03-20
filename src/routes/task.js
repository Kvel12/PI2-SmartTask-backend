const express = require('express');
const { createTask } = require('../controllers/taskController');
const { validateTask, validateTaskCreation } = require('../middleware/validation');

const router = express.Router();

// Usar el middleware antes de crear una tarea
router.post('/tasks', validateTaskCreation, createTask);
// Usar el middleware antes de actualizar una tarea
router.put('/tasks/:id', validateTaskUpdate, updateTask);

module.exports = router;
