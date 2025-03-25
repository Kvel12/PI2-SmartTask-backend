const { validationResult } = require('express-validator');
const Task = require('../models/task');
const Project = require('../models/project');
const logger = require('../logger');

/**
 * Crea una nueva tarea asociada a un proyecto específico.
 *
 * @async
 * @function createTask
 * @param {Object} req - Objeto de solicitud HTTP.
 * @param {Object} req.body - Cuerpo de la solicitud que contiene los datos de la tarea.
 * @param {string} req.body.title - Título de la tarea.
 * @param {string} req.body.description - Descripción de la tarea.
 * @param {number} req.body.projectId - ID del proyecto al que pertenece la tarea.
 * @param {string} [req.body.status] - Estado de la tarea (opcional).
 * @param {string} [req.body.completion_date] - Fecha de finalización de la tarea (opcional).
 * @param {Object} res - Objeto de respuesta HTTP.
 * @returns {Promise<void>} Devuelve una respuesta HTTP con el estado de la operación.
 * @throws {Error} Devuelve un error 404 si el proyecto no se encuentra o un error 500 si ocurre un problema al crear la tarea.
 */
async function createTask(req, res) {
    try {
      
      // Validar errores de entrada
      const errors = validationResult(req);
          if (!errors.isEmpty()) {
              return res.status(400).json({ errors: errors.array() });
          }
        
      const { title, description, projectId, status, completion_date } = req.body;
      
      // Verificar si la tarea ya existe
      const existingTask = await Task.findOne({ where: { title } });
      if (existingTask) {
          return res.status(400).json({ message: 'A task with this title already exists.' });
      }

      // Crear la tarea asociada al proyecto si pasa las validaciones
      const task = await Task.create({ title, description, projectId, status, completion_date });
      logger.info(`Task created: ${task.id}`);
      res.status(201).json(task);
    } catch (error) {
      logger.error('Error creating task', error);
      res.status(500).json({ message: 'Error creating task' });
    }
}


/**
 * Obtiene todas las tareas de la base de datos.
 *
 * @async
 * @function getAllTasks
 * @param {Object} req - Objeto de solicitud HTTP.
 * @param {Object} res - Objeto de respuesta HTTP.
 * @returns {void} Envía una respuesta HTTP con el estado 200 y las tareas en formato JSON si tiene éxito,
 * o una respuesta con el estado 500 y un mensaje de error si ocurre un problema.
 */
async function getAllTasks(req, res) {
    try {
      const tasks = await Task.findAll();
      res.status(200).json(tasks);
    } catch (error) {
      logger.error('Error getting tasks', error);
      res.status(500).json({ message: 'Error getting tasks' });
    }
}


/**
 * Actualiza una tarea existente en la base de datos.
 *
 * @async
 * @function updateTask
 * @param {Object} req - Objeto de solicitud de Express.
 * @param {Object} req.params - Parámetros de la solicitud.
 * @param {string} req.params.id - ID de la tarea a actualizar.
 * @param {Object} req.body - Cuerpo de la solicitud con los datos de la tarea.
 * @param {string} req.body.title - Nuevo título de la tarea.
 * @param {string} req.body.description - Nueva descripción de la tarea.
 * @param {string} req.body.status - Nuevo estado de la tarea.
 * @param {string} req.body.completion_date - Nueva fecha de finalización de la tarea.
 * @param {Object} res - Objeto de respuesta de Express.
 * @returns {void} Devuelve una respuesta HTTP con el estado de la operación.
 * @throws {Error} Devuelve un error 404 si la tarea no se encuentra o un error 500 si ocurre un problema en el servidor.
 */
async function updateTask(req, res) {
    try {

      const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
       }

      const { id } = req.params;
      const { title, description, status, completion_date } = req.body;
    
      // Verificar si la tarea existe
      const task = await Task.findByPk(id);
      if (!task) {
        return res.status(404).json({ message: 'Task not found' });
      }

      // Verificar que la fecha de finalización sea mayor a la de inicio
      if (startDate && dueDate && new Date(dueDate) <= new Date(startDate)) {
        return res.status(400).json({ message: 'The complation date must be after the creartion date' });
    }

    // Actualizar la tarea en la base de datos si pasa las validaciones
      task.title = title;
      task.description = description;
      task.status = status;
      task.completion_date = completion_date;
      
      await task.save();
      logger.info(`Task updated: ${task.id}`);
      return res.status(200).json({ message: 'task updated successfully' });

    } catch (error) {
      logger.error('Error updating task', error);
      res.status(500).json({ message: 'Error updating task' });
    }
}


/**
 * Elimina una tarea específica basada en su ID.
 *
 * @async
 * @function deleteTask
 * @param {Object} req - Objeto de solicitud de Express.
 * @param {Object} req.params - Parámetros de la solicitud.
 * @param {string} req.params.id - ID de la tarea a eliminar.
 * @param {Object} res - Objeto de respuesta de Express.
 * @returns {void} - Envía una respuesta HTTP con el estado correspondiente:
 *                   - 204 si la tarea fue eliminada exitosamente.
 *                   - 404 si no se encuentra la tarea.
 *                   - 500 si ocurre un error en el servidor.
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
      logger.error('Error deleting task', error);
      res.status(500).json({ message: 'Error deleting task' });
    }
}

module.exports = { createTask, getAllTasks, updateTask, deleteTask };