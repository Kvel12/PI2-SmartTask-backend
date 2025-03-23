const express = require('express');
const { createProject, updateProject, deleteProject, getProjectById, getAllProjectIds } = require('../controllers/projectController');
const { validateProjectCreation, validateProjectUpdate } = require('../middleware/validation');
const auth = require('../middleware/auth');


const router = express.Router();

// Ruta para crear un proyecto con validaciones
router.post('/projects', validateProjectCreation, createProject);

// Ruta para actualizar un proyecto con validaciones
router.post('/projects', validateProjectUpdate, updateProject);

// Ruta para eliminar un proyecto (y sus tareas en cascada)
router.delete('/projects/:id', deleteProject);

// Proteger ruta de eliminación de proyectos
router.delete('/projects/:id', auth, deleteProject);

// Ruta para obtener un proyecto por su ID, incluyendo sus tareas asociadas  
router.get('/:id', getProjectById);

// Ruta para obtener la lista de todos los IDs de los proyectos  
router.get('/all-ids', getAllProjectIds);

module.exports = router;
