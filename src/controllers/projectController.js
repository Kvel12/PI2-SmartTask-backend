const Project = require('../models/project');



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
      const project = await Project.create({ title, description, priority, culmination_date });
      res.status(201).json(project);
    } catch (error) {
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
    const project = await Project.findByPk(id);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }
    project.title = title;
    project.description = description;
    project.priority = priority;
    project.culmination_date = culmination_date;
    await project.save();
    res.status(200).json(project);
  } catch (error) {
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
    const project = await Project.findByPk(id);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }
    await project.destroy();
    logger.info(`Project deleted: ${project.id}`);
    res.status(204).send();
  } catch (error) {
    logger.error('Error deleting project', error);
    res.status(500).json({ message: 'Error deleting project' });
  }
}

module.exports = { createProject, getAllProjects, updateProject, deleteProject };