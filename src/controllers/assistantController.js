const Task = require('../models/task');
const Project = require('../models/project');
const logger = require('../logger');
const { Op } = require('sequelize');

/**
 * Helper function to normalize dates to YYYY-MM-DD format
 */
function normalizeDateForResponse(dateValue) {
  if (!dateValue) return null;
  
  try {
    const date = new Date(dateValue);
    if (isNaN(date.getTime())) return null;
    
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
  } catch (error) {
    logger.error(`Error normalizing date: ${error.message}`);
    return null;
  }
}

/**
 * Helper function to calculate days until a date
 */
function daysUntil(dateString) {
  if (!dateString) return null;
  
  try {
    const targetDate = new Date(dateString);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    targetDate.setHours(0, 0, 0, 0);
    
    const diffTime = targetDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return diffDays;
  } catch (error) {
    return null;
  }
}

/**
 * Get full context of all projects and tasks for Claude assistant
 * 
 * @route GET /api/assistant/context
 * @returns {Object} Complete context with projects, tasks, and analytics
 */
async function getFullContext(req, res) {
  try {
    logger.info('Getting full context for assistant');
    
    // Get all projects with their tasks
    const projects = await Project.findAll({
      include: [{
        model: Task,
        required: false
      }],
      order: [['creation_date', 'DESC']]
    });
    
    // Get all tasks (for global statistics)
    const allTasks = await Task.findAll({
      include: [{
        model: Project,
        attributes: ['id', 'title', 'priority']
      }],
      order: [['completion_date', 'ASC']]
    });
    
    // Calculate statistics
    const totalProjects = projects.length;
    const totalTasks = allTasks.length;
    
    const tasksByStatus = {
      pending: allTasks.filter(t => t.status === 'pending').length,
      in_progress: allTasks.filter(t => t.status === 'in_progress').length,
      completed: allTasks.filter(t => t.status === 'completed').length,
      cancelled: allTasks.filter(t => t.status === 'cancelled').length
    };
    
    const projectsByPriority = {
      high: projects.filter(p => p.priority === 'high').length,
      medium: projects.filter(p => p.priority === 'medium').length,
      low: projects.filter(p => p.priority === 'low').length
    };
    
    // Get upcoming tasks (next 7 days)
    const today = new Date();
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    
    const upcomingTasks = allTasks.filter(task => {
      if (!task.completion_date || task.status === 'completed' || task.status === 'cancelled') return false;
      const taskDate = new Date(task.completion_date);
      return taskDate >= today && taskDate <= nextWeek;
    }).map(task => ({
      id: task.id,
      title: task.title,
      description: task.description,
      completion_date: normalizeDateForResponse(task.completion_date),
      daysUntil: daysUntil(task.completion_date),
      status: task.status,
      projectName: task.Project ? task.Project.title : 'Unknown',
      projectPriority: task.Project ? task.Project.priority : null
    }));
    
    // Get overdue tasks
    const overdueTasks = allTasks.filter(task => {
      if (!task.completion_date || task.status === 'completed' || task.status === 'cancelled') return false;
      const taskDate = new Date(task.completion_date);
      return taskDate < today;
    }).map(task => ({
      id: task.id,
      title: task.title,
      completion_date: normalizeDateForResponse(task.completion_date),
      daysOverdue: Math.abs(daysUntil(task.completion_date)),
      status: task.status,
      projectName: task.Project ? task.Project.title : 'Unknown'
    }));
    
    // Format projects for response
    const formattedProjects = projects.map(project => {
      const projectTasks = project.Tasks || [];
      
      return {
        id: project.id,
        title: project.title,
        description: project.description,
        priority: project.priority,
        creation_date: normalizeDateForResponse(project.creation_date),
        culmination_date: normalizeDateForResponse(project.culmination_date),
        totalTasks: projectTasks.length,
        pendingTasks: projectTasks.filter(t => t.status === 'pending').length,
        inProgressTasks: projectTasks.filter(t => t.status === 'in_progress').length,
        completedTasks: projectTasks.filter(t => t.status === 'completed').length,
        cancelledTasks: projectTasks.filter(t => t.status === 'cancelled').length,
        tasks: projectTasks.map(task => ({
          id: task.id,
          title: task.title,
          description: task.description,
          status: task.status,
          creation_date: normalizeDateForResponse(task.creation_date),
          completion_date: normalizeDateForResponse(task.completion_date),
          daysUntil: daysUntil(task.completion_date)
        }))
      };
    });
    
    // Build complete context object
    const context = {
      summary: {
        totalProjects,
        totalTasks,
        tasksByStatus,
        projectsByPriority,
        upcomingTasksCount: upcomingTasks.length,
        overdueTasksCount: overdueTasks.length
      },
      projects: formattedProjects,
      upcomingTasks,
      overdueTasks,
      timestamp: new Date().toISOString()
    };
    
    logger.info(`Context generated: ${totalProjects} projects, ${totalTasks} tasks`);
    res.status(200).json(context);
    
  } catch (error) {
    logger.error(`Error getting full context: ${error.message}`, error);
    res.status(500).json({ message: 'Error getting assistant context' });
  }
}

/**
 * Get detailed information about a specific project
 * 
 * @route GET /api/assistant/project/:id
 * @param {string} id - Project ID
 * @returns {Object} Detailed project information with tasks and analytics
 */
async function getProjectDetails(req, res) {
  try {
    const { id } = req.params;
    
    logger.info(`Getting project details for ID: ${id}`);
    
    const project = await Project.findByPk(id, {
      include: [{
        model: Task,
        required: false
      }]
    });
    
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }
    
    const tasks = project.Tasks || [];
    
    // Calculate project statistics
    const stats = {
      totalTasks: tasks.length,
      pendingTasks: tasks.filter(t => t.status === 'pending').length,
      inProgressTasks: tasks.filter(t => t.status === 'in_progress').length,
      completedTasks: tasks.filter(t => t.status === 'completed').length,
      cancelledTasks: tasks.filter(t => t.status === 'cancelled').length,
      completionRate: tasks.length > 0 
        ? Math.round((tasks.filter(t => t.status === 'completed').length / tasks.length) * 100)
        : 0
    };
    
    // Get upcoming tasks for this project
    const today = new Date();
    const upcomingTasks = tasks.filter(task => {
      if (!task.completion_date || task.status === 'completed' || task.status === 'cancelled') return false;
      const taskDate = new Date(task.completion_date);
      return taskDate >= today;
    }).sort((a, b) => new Date(a.completion_date) - new Date(b.completion_date));
    
    // Get overdue tasks
    const overdueTasks = tasks.filter(task => {
      if (!task.completion_date || task.status === 'completed' || task.status === 'cancelled') return false;
      const taskDate = new Date(task.completion_date);
      return taskDate < today;
    });
    
    const projectDetails = {
      id: project.id,
      title: project.title,
      description: project.description,
      priority: project.priority,
      creation_date: normalizeDateForResponse(project.creation_date),
      culmination_date: normalizeDateForResponse(project.culmination_date),
      daysUntilCulmination: daysUntil(project.culmination_date),
      statistics: stats,
      tasks: tasks.map(task => ({
        id: task.id,
        title: task.title,
        description: task.description,
        status: task.status,
        creation_date: normalizeDateForResponse(task.creation_date),
        completion_date: normalizeDateForResponse(task.completion_date),
        daysUntil: daysUntil(task.completion_date),
        isOverdue: daysUntil(task.completion_date) < 0 && task.status !== 'completed' && task.status !== 'cancelled'
      })),
      upcomingTasks: upcomingTasks.map(task => ({
        id: task.id,
        title: task.title,
        completion_date: normalizeDateForResponse(task.completion_date),
        daysUntil: daysUntil(task.completion_date),
        status: task.status
      })),
      overdueTasks: overdueTasks.map(task => ({
        id: task.id,
        title: task.title,
        completion_date: normalizeDateForResponse(task.completion_date),
        daysOverdue: Math.abs(daysUntil(task.completion_date)),
        status: task.status
      }))
    };
    
    logger.info(`Project details retrieved for: ${project.title}`);
    res.status(200).json(projectDetails);
    
  } catch (error) {
    logger.error(`Error getting project details: ${error.message}`, error);
    res.status(500).json({ message: 'Error getting project details' });
  }
}

/**
 * Get upcoming tasks (tasks due in the next 7 days)
 * 
 * @route GET /api/assistant/tasks/upcoming
 * @returns {Array} List of upcoming tasks with project information
 */
async function getUpcomingTasks(req, res) {
  try {
    const daysAhead = parseInt(req.query.days) || 7;
    
    logger.info(`Getting upcoming tasks for next ${daysAhead} days`);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const futureDate = new Date(today);
    futureDate.setDate(futureDate.getDate() + daysAhead);
    
    const tasks = await Task.findAll({
      where: {
        completion_date: {
          [Op.between]: [today, futureDate]
        },
        status: {
          [Op.notIn]: ['completed', 'cancelled']
        }
      },
      include: [{
        model: Project,
        attributes: ['id', 'title', 'priority']
      }],
      order: [['completion_date', 'ASC']]
    });
    
    const upcomingTasks = tasks.map(task => ({
      id: task.id,
      title: task.title,
      description: task.description,
      completion_date: normalizeDateForResponse(task.completion_date),
      daysUntil: daysUntil(task.completion_date),
      status: task.status,
      projectId: task.Project ? task.Project.id : null,
      projectName: task.Project ? task.Project.title : 'Unknown',
      projectPriority: task.Project ? task.Project.priority : null
    }));
    
    logger.info(`Found ${upcomingTasks.length} upcoming tasks`);
    res.status(200).json(upcomingTasks);
    
  } catch (error) {
    logger.error(`Error getting upcoming tasks: ${error.message}`, error);
    res.status(500).json({ message: 'Error getting upcoming tasks' });
  }
}

/**
 * Get analytics and insights about tasks and projects
 * 
 * @route GET /api/assistant/analytics
 * @returns {Object} Analytics and insights
 */
async function getAnalytics(req, res) {
  try {
    logger.info('Getting analytics');
    
    const projects = await Project.findAll({
      include: [{ model: Task, required: false }]
    });
    
    const allTasks = await Task.findAll({
      include: [{ model: Project, attributes: ['id', 'title', 'priority'] }]
    });
    
    // Calculate various metrics
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const overdueTasks = allTasks.filter(task => {
      if (!task.completion_date || task.status === 'completed' || task.status === 'cancelled') return false;
      const taskDate = new Date(task.completion_date);
      return taskDate < today;
    });
    
    const upcomingTasks = allTasks.filter(task => {
      if (!task.completion_date || task.status === 'completed' || task.status === 'cancelled') return false;
      const taskDate = new Date(task.completion_date);
      const nextWeek = new Date(today);
      nextWeek.setDate(nextWeek.getDate() + 7);
      return taskDate >= today && taskDate <= nextWeek;
    });
    
    const completedThisWeek = allTasks.filter(task => {
      if (task.status !== 'completed') return false;
      const taskDate = new Date(task.updatedAt);
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);
      return taskDate >= weekAgo;
    });
    
    // Project with most tasks
    const projectTaskCounts = projects.map(p => ({
      project: p,
      taskCount: (p.Tasks || []).length
    })).sort((a, b) => b.taskCount - a.taskCount);
    
    const busiestProject = projectTaskCounts[0] || null;
    
    // Project with highest completion rate
    const projectCompletionRates = projects
      .filter(p => (p.Tasks || []).length > 0)
      .map(p => {
        const tasks = p.Tasks || [];
        const completed = tasks.filter(t => t.status === 'completed').length;
        return {
          project: p,
          completionRate: (completed / tasks.length) * 100
        };
      })
      .sort((a, b) => b.completionRate - a.completionRate);
    
    const bestPerformingProject = projectCompletionRates[0] || null;
    
    const analytics = {
      overview: {
        totalProjects: projects.length,
        totalTasks: allTasks.length,
        pendingTasks: allTasks.filter(t => t.status === 'pending').length,
        inProgressTasks: allTasks.filter(t => t.status === 'in_progress').length,
        completedTasks: allTasks.filter(t => t.status === 'completed').length,
        overdueTasks: overdueTasks.length,
        upcomingTasks: upcomingTasks.length,
        completedThisWeek: completedThisWeek.length,
        overallCompletionRate: allTasks.length > 0
          ? Math.round((allTasks.filter(t => t.status === 'completed').length / allTasks.length) * 100)
          : 0
      },
      insights: {
        busiestProject: busiestProject ? {
          id: busiestProject.project.id,
          title: busiestProject.project.title,
          taskCount: busiestProject.taskCount
        } : null,
        bestPerformingProject: bestPerformingProject ? {
          id: bestPerformingProject.project.id,
          title: bestPerformingProject.project.title,
          completionRate: Math.round(bestPerformingProject.completionRate)
        } : null,
        urgentTasks: overdueTasks.slice(0, 5).map(task => ({
          id: task.id,
          title: task.title,
          daysOverdue: Math.abs(daysUntil(task.completion_date)),
          projectName: task.Project ? task.Project.title : 'Unknown'
        })),
        nextMilestones: upcomingTasks.slice(0, 5).map(task => ({
          id: task.id,
          title: task.title,
          daysUntil: daysUntil(task.completion_date),
          projectName: task.Project ? task.Project.title : 'Unknown'
        }))
      },
      recommendations: generateRecommendations(allTasks, projects, overdueTasks, upcomingTasks)
    };
    
    logger.info('Analytics generated successfully');
    res.status(200).json(analytics);
    
  } catch (error) {
    logger.error(`Error getting analytics: ${error.message}`, error);
    res.status(500).json({ message: 'Error getting analytics' });
  }
}

/**
 * Generate recommendations based on current tasks and projects
 */
function generateRecommendations(allTasks, projects, overdueTasks, upcomingTasks) {
  const recommendations = [];
  
  // Check for overdue tasks
  if (overdueTasks.length > 0) {
    recommendations.push({
      type: 'urgent',
      message: `You have ${overdueTasks.length} overdue task${overdueTasks.length > 1 ? 's' : ''}. Consider prioritizing them or updating their deadlines.`,
      action: 'review_overdue_tasks'
    });
  }
  
  // Check for upcoming deadlines
  if (upcomingTasks.length > 0) {
    recommendations.push({
      type: 'reminder',
      message: `You have ${upcomingTasks.length} task${upcomingTasks.length > 1 ? 's' : ''} due in the next week. Plan your time accordingly.`,
      action: 'review_upcoming_tasks'
    });
  }
  
  // Check for projects without tasks
  const emptyProjects = projects.filter(p => !p.Tasks || p.Tasks.length === 0);
  if (emptyProjects.length > 0) {
    recommendations.push({
      type: 'suggestion',
      message: `${emptyProjects.length} project${emptyProjects.length > 1 ? 's' : ''} ha${emptyProjects.length > 1 ? 've' : 's'} no tasks. Consider adding tasks or archiving unused projects.`,
      action: 'review_empty_projects'
    });
  }
  
  // Check for high-priority projects
  const highPriorityProjects = projects.filter(p => p.priority === 'high');
  if (highPriorityProjects.length > 0) {
    const pendingTasksInHighPriority = highPriorityProjects.reduce((count, project) => {
      const pendingTasks = (project.Tasks || []).filter(t => t.status === 'pending').length;
      return count + pendingTasks;
    }, 0);
    
    if (pendingTasksInHighPriority > 0) {
      recommendations.push({
        type: 'priority',
        message: `You have ${pendingTasksInHighPriority} pending task${pendingTasksInHighPriority > 1 ? 's' : ''} in high-priority projects. Focus on these first.`,
        action: 'focus_on_high_priority'
      });
    }
  }
  
  return recommendations;
}

module.exports = {
  getFullContext,
  getProjectDetails,
  getUpcomingTasks,
  getAnalytics
};