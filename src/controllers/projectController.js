const { Op } = require('sequelize');
const Project = require('../models/project');
const logger = require('../logger');
const Task = require('../models/task');

/**
 * Helper function to normalize dates to YYYY-MM-DD format
 * @param {string|Date} dateValue - Date value to normalize
 * @returns {string|null} Normalized date string or null
 */
function normalizeDateForResponse(dateValue) {
  if (!dateValue) return null;

  try {
    const date = new Date(dateValue);
    if (isNaN(date.getTime())) return null;

    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  } catch (error) {
    logger.error(`Error normalizing date: ${error.message}`);
    return null;
  }
}

/**
 * Crea un nuevo proyecto con los detalles proporcionados.
 */
async function createProject(req, res) {
    try {
      const {
        title,
        description,
        priority,
        culmination_date,
        kanban_template,
        kanban_columns
      } = req.body;

      const existingProject = await Project.findOne({ where: { title } });
      if (existingProject) {
          return res.status(400).json({ message: 'The project name is already in use, please change it.' });
      }

      // Validar kanban_columns si se envía
      if (kanban_columns) {
        if (!Array.isArray(kanban_columns) || kanban_columns.length === 0) {
          return res.status(400).json({
            message: 'kanban_columns must be a non-empty array'
          });
        }
      }

      const project = await Project.create({
        title,
        description,
        priority,
        culmination_date,
        kanban_template: kanban_template || 'default',
        kanban_columns: kanban_columns || undefined // usa default del modelo
      });
      logger.info(`Project created: ${project.id} with template: ${project.kanban_template}`);

      // ✅ NORMALIZAR fechas antes de devolver
      const projectResponse = project.toJSON();
      projectResponse.culmination_date = normalizeDateForResponse(project.culmination_date);
      projectResponse.creation_date = normalizeDateForResponse(project.creation_date);

      return res.status(201).json(projectResponse);

    } catch (error) {
      logger.error('Error creating project', error);

      // Manejar errores de validación de Sequelize
      if (error.name === 'SequelizeValidationError') {
        return res.status(400).json({
          message: 'Validation error',
          errors: error.errors.map(e => e.message)
        });
      }

      res.status(500).json({ message: 'Error creating project' });
    }
}

/**
 * Recupera todos los proyectos de la base de datos.
 */
async function getAllProjects(req, res) {
  try {
    const projects = await Project.findAll();

    // ✅ NORMALIZAR fechas para todos los proyectos
    const projectsResponse = projects.map(project => {
      const projectData = project.toJSON();
      projectData.culmination_date = normalizeDateForResponse(project.culmination_date);
      projectData.creation_date = normalizeDateForResponse(project.creation_date);
      return projectData;
    });

    res.status(200).json(projectsResponse);
  } catch (error) {
    logger.error('Error getting projects', error);
    res.status(500).json({ message: 'Error getting projects' });
  }
}

/**
 * Actualiza un proyecto existente en la base de datos.
 */
async function updateProject(req, res) {
  try {
    const { id } = req.params;
    const {
      title,
      description,
      priority,
      culmination_date,
      kanban_template,
      kanban_columns
    } = req.body;

    const project = await Project.findByPk(id);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

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

    // Validar si se actualizan columnas - verificar tareas
    if (kanban_columns && Array.isArray(kanban_columns)) {
      const tasks = await Task.findAll({ where: { projectId: id } });
      const newColumnIds = kanban_columns.map(col => col.id);
      const invalidTasks = tasks.filter(task => !newColumnIds.includes(task.status));

      if (invalidTasks.length > 0) {
        logger.warn(`Warning: ${invalidTasks.length} tasks have invalid status for new columns`);
        return res.status(400).json({
          message: `Cannot update columns: ${invalidTasks.length} tasks have invalid status`,
          invalidTasks: invalidTasks.map(t => ({ id: t.id, status: t.status }))
        });
      }
    }

    // ✅ CORREGIDO: Usar !== undefined para permitir valores vacíos
    if (title !== undefined) project.title = title;
    if (description !== undefined) project.description = description;
    if (priority !== undefined) project.priority = priority;
    if (culmination_date !== undefined) project.culmination_date = culmination_date;
    if (kanban_template !== undefined) project.kanban_template = kanban_template;
    if (kanban_columns !== undefined) project.kanban_columns = kanban_columns;

    await project.save();
    logger.info(`Project updated: ${project.id}`);

    // ✅ NORMALIZAR fechas antes de devolver
    const projectResponse = project.toJSON();
    projectResponse.culmination_date = normalizeDateForResponse(project.culmination_date);
    projectResponse.creation_date = normalizeDateForResponse(project.creation_date);

    res.status(200).json(projectResponse);
  } catch (error) {
    logger.error(`Error updating project ${error.message}`, error);

    if (error.name === 'SequelizeValidationError') {
      return res.status(400).json({
        message: 'Validation error',
        errors: error.errors.map(e => e.message)
      });
    }

    res.status(500).json({ message: 'Error updating project' });
  }
}

/**
 * Elimina un proyecto basado en el ID proporcionado.
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

/**
 * Obtiene un proyecto por su ID, incluyendo sus tareas asociadas.
 */
async function getProjectById(req, res) {
  try {
    const { id } = req.params;

    const project = await Project.findByPk(id, { include: Task });

    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    logger.info(`Project retrieved: ${project.id}`);

    // ✅ NORMALIZAR fechas antes de devolver
    const projectResponse = project.toJSON();
    projectResponse.culmination_date = normalizeDateForResponse(project.culmination_date);
    projectResponse.creation_date = normalizeDateForResponse(project.creation_date);

    // Normalizar fechas de las tareas incluidas
    if (projectResponse.Tasks && projectResponse.Tasks.length > 0) {
      projectResponse.Tasks = projectResponse.Tasks.map(task => ({
        ...task,
        completion_date: normalizeDateForResponse(task.completion_date),
        creation_date: normalizeDateForResponse(task.creation_date)
      }));
    }

    res.status(200).json(projectResponse);
  } catch (error) {
    logger.error('Error getting project', error);
    res.status(500).json({ message: 'Error getting project' });
  }
}

/**
 * Recupera todos los IDs de los proyectos almacenados.
 */
async function getAllProjectIds(req, res) {
  try {
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

/**
 * Obtiene los estados disponibles (columnas Kanban) para un proyecto específico.
 */
async function getProjectStatuses(req, res) {
  try {
    const { id } = req.params;

    const project = await Project.findByPk(id, {
      attributes: ['id', 'title', 'kanban_template', 'kanban_columns']
    });

    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    // Extraer solo los IDs y títulos de las columnas para el frontend
    const statuses = project.kanban_columns.map(col => ({
      id: col.id,
      title: col.title,
      color: col.color,
      icon: col.icon
    }));

    logger.info(`Statuses retrieved for project: ${project.id}`);
    res.status(200).json({
      projectId: project.id,
      projectTitle: project.title,
      kanban_template: project.kanban_template,
      statuses: statuses
    });
  } catch (error) {
    logger.error('Error getting project statuses', error);
    res.status(500).json({ message: 'Error getting project statuses' });
  }
}

module.exports = { createProject, getAllProjects, updateProject, deleteProject, getProjectById, getAllProjectIds, getProjectStatuses };