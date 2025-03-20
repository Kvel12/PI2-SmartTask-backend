const Task = require('../models/task');
const Project = require('../models/project');

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
      const { title, description, projectId, status, completion_date } = req.body;
      const project = await Project.findByPk(projectId);
      if (!project) {
        return res.status(404).json({ message: 'Project not found' });
      }
      const task = await Task.create({ title, description, projectId, status, completion_date });
      res.status(201).json(task);
    } catch (error) {
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
      const { id } = req.params;
      const { title, description, status, completion_date } = req.body;
      const task = await Task.findByPk(id);
      if (!task) {
        return res.status(404).json({ message: 'Task not found' });
      }
      task.title = title;
      task.description = description;
      task.status = status;
      task.completion_date = completion_date;
      await task.save();
      res.status(200).json(task);
    } catch (error) {
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
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: 'Error deleting task' });
    }
}

module.exports = { createTask, getAllTasks, updateTask, deleteTask };