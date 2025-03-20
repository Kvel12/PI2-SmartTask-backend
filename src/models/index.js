const sequelize = require('../config/database');  // Importa la conexión a la base de datos
const User = require('./user');
const Project = require('./project');
const Task = require('./task');

// Definir relaciones entre modelos
Project.hasMany(Task, { foreignKey: 'projectId', onDelete: 'CASCADE' });  // Un proyecto tiene muchas tareas
Task.belongsTo(Project, { foreignKey: 'projectId' });  // Cada tarea pertenece a un proyecto

module.exports = {
  sequelize,  // Exporta la instancia de Sequelize
  User,
  Project,
  Task
};
