const { validationResult } = require('express-validator');
const Task = require('../models/task');
const Project = require('../models/project');
const logger = require('../logger');

/**
 * Creates a new task associated with a specific project.
 *
 * @async
 * @function createTask
 * @param {Object} req - The request object.
 * @param {Object} req.body - The body of the request containing task details.
 * @param {string} req.body.title - The title of the task.
 * @param {string} req.body.description - The description of the task.
 * @param {string} req.body.creation_date - The creation date of the task.
 * @param {string} req.body.completion_date - The completion date of the task.
 * @param {string} req.body.status - The status of the task.
 * @param {number} req.body.projectId - The ID of the project the task belongs to.
 * @param {Object} res - The response object.
 * @returns {Promise<void>} Sends a JSON response with the created task or an error message.
 * @throws {Error} Returns a 400 status if validation errors exist, a 404 status if the project is not found, 
 * or a 500 status if an internal server error occurs.
 */
async function createTask(req, res) {
  try {
    // Verificar errores de validación
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { title, description, creation_date, completion_date, status, projectId } = req.body;

    // Verificar que el proyecto existe
    const project = await Project.findByPk(projectId);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    // Crear la tarea
    const task = await Task.create({
      title,
      description,
      creation_date,
      completion_date,
      status,
      projectId
    });

    logger.info(`Task created: ${task.id}`);
    res.status(201).json(task);
  } catch (error) {
    logger.error(`Error creating task: ${error.message}`, error);
    res.status(500).json({ message: 'Error creating task' });
  }
}

/**
 * Retrieves all tasks from the database, including their associated projects.
 * The tasks are ordered by their creation date in descending order.
 *
 * @async
 * @function getAllTasks
 * @param {Object} req - The request object.
 * @param {Object} res - The response object.
 * @returns {Promise<void>} Sends a JSON response with the list of tasks or an error message.
 * @throws {Error} If an error occurs while retrieving tasks, a 500 status code is returned.
 */
async function getAllTasks(req, res) {
  try {
    const tasks = await Task.findAll({
      include: [
        {
          model: Project,
          attributes: ['id', 'title']
        }
      ],
      order: [['creation_date', 'DESC']]
    });

    logger.info('All tasks retrieved');
    res.status(200).json(tasks);
  } catch (error) {
    logger.error(`Error getting all tasks: ${error.message}`, error);
    res.status(500).json({ message: 'Error getting tasks' });
  }
}

/**
 * Retrieves all tasks associated with a specific project.
 *
 * @async
 * @function getTasksByProject
 * @param {Object} req - The request object.
 * @param {Object} req.params - The parameters from the request.
 * @param {string} req.params.projectId - The ID of the project to retrieve tasks for.
 * @param {Object} res - The response object.
 * @returns {Promise<void>} Sends a JSON response with the list of tasks or an error message.
 *
 * @throws {Error} Returns a 404 status if the project is not found.
 * @throws {Error} Returns a 500 status if there is an error retrieving the tasks.
 */
async function getTasksByProject(req, res) {
  try {
    const { projectId } = req.params;

    // Verificar que el proyecto existe
    const project = await Project.findByPk(projectId);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    // Obtener todas las tareas del proyecto
    const tasks = await Task.findAll({
      where: { projectId: projectId },
      order: [['creation_date', 'DESC']]
    });

    logger.info(`Tasks retrieved for project: ${projectId}`);
    res.status(200).json(tasks);
  } catch (error) {
    logger.error(`Error getting tasks by project: ${error.message}`, error);
    res.status(500).json({ message: 'Error getting tasks' });
  }
}

/**
 * Retrieves a task by its ID, including its associated project details.
 *
 * @async
 * @function getTaskById
 * @param {Object} req - The request object.
 * @param {Object} req.params - The parameters from the request.
 * @param {string} req.params.id - The ID of the task to retrieve.
 * @param {Object} res - The response object.
 * @returns {Promise<void>} Sends a JSON response with the task data or an error message.
 *
 * @throws {Error} If an error occurs while retrieving the task, a 500 status code is returned.
 */
async function getTaskById(req, res) {
  try {
    const { id } = req.params;

    const task = await Task.findByPk(id, {
      include: [
        {
          model: Project,
          attributes: ['id', 'title']
        }
      ]
    });

    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    logger.info(`Task retrieved: ${task.id}`);
    res.status(200).json(task);
  } catch (error) {
    logger.error(`Error getting task: ${error.message}`, error);
    res.status(500).json({ message: 'Error getting task' });
  }
}

/**
 * Updates an existing task with the provided data.
 *
 * @async
 * @function updateTask
 * @param {Object} req - The request object.
 * @param {Object} req.params - The request parameters.
 * @param {string} req.params.id - The ID of the task to update.
 * @param {Object} req.body - The request body containing task data.
 * @param {string} [req.body.title] - The new title of the task.
 * @param {string} [req.body.description] - The new description of the task.
 * @param {string} [req.body.creation_date] - The new creation date of the task.
 * @param {string} [req.body.completion_date] - The new completion date of the task.
 * @param {string} [req.body.status] - The new status of the task.
 * @param {string} [req.body.projectId] - The ID of the new project to associate with the task.
 * @param {Object} res - The response object.
 * @returns {Promise<void>} Sends a JSON response with the updated task or an error message.
 * @throws {Error} Returns a 400 status if validation errors occur.
 * @throws {Error} Returns a 404 status if the task or project is not found.
 * @throws {Error} Returns a 500 status if an internal server error occurs.
 */
async function updateTask(req, res) {
  try {
    // Verificar errores de validación
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { title, description, creation_date, completion_date, status, projectId } = req.body;

    // Verificar que la tarea existe
    const task = await Task.findByPk(id);
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    // Si se proporciona un nuevo projectId, verificar que el proyecto existe
    if (projectId && projectId !== task.projectId) {
      const project = await Project.findByPk(projectId);
      if (!project) {
        return res.status(404).json({ message: 'Project not found' });
      }
      task.projectId = projectId;
    }

    // Actualizar solo los campos proporcionados
    if (title) task.title = title;
    if (description !== undefined) task.description = description;
    if (creation_date) task.creation_date = creation_date;
    if (completion_date) task.completion_date = completion_date;
    if (status) task.status = status;

    await task.save();
    logger.info(`Task updated: ${task.id}`);
    res.status(200).json(task);
  } catch (error) {
    logger.error(`Error updating task: ${error.message}`, error);
    res.status(500).json({ message: 'Error updating task' });
  }
}

/**
 * Deletes a task by its ID.
 *
 * @async
 * @function deleteTask
 * @param {Object} req - The request object.
 * @param {Object} req.params - The parameters from the request.
 * @param {string} req.params.id - The ID of the task to delete.
 * @param {Object} res - The response object.
 * @returns {void}
 * @throws {Error} If an error occurs during the deletion process.
 *
 * @description
 * This function retrieves a task by its ID from the database. If the task exists, it deletes the task
 * and sends a 204 No Content response. If the task does not exist, it sends a 404 Not Found response.
 * In case of an error during the process, it logs the error and sends a 500 Internal Server Error response.
 */
async function deleteTask(req, res) {
  try {
    const { id } = req.params;

    // Verificar que la tarea existe
    const task = await Task.findByPk(id);
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    // Eliminar la tarea
    await task.destroy();
    logger.info(`Task deleted: ${task.id}`);
    res.status(204).send();
  } catch (error) {
    logger.error(`Error deleting task: ${error.message}`, error);
    res.status(500).json({ message: 'Error deleting task' });
  }
}

module.exports = { createTask, getAllTasks, getTasksByProject, getTaskById, updateTask, deleteTask };