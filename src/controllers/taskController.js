const { validationResult } = require('express-validator');
const Task = require('../models/task');
const Project = require('../models/project');
const logger = require('../logger');

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