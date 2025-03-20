const express = require('express');
const { createTask } = require('../controllers/taskController');
const { validateTask } = require('../middleware/validation');

const router = express.Router();

// Usar el middleware antes de crear una tarea
router.post('/tasks', validateTask, createTask);

module.exports = router;
