const express = require('express');
const router = express.Router();
const assistantController = require('../controllers/assistantController');

/**
 * @route GET /api/assistant/context
 * @description Get full context of all projects and tasks for Claude assistant
 * @access Private (requires authentication)
 */
router.get('/context', assistantController.getFullContext);

/**
 * @route GET /api/assistant/project/:id
 * @description Get detailed information about a specific project
 * @access Private (requires authentication)
 */
router.get('/project/:id', assistantController.getProjectDetails);

/**
 * @route GET /api/assistant/tasks/upcoming
 * @description Get upcoming tasks (next 7 days by default)
 * @query {number} days - Optional: number of days ahead to look (default: 7)
 * @access Private (requires authentication)
 */
router.get('/tasks/upcoming', assistantController.getUpcomingTasks);

/**
 * @route GET /api/assistant/analytics
 * @description Get analytics and insights about tasks and projects
 * @access Private (requires authentication)
 */
router.get('/analytics', assistantController.getAnalytics);

module.exports = router;