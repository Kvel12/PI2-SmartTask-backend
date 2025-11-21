const express = require('express');
const {createProject, updateProject, deleteProject, getProjectById, getAllProjects, getAllProjectIds, getProjectMembers, getProjectStatuses} = require('../controllers/projectController');
const { validateProjectCreation, validateProjectUpdate } = require('../middleware/validation');
const auth = require('../middleware/auth');

const router = express.Router();

// Ruta para crear un proyecto (protegida y con validaciones)
router.post('/', auth, validateProjectCreation, createProject);

// Ruta para obtener la lista de todos los IDs de los proyectos (protegida)
router.get('/all-ids', auth, getAllProjectIds);

// Ruta para obtener los estados disponibles de un proyecto (protegida)
router.get('/:id/statuses', auth, getProjectStatuses);

// Ruta para obtener los miembros de un proyecto (protegida)
router.get('/:id/members', auth, getProjectMembers);

// Ruta para actualizar un proyecto (protegida y con validaciones)
router.put('/:id', auth, validateProjectUpdate, updateProject);

// Ruta para eliminar un proyecto (protegida)
router.delete('/:id', auth, deleteProject);

// Ruta para obtener un proyecto por su ID (protegida)
router.get('/:id', auth, getProjectById);

// Ruta para obtener todos los proyectos (protegida)
router.get('/', auth, getAllProjects);

module.exports = router;