const express = require('express');
const { createTask } = require('../controllers/taskController');
const { validateTask, validateTaskCreation } = require('../middleware/validation');
const auth = require('../middleware/auth');


const router = express.Router();

// Usar el middleware antes de crear una tarea
router.post('/tasks', validateTaskCreation, createTask);
// Usar el middleware antes de actualizar una tarea
router.put('/tasks/:id', validateTaskUpdate, updateTask);

// ✅ Proteger rutas de tareas
router.post('/tasks', auth, createTask);
router.put('/tasks/:id', auth, updateTask);
router.delete('/tasks/:id', auth, deleteTask);

module.exports = router;
