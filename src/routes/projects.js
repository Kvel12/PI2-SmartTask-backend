const express = require('express');
const { createProject, updateProject, deleteProject } = require('../controllers/projectController');
const { validateProjectCreation, validateProjectUpdate } = require('../middleware/validation');

const router = express.Router();

// Ruta para crear un proyecto con validaciones
router.post('/projects', validateProjectCreation, createProject);

// Ruta para actualizar un proyecto con validaciones
router.post('/projects', validateProjectUpdate, updateProject);

// Ruta para eliminar un proyecto (y sus tareas en cascada)
router.delete('/projects/:id', deleteProject);

module.exports = router;
