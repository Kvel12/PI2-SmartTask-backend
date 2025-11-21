'use strict';

/**
 * Migration to change Task status from ENUM to STRING
 * This allows dynamic status values based on project's kanban_columns
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    // PostgreSQL requires special handling to change from ENUM to STRING

    // Step 1: Add a temporary column
    await queryInterface.addColumn('tasks', 'status_temp', {
      type: Sequelize.STRING,
      allowNull: true
    });

    // Step 2: Copy data from old column to new column
    await queryInterface.sequelize.query(
      'UPDATE "tasks" SET status_temp = status::text'
    );

    // Step 3: Drop the old ENUM column
    await queryInterface.removeColumn('tasks', 'status');

    // Step 4: Drop the ENUM type
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_tasks_status";');

    // Step 5: Rename the temporary column to the original name
    await queryInterface.renameColumn('tasks', 'status_temp', 'status');

    // Step 6: Make it NOT NULL and add default
    await queryInterface.changeColumn('tasks', 'status', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: 'pending',
      comment: 'Task status - must match a column ID from the associated project\'s kanban_columns'
    });

    console.log('✅ Successfully changed Task status from ENUM to STRING');
  },

  down: async (queryInterface, Sequelize) => {
    // Rollback: Change back to ENUM (only works if all values are valid)

    // Step 1: Add temporary column with ENUM
    await queryInterface.addColumn('tasks', 'status_temp', {
      type: Sequelize.ENUM('in_progress', 'completed', 'pending', 'cancelled'),
      allowNull: true
    });

    // Step 2: Copy valid data (this will fail for invalid ENUM values)
    await queryInterface.sequelize.query(`
      UPDATE "tasks"
      SET status_temp = status::text::"enum_tasks_status_temp"
      WHERE status IN ('in_progress', 'completed', 'pending', 'cancelled')
    `);

    // Step 3: Drop the STRING column
    await queryInterface.removeColumn('tasks', 'status');

    // Step 4: Rename temp column
    await queryInterface.renameColumn('tasks', 'status_temp', 'status');

    // Step 5: Make it NOT NULL
    await queryInterface.changeColumn('tasks', 'status', {
      type: Sequelize.ENUM('in_progress', 'completed', 'pending', 'cancelled'),
      allowNull: false,
      defaultValue: 'pending'
    });

    console.log('✅ Successfully reverted Task status to ENUM');
  }
};
