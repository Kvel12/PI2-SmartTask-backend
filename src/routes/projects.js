const express = require('express');
const { createProject } = require('../controllers/projectController');
const { validateProject } = require('../middleware/validation');

const router = express.Router();

//Usar el middleware antes de llamar a createProject
router.post('/projects', validateProject, createProject);

module.exports = router;
