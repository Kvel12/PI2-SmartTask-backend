'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Agregar columna priority
    await queryInterface.addColumn('tasks', 'priority', {
      type: Sequelize.ENUM('low', 'medium', 'high'),
      allowNull: true,
      defaultValue: 'medium'
    });

    // Agregar columna assigned_member si no existe
    await queryInterface.addColumn('tasks', 'assigned_member', {
      type: Sequelize.STRING,
      allowNull: true,
      comment: 'Email of the assigned project member'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('tasks', 'assigned_member');
    await queryInterface.removeColumn('tasks', 'priority');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_tasks_priority";');
  }
};