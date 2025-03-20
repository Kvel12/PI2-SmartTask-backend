const Project = require('../models/project');


/**
 * Creates a new project with the provided details from the request body.
 *
 * @async
 * @function createProject
 * @param {Object} req - The request object.
 * @param {Object} req.body - The body of the request containing project details.
 * @param {string} req.body.title - The title of the project.
 * @param {string} req.body.description - The description of the project.
 * @param {string} req.body.priority - The priority level of the project.
 * @param {string} req.body.culmination_date - The expected culmination date of the project.
 * @param {Object} res - The response object.
 * @returns {Promise<void>} Sends a JSON response with the created project or an error message.
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