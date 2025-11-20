'use strict';

/**
 * Migration to add kanban_template and kanban_columns fields to Projects table
 * This enables dynamic Kanban board configuration per project
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Agregar kanban_template
    await queryInterface.addColumn('Projects', 'kanban_template', {
      type: Sequelize.ENUM('default', 'architecture', 'systems_engineering'),
      allowNull: false,
      defaultValue: 'default',
      comment: 'Template type for the Kanban board'
    });

    // Agregar kanban_columns
    await queryInterface.addColumn('Projects', 'kanban_columns', {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: [
        { id: 'pending', title: 'Pending', color: '#ffc107', icon: '📋' },
        { id: 'in_progress', title: 'In Progress', color: '#007bff', icon: '🔄' },
        { id: 'completed', title: 'Completed', color: '#28a745', icon: '✅' },
        { id: 'cancelled', title: 'Cancelled', color: '#6c757d', icon: '❌' }
      ],
      comment: 'Array of column objects defining the Kanban board structure'
    });

    console.log('✅ Successfully added kanban_template and kanban_columns to Projects table');
  },

  down: async (queryInterface, Sequelize) => {
    // Eliminar columnas en caso de rollback
    await queryInterface.removeColumn('Projects', 'kanban_columns');
    await queryInterface.removeColumn('Projects', 'kanban_template');

    // Eliminar el tipo ENUM
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_Projects_kanban_template";');

    console.log('✅ Successfully removed kanban fields from Projects table');
  }
};
