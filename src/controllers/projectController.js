const { Op } = require('sequelize');
const Project = require('../models/project');
const logger = require('../logger');
const Task = require('../models/task'); 

/**
 * Crea un nuevo proyecto con los detalles proporcionados.
 *
 * @async
 * @function createProject
 * @param {Object} req - El objeto de la solicitud.
 * @param {Object} req.body - El cuerpo de la solicitud que contiene los detalles del proyecto.
 * @param {string} req.body.title - El título del proyecto.
 * @param {string} req.body.description - La descripción del proyecto.
 * @param {string} req.body.priority - El nivel de prioridad del proyecto.
 * @param {string} req.body.culmination_date - La fecha esperada de finalización del proyecto.
 * @param {Object} res - El objeto de la respuesta.
 * @returns {Promise<void>} Envía una respuesta JSON con el proyecto creado o un mensaje de error.
 */
async function createProject(req, res) {
    try {
      const { title, description, priority, culmination_date } = req.body;

      // Verificar si el nombre del proyecto ya existe
      const existingProject = await Project.findOne({ where: { title } });
      if (existingProject) {
          return res.status(400).json({ message: 'The project name is already in use, please change it.' });
      }
      
      // Crear el proyecto en la base de datos si pasa la validacion
      const project = await Project.create({title, description, priority, culmination_date });
      logger.info(`Project created: ${project.id}`);
      return res.status(201).json(project);

    } catch (error) {
      logger.error('Error creating project', error);
      res.status(500).json({ message: 'Error creating project' });
    }
}


/**
 * Recupera todos los proyectos de la base de datos y los envía como una respuesta JSON.
 * 
 * @async
 * @function getAllProjects
 * @param {Object} req - El objeto de la solicitud.
 * @param {Object} res - El objeto de la respuesta.
 * @returns {Promise<void>} Envía una respuesta JSON con la lista de proyectos o un mensaje de error.
 */
async function getAllProjects(req, res) {
  try {
    const projects = await Project.findAll();
    res.status(200).json(projects);
  } catch (error) {
    logger.error('Error getting projects', error);
    res.status(500).json({ message: 'Error getting projects' });
  }
}


/**
 * Actualiza un proyecto existente en la base de datos.
 *
 * @async
 * @function updateProject
 * @param {Object} req - Objeto de solicitud de Express.
 * @param {Object} req.params - Parámetros de la solicitud.
 * @param {string} req.params.id - ID del proyecto a actualizar.
 * @param {Object} req.body - Cuerpo de la solicitud con los datos del proyecto.
 * @param {string} req.body.title - Nuevo título del proyecto.
 * @param {string} req.body.description - Nueva descripción del proyecto.
 * @param {string} req.body.priority - Nueva prioridad del proyecto.
 * @param {string} req.body.culmination_date - Nueva fecha de culminación del proyecto.
 * @param {Object} res - Objeto de respuesta de Express.
 * @returns {Promise<void>} Devuelve una respuesta HTTP con el proyecto actualizado o un mensaje de error.
 * @throws {Error} Devuelve un error 404 si el proyecto no se encuentra o un error 500 si ocurre un problema en el servidor.
 */
async function updateProject(req, res) {
  try {
    const { id } = req.params;
    const { title, description, priority, culmination_date } = req.body;

    // Verificar si el proyecto existe     
    const project = await Project.findByPk(id);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    // Verificar si el nuevo título ya está en uso por otro proyecto
    if (title && title !== project.title) {
      const existingProject = await Project.findOne({ 
        where: { 
          title, 
          id: { [Op.ne]: id } 
        } 
      });
      
      if (existingProject) {
        return res.status(400).json({ message: 'The project name is already in use, please choose another.' });
      }
    }
    
    // Actualizar solo los campos proporcionados
    if (title) project.title = title;
    if (description) project.description = description;
    if (priority) project.priority = priority;
    if (culmination_date) project.culmination_date = culmination_date;

    await project.save();
    logger.info(`Project updated: ${project.id}`);
    res.status(200).json(project);
  } catch (error) {
    logger.error(`Error updating project ${error.message}`, error);
    res.status(500).json({ message: 'Error updating project' });
  }
}


/**
 * Elimina un proyecto basado en el ID proporcionado en los parámetros de la solicitud.
 * 
 * @async
 * @function deleteProject
 * @param {Object} req - Objeto de solicitud de Express.
 * @param {Object} req.params - Parámetros de la solicitud.
 * @param {string} req.params.id - ID del proyecto a eliminar.
 * @param {Object} res - Objeto de respuesta de Express.
 * @returns {void} - Envía una respuesta HTTP con el estado correspondiente.
 * 
 * @throws {Error} - Devuelve un error 500 si ocurre un problema al eliminar el proyecto.
 */
async function deleteProject(req, res) {
  try {
    const { id } = req.params;

    // Verificar si el proyecto existe
    const project = await Project.findByPk(id);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }
    // Eliminar el proyecto de la base de datos (se eliminan en cascada las tareas asociadas)
    await project.destroy();
    
    logger.info(`Project deleted: ${project.id}`);
    res.status(204).send();
  } catch (error) {
    logger.error('Error deleting project', error);
    res.status(500).json({ message: 'Error deleting project' });
  }
}

/**
 * Obtiene un proyecto por su ID, incluyendo sus tareas asociadas.
 * 
 * @async
 * @function getProjectById
 * @param {Object} req - Objeto de solicitud de Express.
 * @param {Object} req.params - Parámetros de la solicitud.
 * @param {string} req.params.id - ID del proyecto a recuperar.
 * @param {Object} res - Objeto de respuesta de Express.
 * @returns {Promise<void>} Envía una respuesta JSON con el proyecto encontrado o un mensaje de error.
 * 
 * @throws {Error} - Devuelve un error 404 si el proyecto no se encuentra o un error 500 si ocurre un problema en el servidor.
 */
async function getProjectById(req, res) {
  try {
    const { id } = req.params;

    // Buscar el proyecto por ID e incluir las tareas asociadas
    const project = await Project.findByPk(id, { include: Task });

    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }
    logger.info(`Project retrieved: ${project.id}`);
    res.status(200).json(project);
  } catch (error) {
    logger.error('Error getting project', error);
    res.status(500).json({ message: 'Error getting project' });
  }
}

/**
 * Recupera todos los IDs de los proyectos almacenados en la base de datos.
 * 
 * @async
 * @function getAllProjectIds
 * @param {Object} req - Objeto de solicitud de Express.
 * @param {Object} res - Objeto de respuesta de Express.
 * @returns {Promise<void>} Envía una respuesta JSON con una lista de IDs de proyectos o un mensaje de error.
 * 
 * @throws {Error} - Devuelve un error 500 si ocurre un problema al recuperar los IDs de los proyectos.
 */
async function getAllProjectIds(req, res) {
  try {
    // Obtener todos los proyectos y extraer solo los IDs
    const projects = await Project.findAll({
      attributes: ['id']
    });

    const projectIds = projects.map(project => project.id);
    logger.info('Project IDs retrieved');
    res.status(200).json(projectIds);
  } catch (error) {
    logger.error('Error getting project IDs', error);
    res.status(500).json({ message: 'Error getting project IDs' });
  }
}

module.exports = { createProject, getAllProjects, updateProject, deleteProject, getProjectById, getAllProjectIds };