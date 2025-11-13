const { validationResult } = require('express-validator');
const Task = require('../models/task');
const Project = require('../models/project');
const logger = require('../logger');

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
 * Creates a new task associated with a specific project.
 */
async function createTask(req, res) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { title, description, creation_date, completion_date, status, projectId } = req.body;

    const project = await Project.findByPk(projectId);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const task = await Task.create({
      title,
      description,
      creation_date,
      completion_date,
      status,
      projectId
    });

    logger.info(`Task created: ${task.id}`);
    
    // ✅ NORMALIZAR fechas antes de devolver
    const taskResponse = task.toJSON();
    taskResponse.completion_date = normalizeDateForResponse(task.completion_date);
    taskResponse.creation_date = normalizeDateForResponse(task.creation_date);
    
    res.status(201).json(taskResponse);
  } catch (error) {
    logger.error(`Error creating task: ${error.message}`, error);
    res.status(500).json({ message: 'Error creating task' });
  }
}

/**
 * Retrieves all tasks from the database, including their associated projects.
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
    
    // ✅ NORMALIZAR fechas para todas las tareas
    const tasksResponse = tasks.map(task => {
      const taskData = task.toJSON();
      taskData.completion_date = normalizeDateForResponse(task.completion_date);
      taskData.creation_date = normalizeDateForResponse(task.creation_date);
      return taskData;
    });
    
    res.status(200).json(tasksResponse);
  } catch (error) {
    logger.error(`Error getting all tasks: ${error.message}`, error);
    res.status(500).json({ message: 'Error getting tasks' });
  }
}

/**
 * Retrieves all tasks associated with a specific project.
 */
async function getTasksByProject(req, res) {
  try {
    const { projectId } = req.params;

    const project = await Project.findByPk(projectId);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const tasks = await Task.findAll({
      where: { projectId: projectId },
      order: [['creation_date', 'DESC']]
    });

    logger.info(`Tasks retrieved for project: ${projectId}`);
    
    // ✅ NORMALIZAR fechas para todas las tareas
    const tasksResponse = tasks.map(task => {
      const taskData = task.toJSON();
      taskData.completion_date = normalizeDateForResponse(task.completion_date);
      taskData.creation_date = normalizeDateForResponse(task.creation_date);
      return taskData;
    });
    
    res.status(200).json(tasksResponse);
  } catch (error) {
    logger.error(`Error getting tasks by project: ${error.message}`, error);
    res.status(500).json({ message: 'Error getting tasks' });
  }
}

/**
 * Retrieves a task by its ID, including its associated project details.
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
    
    // ✅ NORMALIZAR fechas antes de devolver
    const taskResponse = task.toJSON();
    taskResponse.completion_date = normalizeDateForResponse(task.completion_date);
    taskResponse.creation_date = normalizeDateForResponse(task.creation_date);
    
    res.status(200).json(taskResponse);
  } catch (error) {
    logger.error(`Error getting task: ${error.message}`, error);
    res.status(500).json({ message: 'Error getting task' });
  }
}

/**
 * Updates an existing task with the provided data.
 */
async function updateTask(req, res) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { title, description, creation_date, completion_date, status, projectId } = req.body;

    const task = await Task.findByPk(id);
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    if (projectId && projectId !== task.projectId) {
      const project = await Project.findByPk(projectId);
      if (!project) {
        return res.status(404).json({ message: 'Project not found' });
      }
      task.projectId = projectId;
    }

    // ✅ CORREGIDO: Usar !== undefined para permitir valores vacíos
    if (title !== undefined) task.title = title;
    if (description !== undefined) task.description = description;
    if (creation_date !== undefined) task.creation_date = creation_date;
    if (completion_date !== undefined) task.completion_date = completion_date;  // ✅ CORREGIDO
    if (status !== undefined) task.status = status;

    await task.save();
    logger.info(`Task updated: ${task.id}`);
    
    // ✅ NORMALIZAR fechas antes de devolver
    const taskResponse = task.toJSON();
    taskResponse.completion_date = normalizeDateForResponse(task.completion_date);
    taskResponse.creation_date = normalizeDateForResponse(task.creation_date);
    
    console.log('📅 Task response being sent:', taskResponse); // Para debugging
    
    res.status(200).json(taskResponse);
  } catch (error) {
    logger.error(`Error updating task: ${error.message}`, error);
    res.status(500).json({ message: 'Error updating task' });
  }
}

/**
 * Deletes a task by its ID.
 */
async function deleteTask(req, res) {
  try {
    const { id } = req.params;

    const task = await Task.findByPk(id);
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    await task.destroy();
    logger.info(`Task deleted: ${task.id}`);
    res.status(204).send();
  } catch (error) {
    logger.error(`Error deleting task: ${error.message}`, error);
    res.status(500).json({ message: 'Error deleting task' });
  }
}

module.exports = { createTask, getAllTasks, getTasksByProject, getTaskById, updateTask, deleteTask };