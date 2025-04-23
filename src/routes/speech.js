// routes/speech.js
const express = require('express');
const router = express.Router();
const { Anthropic } = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const winston = require('winston');
const { Task, Project } = require('../models');
const { Op } = require('sequelize');

// Configure logger with detailed output
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// Inicializar el cliente de la API de Claude
let claude;
try {
  if (process.env.CLAUDE_API_KEY) {
    claude = new Anthropic({
      apiKey: process.env.CLAUDE_API_KEY,
    });
    logger.info('Claude API client initialized successfully');
  } else {
    logger.warn('CLAUDE_API_KEY environment variable not set - will use fallback processing');
  }
} catch (error) {
  logger.error(`Error initializing Claude API client: ${error.message}`);
}

// Endpoint for processing text from speech
router.post('/process-voice-text', auth, async (req, res) => {
  const { transcription, commandType, projectId } = req.body;
  
  if (!transcription) {
    return res.status(400).json({ error: 'La transcripción es requerida' });
  }

  try {
    logger.info(`Processing voice text: "${transcription}"`);
    
    // Load projects for context
    let projects = [];
    try {
      projects = await Project.findAll();
      logger.info(`Loaded ${projects.length} projects for context`);
    } catch (error) {
      logger.error(`Error loading projects: ${error.message}`);
    }

    // Determine command type
    let detectedCommandType = commandType;
    
    if (!detectedCommandType) {
      // First try keyword detection (more reliable)
      const normalizedText = transcription.toLowerCase();
      
      if (normalizedText.includes('crear tarea') || normalizedText.includes('nueva tarea')) {
        detectedCommandType = 'createTask';
        logger.info('Command type detected via keywords: createTask');
      } else if (normalizedText.includes('crear proyecto') || normalizedText.includes('nuevo proyecto')) {
        detectedCommandType = 'createProject';
        logger.info('Command type detected via keywords: createProject');
      } else if (normalizedText.includes('buscar') || normalizedText.includes('encontrar') || 
                normalizedText.includes('mostrar') || normalizedText.includes('listar')) {
        detectedCommandType = 'searchTask';
        logger.info('Command type detected via keywords: searchTask');
      } else if (normalizedText.includes('actualizar') || normalizedText.includes('modificar') ||
                normalizedText.includes('cambiar')) {
        detectedCommandType = 'updateTask';
        logger.info('Command type detected via keywords: updateTask');
      } else if (normalizedText.includes('cuántas tareas') || normalizedText.includes('número de tareas')) {
        detectedCommandType = 'countTasks';
        logger.info('Command type detected via keywords: countTasks');
      } else if (claude) {
        // Use Claude for more complex command detection
        try {
          detectedCommandType = await detectCommandTypeWithClaude(transcription);
          logger.info(`Command type detected with Claude: ${detectedCommandType}`);
        } catch (claudeError) {
          logger.error(`Claude command detection error: ${claudeError.message}`);
          detectedCommandType = 'assistance';
        }
      } else {
        detectedCommandType = 'assistance';
        logger.info('No specific command detected, defaulting to assistance');
      }
    }
    
    // Execute the appropriate command
    let response;
    logger.info(`Executing command type: ${detectedCommandType}`);
    
    switch (detectedCommandType) {
      case 'createTask':
        response = await processCreateTaskCommand(transcription, projectId, projects);
        break;
      case 'createProject':
        response = await processCreateProjectCommand(transcription);
        break;
      case 'searchTask':
        response = await processSearchTaskCommand(transcription, projectId);
        break;
      case 'updateTask':
        response = await processUpdateTaskCommand(transcription);
        break;
      case 'countTasks':
        response = await processCountTasksCommand();
        break;
      case 'assistance':
      default:
        response = await processAssistanceCommand(transcription);
        break;
    }
    
    logger.info(`Command processed successfully, response type: ${response.success ? 'success' : 'error'}`);
    return res.json(response);
  } catch (error) {
    logger.error(`Error processing voice command: ${error.message}`, error);
    return res.status(500).json({ 
      success: false,
      error: 'Error al procesar el comando de voz',
      details: error.message 
    });
  }
});

/**
 * Detect command type using Claude
 */
async function detectCommandTypeWithClaude(transcription) {
  try {
    if (!claude) {
      throw new Error('Claude client not initialized');
    }

    const message = await claude.messages.create({
      model: "claude-3-haiku-20240307", // Using the basic model to keep costs low
      max_tokens: 50,
      temperature: 0.2,
      system: "You are a voice command classifier for a task management app. Classify the text into one of these categories: createTask, createProject, searchTask, updateTask, countTasks, assistance.",
      messages: [
        {
          role: "user",
          content: `Analyze this voice command: "${transcription}" 
          Classify it into ONE of these categories: 
          - createTask: for creating a new task
          - createProject: for creating a new project
          - searchTask: for finding or listing tasks
          - updateTask: for changing task details
          - countTasks: for counting or getting statistics about tasks
          - assistance: for help requests or anything else
          
          Reply with ONLY the category name, nothing else.`
        }
      ]
    });

    // Extract just the category name from response
    const cleanResponse = message.content[0].text.trim().toLowerCase();
    const validTypes = ['createtask', 'createproject', 'searchtask', 'updatetask', 'counttasks', 'assistance'];
    
    for (const validType of validTypes) {
      if (cleanResponse.includes(validType)) {
        return validType;
      }
    }
    
    // Default to assistance if no valid type found
    return 'assistance';
  } catch (error) {
    logger.error(`Error using Claude for command detection: ${error.message}`);
    throw error;
  }
}

/**
 * Process a command to create a task
 */
async function processCreateTaskCommand(transcription, projectId, projects = []) {
  logger.info(`Processing create task command: "${transcription}"`);
  
  try {
    // Extract task details
    let taskDetails;
    
    if (claude) {
      try {
        taskDetails = await extractTaskDetailsWithClaude(transcription);
        logger.info(`Task details extracted with Claude: ${JSON.stringify(taskDetails)}`);
      } catch (claudeError) {
        logger.error(`Error extracting task details with Claude: ${claudeError.message}`);
        taskDetails = extractTaskDetailsWithKeywords(transcription);
      }
    } else {
      taskDetails = extractTaskDetailsWithKeywords(transcription);
      logger.info(`Task details extracted with keywords: ${JSON.stringify(taskDetails)}`);
    }
    
    // Ensure we have a project ID
    let targetProjectId = projectId;
    let targetProjectName = "";
    
    if (!targetProjectId && projects.length > 0) {
      // Find project by name mentioned in command
      const normalizedText = transcription.toLowerCase();
      
      for (const project of projects) {
        if (normalizedText.includes(project.title.toLowerCase())) {
          targetProjectId = project.id;
          targetProjectName = project.title;
          logger.info(`Found project in command: ${targetProjectName} (ID: ${targetProjectId})`);
          break;
        }
      }
      
      // If no project found in text, use the first one
      if (!targetProjectId) {
        targetProjectId = projects[0].id;
        targetProjectName = projects[0].title;
        logger.info(`No project found in command, using first project: ${targetProjectName} (ID: ${targetProjectId})`);
      }
    } else if (targetProjectId) {
      // Get project name for the given ID
      try {
        const project = await Project.findByPk(targetProjectId);
        if (project) {
          targetProjectName = project.title;
          logger.info(`Using specified project: ${targetProjectName} (ID: ${targetProjectId})`);
        }
      } catch (error) {
        logger.error(`Error getting project details: ${error.message}`);
      }
    } else {
      logger.error(`No projects available and no project ID specified`);
      return {
        success: false,
        error: 'No se pudo determinar un proyecto para la tarea'
      };
    }
    
    // Create the task
    const taskData = {
      title: taskDetails.title || 'Nueva tarea',
      description: taskDetails.description || 'Tarea creada por comando de voz',
      status: taskDetails.status || 'pending',
      completion_date: taskDetails.completion_date || new Date(Date.now() + 7*24*60*60*1000).toISOString().split('T')[0],
      projectId: targetProjectId,
      creation_date: new Date()
    };
    
    logger.info(`Creating task with data: ${JSON.stringify(taskData)}`);
    
    const newTask = await Task.create(taskData);
    logger.info(`Task created successfully with ID: ${newTask.id}`);
    
    return {
      success: true,
      action: 'createTask',
      taskDetails: newTask.dataValues,
      message: `He creado una nueva tarea: "${taskData.title}" en el proyecto "${targetProjectName}".`
    };
  } catch (error) {
    logger.error(`Error creating task: ${error.message}`);
    return {
      success: false,
      error: `Error al crear la tarea: ${error.message}`
    };
  }
}

/**
 * Extract task details using Claude
 */
async function extractTaskDetailsWithClaude(transcription) {
  try {
    const message = await claude.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 500,
      temperature: 0.2,
      system: `You're a task extraction specialist. Extract task details from voice commands.`,
      messages: [
        {
          role: "user",
          content: `Extract the following details from this voice command: "${transcription}"
          
          Return ONLY a JSON object with these fields:
          - title: the task title (required)
          - description: a description of the task (optional)
          - status: the task status (in_progress, completed, pending, cancelled)
          - completion_date: deadline in YYYY-MM-DD format (optional)
          
          For fields not mentioned, use null. If status is mentioned as "en progreso", use "in_progress".
          Return ONLY the JSON, nothing else.`
        }
      ]
    });

    // Extract the JSON from the response
    const responseText = message.content[0].text.trim();
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    } else {
      throw new Error('Could not extract JSON from Claude response');
    }
  } catch (error) {
    logger.error(`Claude task extraction error: ${error.message}`);
    throw error;
  }
}

/**
 * Extract task details using keyword analysis
 */
function extractTaskDetailsWithKeywords(transcription) {
  const lowercaseTranscription = transcription.toLowerCase();
  
  // Extract title
  let title = "Nueva tarea";
  const titleMatch = transcription.match(/(?:crear|nueva) tarea (?:llamada|titulada|con nombre|con título)? ?["']?([^"'.,]+)["']?/i);
  
  if (titleMatch) {
    title = titleMatch[1].trim();
  } else if (lowercaseTranscription.includes("crear tarea")) {
    // Extract everything after "crear tarea"
    const afterCreateMatch = transcription.match(/crear tarea (.+)/i);
    if (afterCreateMatch) {
      // Use first few words as title
      const words = afterCreateMatch[1].split(' ');
      if (words.length > 3) {
        title = words.slice(0, 3).join(' ');
      } else {
        title = afterCreateMatch[1];
      }
    }
  }
  
  // Extract status
  let status = 'pending';
  if (lowercaseTranscription.includes('en progreso')) status = 'in_progress';
  else if (lowercaseTranscription.includes('completada')) status = 'completed';
  else if (lowercaseTranscription.includes('cancelada')) status = 'cancelled';
  
  // Extract description
  let description = null;
  if (lowercaseTranscription.includes('para')) {
    const descriptionMatch = transcription.match(/para (.+)$/i);
    if (descriptionMatch) {
      description = descriptionMatch[1].trim();
    }
  }
  
  // Extract completion date
  let completionDate = null;
  const today = new Date();
  
  if (lowercaseTranscription.includes('mañana')) {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    completionDate = tomorrow.toISOString().split('T')[0];
  } else if (lowercaseTranscription.includes('próxima semana')) {
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    completionDate = nextWeek.toISOString().split('T')[0];
  } else if (lowercaseTranscription.includes('próximo mes')) {
    const nextMonth = new Date(today);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    completionDate = nextMonth.toISOString().split('T')[0];
  } else {
    // Default to one week from now
    const oneWeek = new Date(today);
    oneWeek.setDate(oneWeek.getDate() + 7);
    completionDate = oneWeek.toISOString().split('T')[0];
  }
  
  return {
    title,
    description,
    status,
    completion_date: completionDate
  };
}

/**
 * Process a command to create a project
 */
async function processCreateProjectCommand(transcription) {
  logger.info(`Processing create project command: "${transcription}"`);
  
  try {
    // Extract project details
    let projectDetails;
    
    if (claude) {
      try {
        projectDetails = await extractProjectDetailsWithClaude(transcription);
        logger.info(`Project details extracted with Claude: ${JSON.stringify(projectDetails)}`);
      } catch (claudeError) {
        logger.error(`Error extracting project details with Claude: ${claudeError.message}`);
        projectDetails = extractProjectDetailsWithKeywords(transcription);
      }
    } else {
      projectDetails = extractProjectDetailsWithKeywords(transcription);
      logger.info(`Project details extracted with keywords: ${JSON.stringify(projectDetails)}`);
    }
    
    // Check if a project with this title already exists
    const existingProject = await Project.findOne({
      where: {
        title: projectDetails.title
      }
    });
    
    if (existingProject) {
      logger.warn(`Project with title "${projectDetails.title}" already exists`);
      return {
        success: false,
        error: `Ya existe un proyecto llamado "${projectDetails.title}"`
      };
    }
    
    // Create the project
    const projectData = {
      title: projectDetails.title || 'Nuevo proyecto',
      description: projectDetails.description || 'Proyecto creado por comando de voz',
      priority: projectDetails.priority || 'medium',
      culmination_date: projectDetails.culmination_date || null,
      creation_date: new Date()
    };
    
    logger.info(`Creating project with data: ${JSON.stringify(projectData)}`);
    
    const newProject = await Project.create(projectData);
    logger.info(`Project created successfully with ID: ${newProject.id}`);
    
    return {
      success: true,
      action: 'createProject',
      projectDetails: newProject.dataValues,
      message: `He creado un nuevo proyecto: "${projectData.title}".`
    };
  } catch (error) {
    logger.error(`Error creating project: ${error.message}`);
    return {
      success: false,
      error: `Error al crear el proyecto: ${error.message}`
    };
  }
}

/**
 * Extract project details using Claude
 */
async function extractProjectDetailsWithClaude(transcription) {
  try {
    const message = await claude.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 500,
      temperature: 0.2,
      system: `You're a project extraction specialist. Extract project details from voice commands.`,
      messages: [
        {
          role: "user",
          content: `Extract the following details from this voice command: "${transcription}"
          
          Return ONLY a JSON object with these fields:
          - title: the project title (required)
          - description: a description of the project (optional)
          - priority: project priority (high, medium, low)
          - culmination_date: deadline in YYYY-MM-DD format (optional)
          
          For fields not mentioned, use null. Return ONLY the JSON, nothing else.`
        }
      ]
    });

    // Extract the JSON from the response
    const responseText = message.content[0].text.trim();
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    } else {
      throw new Error('Could not extract JSON from Claude response');
    }
  } catch (error) {
    logger.error(`Claude project extraction error: ${error.message}`);
    throw error;
  }
}

/**
 * Extract project details using keyword analysis
 */
function extractProjectDetailsWithKeywords(transcription) {
  const lowercaseTranscription = transcription.toLowerCase();
  
  // Extract title
  let title = "Nuevo proyecto";
  const titleMatch = transcription.match(/(?:crear|nuevo) proyecto (?:llamado|titulado|con nombre|con título)? ?["']?([^"'.,]+)["']?/i);
  
  if (titleMatch) {
    title = titleMatch[1].trim();
  } else if (lowercaseTranscription.includes("crear proyecto")) {
    // Extract everything after "crear proyecto"
    const afterCreateMatch = transcription.match(/crear proyecto (.+)/i);
    if (afterCreateMatch) {
      // Use first few words as title
      const words = afterCreateMatch[1].split(' ');
      if (words.length > 3) {
        title = words.slice(0, 3).join(' ');
      } else {
        title = afterCreateMatch[1];
      }
    }
  }
  
  // Extract priority
  let priority = 'medium';
  if (lowercaseTranscription.includes('prioridad alta') || 
      lowercaseTranscription.includes('alta prioridad') || 
      lowercaseTranscription.includes('urgente')) {
    priority = 'high';
  } else if (lowercaseTranscription.includes('prioridad baja') || 
             lowercaseTranscription.includes('baja prioridad')) {
    priority = 'low';
  }
  
  // Extract description
  let description = null;
  if (lowercaseTranscription.includes('para')) {
    const descriptionMatch = transcription.match(/para (.+)$/i);
    if (descriptionMatch) {
      description = descriptionMatch[1].trim();
    }
  }
  
  return {
    title,
    description,
    priority,
    culmination_date: null
  };
}

/**
 * Process a command to search for tasks
 */
async function processSearchTaskCommand(transcription, projectId) {
  logger.info(`Processing search task command: "${transcription}"`);
  
  try {
    // Extract search parameters
    let searchParams;
    
    if (claude) {
      try {
        searchParams = await extractSearchParamsWithClaude(transcription);
        logger.info(`Search parameters extracted with Claude: ${JSON.stringify(searchParams)}`);
      } catch (claudeError) {
        logger.error(`Error extracting search parameters with Claude: ${claudeError.message}`);
        searchParams = extractSearchParamsWithKeywords(transcription);
      }
    } else {
      searchParams = extractSearchParamsWithKeywords(transcription);
      logger.info(`Search parameters extracted with keywords: ${JSON.stringify(searchParams)}`);
    }
    
    // Construct the query
    const whereClause = {};
    
    if (searchParams.searchTerm) {
      whereClause[Op.or] = [
        { title: { [Op.iLike]: `%${searchParams.searchTerm}%` } },
        { description: { [Op.iLike]: `%${searchParams.searchTerm}%` } }
      ];
    }
    
    if (searchParams.status) {
      whereClause.status = searchParams.status;
    }
    
    if (projectId) {
      whereClause.projectId = projectId;
    } else if (searchParams.projectId) {
      whereClause.projectId = searchParams.projectId;
    }
    
    logger.info(`Searching tasks with criteria: ${JSON.stringify(whereClause)}`);
    
    // Perform the search
    const tasks = await Task.findAll({
      where: whereClause,
      include: [
        {
          model: Project,
          attributes: ['id', 'title']
        }
      ]
    });
    
    logger.info(`Found ${tasks.length} tasks matching criteria`);
    
    // Format results
    const searchResults = tasks.map(task => ({
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      completion_date: task.completion_date,
      projectName: task.Project ? task.Project.title : 'Unknown'
    }));
    
    return {
      success: true,
      action: 'searchTasks',
      searchParams,
      searchResults,
      message: `He encontrado ${searchResults.length} tareas que coinciden con tu búsqueda.`
    };
  } catch (error) {
    logger.error(`Error searching tasks: ${error.message}`);
    return {
      success: false,
      error: `Error al buscar tareas: ${error.message}`
    };
  }
}

/**
 * Extract search parameters using Claude
 */
async function extractSearchParamsWithClaude(transcription) {
  try {
    const message = await claude.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 500,
      temperature: 0.2,
      system: `You're a search parameter extraction specialist for a task management system.`,
      messages: [
        {
          role: "user",
          content: `Extract search parameters from this voice command: "${transcription}"
          
          Return ONLY a JSON object with these fields:
          - searchTerm: keywords to search for in title or description
          - status: task status (in_progress, completed, pending, cancelled)
          - projectId: project ID if mentioned (null if not)
          
          For any parameters not mentioned, use null. Return ONLY the JSON, nothing else.`
        }
      ]
    });

    // Extract the JSON from the response
    const responseText = message.content[0].text.trim();
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    } else {
      throw new Error('Could not extract JSON from Claude response');
    }
  } catch (error) {
    logger.error(`Claude search parameter extraction error: ${error.message}`);
    throw error;
  }
}

/**
 * Extract search parameters using keyword analysis
 */
function extractSearchParamsWithKeywords(transcription) {
  const lowercaseTranscription = transcription.toLowerCase();
  
  // Extract search term
  let searchTerm = null;
  const searchMatch = transcription.match(/(?:buscar|encontrar|mostrar|listar) (?:tareas? (?:sobre|de|con|relacionadas))? ?["']?([^"'.,]+)["']?/i);
  
  if (searchMatch) {
    searchTerm = searchMatch[1].trim();
  }
  
  // Extract status
  let status = null;
  if (lowercaseTranscription.includes('pendiente')) status = 'pending';
  else if (lowercaseTranscription.includes('en progreso')) status = 'in_progress';
  else if (lowercaseTranscription.includes('completada')) status = 'completed';
  else if (lowercaseTranscription.includes('cancelada')) status = 'cancelled';
  
  return {
    searchTerm,
    status,
    projectId: null
  };
}

/**
 * Process a command to update a task
 */
async function processUpdateTaskCommand(transcription) {
  logger.info(`Processing update task command: "${transcription}"`);
  
  try {
    // Extract update details
    let updateDetails;
    
    if (claude) {
      try {
        updateDetails = await extractUpdateDetailsWithClaude(transcription);
        logger.info(`Update details extracted with Claude: ${JSON.stringify(updateDetails)}`);
      } catch (claudeError) {
        logger.error(`Error extracting update details with Claude: ${claudeError.message}`);
        updateDetails = extractUpdateDetailsWithKeywords(transcription);
      }
    } else {
      updateDetails = extractUpdateDetailsWithKeywords(transcription);
      logger.info(`Update details extracted with keywords: ${JSON.stringify(updateDetails)}`);
    }
    
    if (!updateDetails.taskIdentifier) {
      logger.error('No task identifier found in command');
      return {
        success: false,
        error: 'No se pudo identificar qué tarea deseas actualizar.'
      };
    }
    
    // Find the task to update
    let task;
    
    if (!isNaN(updateDetails.taskIdentifier)) {
      // If identifier is a number, search by ID
      task = await Task.findByPk(parseInt(updateDetails.taskIdentifier));
    } else {
      // Otherwise search by title
      task = await Task.findOne({
        where: {
          title: {
            [Op.iLike]: `%${updateDetails.taskIdentifier}%`
          }
        }
      });
    }
    
    if (!task) {
      logger.error(`No task found matching identifier: ${updateDetails.taskIdentifier}`);
      return {
        success: false,
        error: `No se encontró ninguna tarea que coincida con "${updateDetails.taskIdentifier}".`
      };
    }
    
    // Ensure we have updates to apply
    if (!updateDetails.updates || Object.keys(updateDetails.updates).length === 0) {
      logger.error('No updates specified in command');
      return {
        success: false,
        error: 'No se especificaron cambios para actualizar la tarea.'
      };
    }
    
    logger.info(`Updating task ${task.id} with: ${JSON.stringify(updateDetails.updates)}`);
    
    // Apply the updates
    await task.update(updateDetails.updates);
    
    // Get the updated task
    const updatedTask = await Task.findByPk(task.id, {
      include: [
        {
          model: Project,
          attributes: ['id', 'title']
        }
      ]
    });
    
    return {
      success: true,
      action: 'updateTask',
      taskDetails: {
        id: updatedTask.id,
        title: updatedTask.title,
        description: updatedTask.description,
        status: updatedTask.status,
        completion_date: updatedTask.completion_date,
        projectName: updatedTask.Project ? updatedTask.Project.title : 'Unknown'
      },
      message: `He actualizado la tarea "${updatedTask.title}" correctamente.`
    };
  } catch (error) {
    logger.error(`Error updating task: ${error.message}`);
    return {
      success: false,
      error: `Error al actualizar la tarea: ${error.message}`
    };
  }
}

/**
 * Extract update details using Claude
 */
async function extractUpdateDetailsWithClaude(transcription) {
  try {
    const message = await claude.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 500,
      temperature: 0.2,
      system: `You're a task update specialist. Extract update details from voice commands.`,
      messages: [
        {
          role: "user",
          content: `Extract the following details from this voice command: "${transcription}"
          
          Return ONLY a JSON object with these fields:
          - taskIdentifier: words identifying which task to update
          - updates: an object containing fields to update, which may include:
            - title: new title 
            - description: new description
            - status: new status (in_progress, completed, pending, cancelled)
            - completion_date: new deadline in YYYY-MM-DD format
          
          Only include fields in 'updates' that should actually change.
          If "en progreso" is mentioned, use "in_progress" for status.
          Return ONLY the JSON, nothing else.`
        }
      ]
    });

    // Extract the JSON from the response
    const responseText = message.content[0].text.trim();
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    } else {
      throw new Error('Could not extract JSON from Claude response');
    }
  } catch (error) {
    logger.error(`Claude update extraction error: ${error.message}`);
    throw error;
  }
}

/**
 * Extract update details using keyword analysis
 */
function extractUpdateDetailsWithKeywords(transcription) {
  const lowercaseTranscription = transcription.toLowerCase();
  
  // Extract task identifier
  let taskIdentifier = null;
  const taskMatch = transcription.match(/(?:actualizar|modificar|cambiar) (?:la )?tarea (?:llamada |titulada |con nombre |con título )?["']?([^"'.,]+)["']?/i);
  
  if (taskMatch) {
    taskIdentifier = taskMatch[1].trim();
  }
  
  // Extract updates
  const updates = {};
  
  // Update status
  if (lowercaseTranscription.includes('a pendiente') || 
      lowercaseTranscription.includes('estado pendiente')) {
    updates.status = 'pending';
  } else if (lowercaseTranscription.includes('a en progreso') || 
             lowercaseTranscription.includes('estado en progreso')) {
    updates.status = 'in_progress';
  } else if (lowercaseTranscription.includes('a completada') || 
             lowercaseTranscription.includes('estado completada') ||
             lowercaseTranscription.includes('como completada') ||
             lowercaseTranscription.includes('marcar como completada')) {
    updates.status = 'completed';
  } else if (lowercaseTranscription.includes('a cancelada') || 
             lowercaseTranscription.includes('estado cancelada')) {
    updates.status = 'cancelled';
  }
  
  // Update title
  const titleMatch = transcription.match(/(?:cambiar|actualizar) (?:el )?título (?:a|por) ["']?([^"'.,]+)["']?/i);
  if (titleMatch) {
    updates.title = titleMatch[1].trim();
  }
  
  // Update date
  if (lowercaseTranscription.includes('fecha')) {
    let newDate = new Date();
    
    if (lowercaseTranscription.includes('mañana')) {
      newDate.setDate(newDate.getDate() + 1);
    } else if (lowercaseTranscription.includes('próxima semana')) {
      newDate.setDate(newDate.getDate() + 7);
    } else if (lowercaseTranscription.includes('próximo mes')) {
      newDate.setMonth(newDate.getMonth() + 1);
    }
    
    updates.completion_date = newDate.toISOString().split('T')[0];
  }
  
  return {
    taskIdentifier,
    updates
  };
}

/**
 * Process a command to count tasks
 */
async function processCountTasksCommand() {
  logger.info('Processing count tasks command');
  
  try {
    // Count all tasks
    const taskCount = await Task.count();
    logger.info(`Total task count: ${taskCount}`);
    
    return {
      success: true,
      response: `Actualmente tienes ${taskCount} tareas en total en el sistema.`
    };
  } catch (error) {
    logger.error(`Error counting tasks: ${error.message}`);
    return {
      success: false,
      error: `Error al contar tareas: ${error.message}`
    };
  }
}

/**
 * Process a general assistance command
 */
async function processAssistanceCommand(transcription) {
  logger.info(`Processing assistance command: "${transcription}"`);
  
  const lowercaseTranscription = transcription.toLowerCase();
  
  // Check for specific assistance requests
  if (lowercaseTranscription.includes('hola') || 
      lowercaseTranscription.includes('buenos días') || 
      lowercaseTranscription.includes('buenas tardes') || 
      lowercaseTranscription.includes('buenas noches')) {
    return {
      success: true,
      response: '¡Hola! Soy tu asistente virtual de SmartTask. ¿En qué puedo ayudarte hoy?'
    };
  }
  
  if (lowercaseTranscription.includes('ayuda') || 
      lowercaseTranscription.includes('qué puedes hacer')) {
    return {
      success: true,
      response: 'Puedo ayudarte con varias tareas. Puedes pedirme crear tareas o proyectos, buscar tareas, actualizar tareas existentes, o contar el número de tareas que tienes.'
    };
  }
  
  if (lowercaseTranscription.includes('cómo crear') && lowercaseTranscription.includes('tarea')) {
    return {
      success: true,
      response: 'Para crear una tarea, puedes decir: "Crear tarea [título] en el proyecto [nombre del proyecto]". También puedes especificar detalles como estado ("en progreso") y fecha límite.'
    };
  }
  
  if (lowercaseTranscription.includes('cómo crear') && lowercaseTranscription.includes('proyecto')) {
    return {
      success: true,
      response: 'Para crear un proyecto, puedes decir: "Crear proyecto [título]". Opcionalmente puedes especificar la prioridad como "alta", "media" o "baja", y añadir una descripción.'
    };
  }
  
  // Use Claude for more complex assistance if available
  if (claude) {
    try {
      return await getAssistanceWithClaude(transcription);
    } catch (claudeError) {
      logger.error(`Error getting assistance with Claude: ${claudeError.message}`);
    }
  }
  
  // Default response
  return {
    success: true,
    response: '¿En qué puedo ayudarte? Puedo asistirte con la creación de tareas y proyectos, o ayudarte a buscar información en tu sistema de gestión de tareas.'
  };
}

/**
 * Get assistance response using Claude
 */
async function getAssistanceWithClaude(transcription) {
  try {
    const message = await claude.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 300,
      temperature: 0.7,
      system: `You're a helpful assistant for a task management application called SmartTask. 
      The app allows users to:
      - Create and manage projects with titles, descriptions, dates, and priorities
      - Create and manage tasks within projects
      - Search for tasks by various criteria
      - Update task details
      
      Keep your responses friendly, helpful, and concise (2-4 sentences max).`,
      messages: [
        {
          role: "user",
          content: `The user has asked: "${transcription}"
          
          Provide a helpful response without technical jargon. Don't mention that you're an AI.`
        }
      ]
    });

    return {
      success: true,
      response: message.content[0].text.trim()
    };
  } catch (error) {
    logger.error(`Claude assistance error: ${error.message}`);
    throw error;
  }
}

// Export the router
module.exports = router;