const express = require('express');
const { createTask, getAllTasks, getTasksByProject, getTaskById, updateTask, deleteTask } = require('../controllers/taskController');
const { validateTaskUpdate, validateTaskCreation, validateTaskFilters } = require('../middleware/validation');
const auth = require('../middleware/auth');

const router = express.Router();

// Obtener todas las tareas
router.get('/', auth, validateTaskFilters, getAllTasks);

// Obtener una tarea específica por ID
router.get('/:id', auth, getTaskById);

// Obtener todas las tareas de un proyecto específico
router.get('/project/:projectId', auth, getTasksByProject);

// Crear una nueva tarea
router.post('/', auth, validateTaskCreation, createTask);

// Actualizar una tarea existente
router.put('/:id', auth, validateTaskUpdate, updateTask);

// Eliminar una tarea
router.delete('/:id', auth, deleteTask);

module.exports = router;