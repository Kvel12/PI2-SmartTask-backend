const express = require('express');
const { createProject, updateProject } = require('../controllers/projectController');
const { validateProjectCreation, validateProjectUpdate } = require('../middleware/validation');

const router = express.Router();

// Ruta para crear un proyecto con validaciones
router.post('/projects', validateProjectCreation, createProject);

// Ruta para actualizar un proyecto con validaciones
router.post('/projects', validateProjectUpdate, updateProject);

module.exports = router;
