/**
 * Sequelize instance for database connection.
 * This instance is configured to interact with the database
 * using the settings defined in the '../config/database' file.
 *
 * @type {import('sequelize').Sequelize}
 */

const sequelize = require('../config/database');
const User = require('./user');
const Project = require('./project');
const Task = require('./task');

// Definir asociaciones
Project.hasMany(Task, { 
  foreignKey: {
    name: 'projectId',
    allowNull: false
  },
  onDelete: 'CASCADE' 
});

Task.belongsTo(Project, { 
  foreignKey: {
    name: 'projectId',
    allowNull: false
  }
});

module.exports = {
  sequelize,
  User,
  Project,
  Task
};