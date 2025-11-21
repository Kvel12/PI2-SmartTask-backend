'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('projects', 'members', {
      type: Sequelize.JSONB,
      allowNull: true,
      comment: 'Array of project members with name and email'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('projects', 'members');
  }
};