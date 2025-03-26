/**
 * Sequelize instance for database connection.
 * This instance is configured to interact with the database
 * using the settings defined in the '../config/database' file.
 *
 * @type {import('sequelize').Sequelize}
 */

const sequelize = require('../config/database');

// Importación de los modelos de la base de datos
const User = require('./user');
const Project = require('./project');
const Task = require('./task');

// Definición de las relaciones entre modelos

// Un proyecto puede tener muchas tareas
Project.hasMany(Task, { 
  foreignKey: {
    name: 'projectId', // Clave foránea en la tabla Task que referencia a Project
    allowNull: false // No permite valores nulos en la clave foránea
  },
  onDelete: 'CASCADE' // Si un proyecto se elimina, sus tareas asociadas también se eliminan
});

// Una tarea pertenece a un único proyecto
Task.belongsTo(Project, { 
  foreignKey: {
    name: 'projectId', // Clave foránea en la tabla Task que referencia a Project
    allowNull: false // No permite valores nulos en la clave foránea
  }
});

// Exportación de la instancia de Sequelize y los modelos para su uso en otras partes de la aplicación
module.exports = {
  sequelize,
  User,
  Project,
  Task
};
