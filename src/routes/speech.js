const express = require('express');
const router = express.Router();
const multer = require('multer');
const speech = require('@google-cloud/speech');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const winston = require('winston');
const { Task, Project } = require('../models');
const { Op } = require('sequelize');
const axios = require('axios');

// ==================== CONFIGURACIÓN DE LOGGER ====================
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

// ==================== INICIALIZAR CLAUDE ====================
let openaiClient;
try {
  if (process.env.CLAUDE_API_KEY) {
    openaiClient = new OpenAI({
      apiKey: process.env.CLAUDE_API_KEY,
      baseURL: "https://api.anthropic.com/v1/",
    });
    logger.info('Claude client (via OpenAI SDK) initialized successfully');
  } else {
    logger.warn('CLAUDE_API_KEY environment variable not configured');
  }
} catch (error) {
  logger.error(`Error initializing Claude client: ${error.message}`);
}

// ==================== CONFIGURAR GOOGLE SPEECH-TO-TEXT ====================
let speechClient;
try {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    speechClient = new speech.SpeechClient({
      credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
    });
    logger.info('Google Speech-to-Text client initialized successfully');
  } else {
    logger.error('GOOGLE_APPLICATION_CREDENTIALS_JSON environment variable not configured');
  }
} catch (error) {
  logger.error('Error configuring Google Speech-to-Text:', error);
}

// ==================== DIRECTORIO DE UPLOADS ====================
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  try {
    fs.mkdirSync(uploadDir, { recursive: true });
    logger.info(`Uploads directory created: ${uploadDir}`);
  } catch (error) {
    logger.error(`Error creating uploads directory: ${error.message}`);
  }
}

// ==================== CONFIGURACIÓN DE MULTER ====================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const extension = file.originalname.split('.').pop();
    cb(null, `${uuidv4()}.${extension}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = ['audio/webm', 'audio/ogg', 'audio/wav', 'audio/mpeg', 'audio/mp3'];
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file format: ${file.mimetype}`), false);
    }
  }
});

// ==================== SPEECH-TO-TEXT CON DETECCIÓN DE IDIOMA ====================
router.post('/speech-to-text', auth, upload.single('audio'), async (req, res) => {
  try {
    logger.info('Starting audio to text processing with language detection');
    
    if (!speechClient) {
      logger.error('Google Speech-to-Text is not configured correctly');
      return res.status(500).json({ error: 'Google Speech-to-Text is not configured correctly' });
    }
    
    if (!req.file) {
      logger.error('No audio file received');
      return res.status(400).json({ error: 'No audio file received' });
    }

    logger.info(`File received: ${req.file.filename}, type: ${req.file.mimetype}, size: ${req.file.size} bytes`);

    const audioBytes = fs.readFileSync(req.file.path).toString('base64');
    
    let encoding;
    switch (req.file.mimetype) {
      case 'audio/webm':
        encoding = 'WEBM_OPUS';
        break;
      case 'audio/ogg':
        encoding = 'OGG_OPUS';
        break;
      case 'audio/wav':
        encoding = 'LINEAR16';
        break;
      case 'audio/mpeg':
      case 'audio/mp3':
        encoding = 'MP3';
        break;
      default:
        encoding = 'ENCODING_UNSPECIFIED';
    }
    
    logger.info(`Processing audio with encoding: ${encoding}`);

    // Configuración con detección automática de idioma
    const request = {
      audio: {
        content: audioBytes,
      },
      config: {
        encoding: encoding,
        languageCode: 'es-ES',
        alternativeLanguageCodes: [
          'en-US', 'en-GB', 'es-MX', 'es-CO', 'es-AR', 'es-CL', 'es-US'
        ],
        enableAutomaticPunctuation: true,
        model: 'default',
        enableLanguageIdentification: true,
      },
    };

    const [response] = await speechClient.recognize(request);
    
    if (!response.results || response.results.length === 0) {
      logger.warn('No transcription results obtained');
      return res.status(400).json({ 
        error: 'No speech detected in audio',
        transcription: ''
      });
    }
    
    const transcription = response.results
      .map(result => result.alternatives[0].transcript)
      .join('\n');
    
    let detectedLanguage = 'es';
    if (response.results[0].languageCode) {
      detectedLanguage = response.results[0].languageCode.startsWith('en') ? 'en' : 'es';
      logger.info(`Detected language: ${response.results[0].languageCode} (using: ${detectedLanguage})`);
    }
    
    logger.info(`Transcription completed: "${transcription}" in language: ${detectedLanguage}`);

    try {
      fs.unlinkSync(req.file.path);
    } catch (unlinkError) {
      logger.error(`Error deleting temporary file: ${unlinkError.message}`);
    }

    res.json({ 
      success: true, 
      transcription,
      detectedLanguage
    });
  } catch (error) {
    logger.error(`Detailed error in speech-to-text: ${error.stack}`);
    
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkError) {
        logger.error(`Error deleting temporary file: ${unlinkError.message}`);
      }
    }
    
    res.status(500).json({ 
      error: 'Error processing audio',
      details: error.message 
    });
  }
});


// ==================== PROCESS VOICE TEXT ====================
router.post('/process-voice-text', auth, async (req, res) => {
  const { transcription, commandType, projectId, detectedLanguage } = req.body;
  
  if (!transcription) {
    return res.status(400).json({ error: 'Transcription is required' });
  }

  const language = detectedLanguage || inferLanguage(transcription);
  logger.info(`Processing voice command in language: ${language}`);

  try {
    logger.info(`Processing transcription: "${transcription}"`);
    
    let projects = [];
    try {
      projects = await Project.findAll();
      logger.info(`Loaded ${projects.length} projects for context`);
    } catch (error) {
      logger.warn(`Error loading projects: ${error.message}`);
    }
    
    const isBatchCommand = detectBatchCommand(transcription, language);
    
    if (isBatchCommand) {
      logger.info('Batch command detected - processing multiple items');
      const batchResponse = await processBatchCommand(transcription, projects, language);
      return res.json(batchResponse);
    }
    
    const detectedCommandType = commandType || detectCommandType(transcription, language);
    logger.info(`Executing command type: ${detectedCommandType}`);
    
    let response;
    
    switch (detectedCommandType) {
      case 'createTask':
        response = await processCreateTaskCommand(transcription, projectId, projects, language);
        break;
      case 'createProject':
        response = await processCreateProjectCommand(transcription, language);
        break;
      case 'searchTask':
        response = await processSearchTaskCommand(transcription, projectId, language);
        break;
      case 'searchProject':
        response = await processSearchProjectCommand(transcription, language);
        break;
      case 'updateTask':
        response = await processUpdateTaskCommand(transcription, projects, language);
        break;
      case 'updateProject':
        response = await processUpdateProjectCommand(transcription, language);
        break;
      case 'countTasks':
        response = await processCountTasksCommand(language);
        break;
      case 'countProjects':
        response = await processCountProjectsCommand(language);
        break;
      case 'assistance':
      default:
        // ✅ PASAR EL TOKEN DEL USUARIO AL ASISTENTE
        response = await processAssistanceCommand(transcription, projects, language, req.headers['x-auth-token']);
        break;
    }
    
    logger.info(`Command processed successfully`);
    return res.json(response);
  } catch (error) {
    logger.error(`Error processing voice command: ${error.message}`);
    return res.status(500).json({ 
      success: false,
      error: language === 'en' ? 'Error processing voice command' : 'Error al procesar el comando de voz',
      details: error.message 
    });
  }
});

// ==================== INFERIR IDIOMA DEL TEXTO ====================
function inferLanguage(text) {
  const spanishKeywords = ['crear', 'tarea', 'proyecto', 'buscar', 'actualizar', 'cuántos', 'cuántas', 'hola', 'para', 'en', 'con'];
  const englishKeywords = ['create', 'task', 'project', 'search', 'update', 'how many', 'hello', 'for', 'in', 'with'];
  
  const lowerText = text.toLowerCase();
  
  const spanishMatches = spanishKeywords.filter(keyword => lowerText.includes(keyword)).length;
  const englishMatches = englishKeywords.filter(keyword => lowerText.includes(keyword)).length;
  
  return englishMatches > spanishMatches ? 'en' : 'es';
}

// ==================== DETECTAR COMANDO POR LOTES ====================
function detectBatchCommand(text, language) {
  const lowerText = text.toLowerCase();
  
  if (language === 'en') {
    return (
      (lowerText.match(/\d+\s+(tasks?|stories|items)/g) !== null) ||
      (lowerText.split(/,|and|\n/).length > 3) ||
      (lowerText.includes('multiple') && lowerText.includes('task')) ||
      (lowerText.includes('several') && lowerText.includes('task'))
    );
  } else {
    return (
      (lowerText.match(/\d+\s+(tareas?|historias?|elementos?)/g) !== null) ||
      (lowerText.split(/,|y|\n/).length > 3) ||
      (lowerText.includes('múltiples') && lowerText.includes('tarea')) ||
      (lowerText.includes('varias') && lowerText.includes('tarea'))
    );
  }
}

// ==================== PROCESAR COMANDO POR LOTES ====================
async function processBatchCommand(transcription, projects, language) {
  logger.info(`Processing batch command with ${projects.length} projects available`);
  
  try {
    if (!openaiClient) {
      return {
        success: false,
        response: language === 'en' 
          ? 'Batch processing not available' 
          : 'Procesamiento por lotes no disponible'
      };
    }

    const systemPrompt = language === 'en' 
      ? `You are an AI assistant specialized in processing multiple task creation requests simultaneously.
Available projects: ${JSON.stringify(projects.map(p => ({ id: p.id, title: p.title })))}

Your task is to:
1. Identify ALL tasks mentioned in the user's request
2. Extract details for each task (title, description, status, completion_date, projectId)
3. Return a JSON array with all tasks

Respond ONLY with valid JSON in this format:
{
  "action": "batchCreateTasks",
  "tasks": [
    {
      "title": "Task title",
      "description": "Task description",
      "status": "pending|in_progress|completed|cancelled",
      "completion_date": "YYYY-MM-DD",
      "projectId": number (or null)
    }
  ],
  "message": "Human-friendly summary in English"
}`
      : `Eres un asistente de IA especializado en procesar múltiples solicitudes de creación de tareas simultáneamente.
Proyectos disponibles: ${JSON.stringify(projects.map(p => ({ id: p.id, title: p.title })))}

Tu tarea es:
1. Identificar TODAS las tareas mencionadas en la solicitud del usuario
2. Extraer detalles de cada tarea (título, descripción, estado, fecha_finalización, projectId)
3. Devolver un array JSON con todas las tareas

Responde SOLO con JSON válido en este formato:
{
  "action": "batchCreateTasks",
  "tasks": [
    {
      "title": "Título de la tarea",
      "description": "Descripción de la tarea",
      "status": "pending|in_progress|completed|cancelled",
      "completion_date": "YYYY-MM-DD",
      "projectId": número (o null)
    }
  ],
  "message": "Resumen amigable en español"
}`;

    const completion = await openaiClient.chat.completions.create({
      model: "claude-sonnet-4-20250514",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: transcription }
      ],
      temperature: 0.1,
      max_tokens: 2000,
    });

    const responseContent = completion.choices[0].message.content;
    const cleanedResponse = responseContent
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    const batchData = JSON.parse(cleanedResponse);
    
    const createdTasks = [];
    const errors = [];
    
    for (const taskData of batchData.tasks) {
      try {
        if (!taskData.projectId && projects.length > 0) {
          taskData.projectId = projects[0].id;
        }
        
        const newTask = await Task.create({
          title: taskData.title,
          description: taskData.description || `Task: ${taskData.title}`,
          status: taskData.status || 'pending',
          completion_date: taskData.completion_date || getDefaultDate(),
          projectId: taskData.projectId,
          creation_date: new Date()
        });
        
        createdTasks.push(newTask);
        logger.info(`Batch task created: ${newTask.id} - ${newTask.title}`);
      } catch (error) {
        logger.error(`Error creating batch task: ${error.message}`);
        errors.push({ task: taskData.title, error: error.message });
      }
    }
    
    const successMessage = language === 'en'
      ? `Successfully created ${createdTasks.length} task(s)${errors.length > 0 ? ` with ${errors.length} error(s)` : ''}.`
      : `Se crearon exitosamente ${createdTasks.length} tarea(s)${errors.length > 0 ? ` con ${errors.length} error(es)` : ''}.`;
    
    return {
      success: true,
      action: 'batchCreateTasks',
      createdTasks: createdTasks.map(t => t.dataValues),
      errors,
      response: batchData.message || successMessage
    };
    
  } catch (error) {
    logger.error(`Error in batch processing: ${error.message}`);
    return {
      success: false,
      response: language === 'en'
        ? `Error processing batch command: ${error.message}`
        : `Error procesando comando por lotes: ${error.message}`
    };
  }
}

// ==================== DETECTAR TIPO DE COMANDO ====================
function detectCommandType(transcription, language) {
  const normalizedText = transcription.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  
  // ✅ PRIORIDAD 1: Comandos de análisis y contexto (para el asistente)
  const analysisKeywords = language === 'en'
    ? ['overdue', 'analytics', 'progress', 'summary', 'explain', 'tell me about', 'what is', 'describe']
    : ['atrasad', 'vencid', 'analisis', 'analiticas', 'progreso', 'resumen', 'explicame', 'explica', 'cuentame', 'que es', 'describe'];
  
  for (const keyword of analysisKeywords) {
    if (normalizedText.includes(keyword)) {
      logger.info(`Analysis/context keyword detected: ${keyword} - routing to assistance`);
      return 'assistance';
    }
  }
  
  // ✅ PRIORIDAD 2: Comandos específicos de acción
  if (language === 'en') {
    if (/\b(create|add|new)\s+(task|activity)\b/i.test(transcription)) return 'createTask';
    if (/\b(create|add|new)\s+(project|plan)\b/i.test(transcription)) return 'createProject';
    if (/\b(search|find|show|list)\s+(tasks?|activities)\b/i.test(transcription)) return 'searchTask';
    if (/\b(search|find|show|list)\s+(projects?)\b/i.test(transcription)) return 'searchProject';
    if (/\b(update|change|modify|mark)\s+(task|activity|status)\b/i.test(transcription)) return 'updateTask';
    if (/\b(update|change|modify)\s+(project|priority)\b/i.test(transcription)) return 'updateProject';
    if (/\bhow many\s+(tasks?|activities)\b/i.test(transcription) && !normalizedText.includes('overdue')) return 'countTasks';
    if (/\bhow many\s+(projects?)\b/i.test(transcription)) return 'countProjects';
  } else {
    if (/\b(crear|nueva?|agregar|anadir)\s+(tarea|actividad)\b/i.test(normalizedText)) return 'createTask';
    if (/\b(crear|nueva?|agregar|anadir)\s+(proyecto|plan)\b/i.test(normalizedText)) return 'createProject';
    if (/\b(buscar|encontrar|mostrar|listar)\s+(tareas?|actividades)\b/i.test(normalizedText)) return 'searchTask';
    if (/\b(buscar|encontrar|mostrar|listar)\s+(proyectos?)\b/i.test(normalizedText)) return 'searchProject';
    if (/\b(actualizar|cambiar|modificar|marcar)\s+(tarea|actividad|estado)\b/i.test(normalizedText)) return 'updateTask';
    if (/\b(actualizar|cambiar|modificar)\s+(proyecto|prioridad)\b/i.test(normalizedText)) return 'updateProject';
    if (/\b(cuantas?|numero|total)\s+(tareas?|actividades)\b/i.test(normalizedText) && !normalizedText.includes('atrasad') && !normalizedText.includes('vencid')) return 'countTasks';
    if (/\b(cuantos?|numero|total)\s+(proyectos?)\b/i.test(normalizedText)) return 'countProjects';
  }
  
  return 'assistance';
}

// ==================== FUNCIÓN AUXILIAR: FECHA POR DEFECTO ====================
function getDefaultDate() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ==================== CREAR TAREA ====================
async function processCreateTaskCommand(transcription, projectId, projects, language) {
  logger.info(`Processing create task command in ${language}`);
  
  try {
    let targetProjectId = projectId;
    let targetProjectName = "";
    
    if (!targetProjectId && projects.length > 0) {
      const projectNameMatch = transcription.match(/(?:en|para|del|in|for|project)\s+(?:el\s+)?(?:proyecto\s+)?(?:the\s+)?(?:project\s+)?["']?([^"'.,]+)["']?/i);
      let possibleProjectName = null;
      
      if (projectNameMatch && projectNameMatch[1]) {
        possibleProjectName = projectNameMatch[1].trim();
        logger.info(`Possible project name extracted: ${possibleProjectName}`);
      }
      
      if (possibleProjectName) {
        for (const project of projects) {
          if (project.title.toLowerCase() === possibleProjectName.toLowerCase()) {
            targetProjectId = project.id;
            targetProjectName = project.title;
            logger.info(`Project found by exact match: ${targetProjectName} (ID: ${targetProjectId})`);
            break;
          }
        }
        
        if (!targetProjectId) {
          for (const project of projects) {
            const projectTitle = project.title.toLowerCase();
            const normalizedPossibleName = possibleProjectName.toLowerCase();
            
            if (projectTitle.includes(normalizedPossibleName) || normalizedPossibleName.includes(projectTitle)) {
              targetProjectId = project.id;
              targetProjectName = project.title;
              logger.info(`Project found by partial match: ${targetProjectName} (ID: ${targetProjectId})`);
              break;
            }
          }
        }
      }
      
      if (!targetProjectId) {
        const normalizedText = transcription.toLowerCase();
        
        for (const project of projects) {
          const projectTitle = project.title.toLowerCase();
          if (normalizedText.includes(projectTitle)) {
            targetProjectId = project.id;
            targetProjectName = project.title;
            logger.info(`Project identified in full text: ${targetProjectName} (ID: ${targetProjectId})`);
            break;
          }
        }
      }
      
      if (!targetProjectId && projects.length > 0) {
        targetProjectId = projects[0].id;
        targetProjectName = projects[0].title;
        logger.info(`No project identified in text, using first: ${targetProjectName} (ID: ${targetProjectId})`);
      }
    } else if (targetProjectId) {
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
        response: language === 'en' 
          ? 'Could not create task because no projects are available. Please create a project first.'
          : 'No se pudo crear la tarea porque no hay proyectos disponibles. Por favor, crea primero un proyecto.'
      };
    }
    
    const taskDetails = await extractTaskDetailsWithClaude(transcription, language);
    
    if (!taskDetails.title || taskDetails.title.trim() === '') {
      const titleMatch = transcription.match(/(?:llamada|titulada|nombre|título|called|titled|named)\s+["']?([^"'.,]+)["']?/i);
      if (titleMatch && titleMatch[1]) {
        taskDetails.title = titleMatch[1].trim();
      } else {
        const possibleTitle = transcription
          .replace(/crear tarea|nueva tarea|crea una tarea|create task|new task/i, '')
          .replace(/en el proyecto|para el proyecto|in project|for project/i, '')
          .replace(targetProjectName, '')
          .trim();
        
        if (possibleTitle) {
          const words = possibleTitle.split(' ');
          taskDetails.title = words.slice(0, Math.min(5, words.length)).join(' ');
        } else {
          taskDetails.title = language === 'en' ? 'New task' : 'Nueva tarea';
        }
      }
    }
    
    if (!taskDetails.description || taskDetails.description.trim() === '') {
      taskDetails.description = language === 'en'
        ? `Task for ${taskDetails.title.toLowerCase()}${targetProjectName ? ` in project ${targetProjectName}` : ''}.`
        : `Tarea para ${taskDetails.title.toLowerCase()}${targetProjectName ? ` en el proyecto ${targetProjectName}` : ''}.`;
    }
    
    if (!taskDetails.completion_date) {
      taskDetails.completion_date = getDefaultDate();
    }
    
    const taskData = {
      title: taskDetails.title,
      description: taskDetails.description,
      status: taskDetails.status || 'pending',
      completion_date: taskDetails.completion_date,
      projectId: targetProjectId,
      creation_date: new Date()
    };
    
    logger.info(`Creating task with data: ${JSON.stringify(taskData)}`);
    
    const newTask = await Task.create(taskData);
    logger.info(`Task created successfully with ID: ${newTask.id}`);
    
    const statusText = language === 'en'
      ? (taskData.status === 'pending' ? 'pending' : taskData.status)
      : (taskData.status === 'pending' ? 'pendiente' : taskData.status);
    
    return {
      success: true,
      action: 'createTask',
      taskDetails: newTask.dataValues,
      response: language === 'en'
        ? `I've created the task "${taskData.title}" in project "${targetProjectName}". The task has a deadline of ${taskData.completion_date} and is in ${statusText} status.`
        : `He creado la tarea "${taskData.title}" en el proyecto "${targetProjectName}". La tarea tiene una fecha límite para el ${taskData.completion_date} y está en estado ${statusText}.`
    };
  } catch (error) {
    logger.error(`Error creating task: ${error.message}`);
    return {
      success: false,
      response: language === 'en'
        ? `Sorry, I couldn't create the task due to an error: ${error.message}. Please try to be more specific or verify that the mentioned project exists.`
        : `Lo siento, no pude crear la tarea debido a un error: ${error.message}. Por favor, intenta ser más específico o verifica que el proyecto mencionado exista.`
    };
  }
}

// ==================== EXTRAER DETALLES DE TAREA CON CLAUDE ====================
async function extractTaskDetailsWithClaude(transcription, language) {
  if (!openaiClient) {
    return { title: null, description: null, status: 'pending', completion_date: null };
  }
  
  try {
    const systemPrompt = language === 'en'
      ? `You are an assistant specialized in extracting task details for a project management system.
Your goal is to identify and extract specific information from voice commands to create tasks.
Do not invent information that is not clearly implicit in the text.
If you're unsure about any data, leave it as null so the system uses default values.

Possible task statuses are: "pending", "in_progress", "completed", and "cancelled".`
      : `Eres un asistente especializado en extraer detalles de tareas para un sistema de gestión de proyectos.
Tu objetivo es identificar y extraer información específica de comandos de voz para crear tareas.
No inventes información que no esté claramente implícita en el texto.
Si no estás seguro de algún dato, déjalo como null para que el sistema use valores predeterminados.

Los estados de tareas posibles son: "pending" (pendiente), "in_progress" (en progreso), "completed" (completada), y "cancelled" (cancelada).`;
    
    const userPrompt = language === 'en'
      ? `Analyze this transcription: "${transcription}"

Extract the task details that are being requested to create.

Return ONLY a JSON object with the fields:
- title: task title (extract the words that seem to be the title)
- description: description (null if not specified)
- status: status ("pending", "in_progress", "completed" or "cancelled")
- completion_date: due date in YYYY-MM-DD format

If there is no information about a field, leave it as null.
For completion_date, if a deadline is mentioned like "for tomorrow" or "in a week", calculate the corresponding date.`
      : `Analiza esta transcripción: "${transcription}"

Extrae los detalles de la tarea que se está solicitando crear.

Devuelve SOLO un objeto JSON con los campos:
- title: título de la tarea (extrae las palabras que parezcan ser el título)
- description: descripción (null si no está especificada)
- status: estado ("pending", "in_progress", "completed" o "cancelled")
- completion_date: fecha de vencimiento en formato YYYY-MM-DD

Si no hay información sobre algún campo, déjalo como null.
Para completion_date, si se menciona un plazo como "para mañana" o "en una semana", calcula la fecha correspondiente.`;
    
    const completion = await openaiClient.chat.completions.create({
      model: "claude-sonnet-4-20250514",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.1,
      max_tokens: 300,
    });
    
    const responseContent = completion.choices[0].message.content;
    const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const extractedData = JSON.parse(jsonMatch[0]);
      logger.info(`Task details extracted by Claude: ${JSON.stringify(extractedData)}`);
      return extractedData;
    } else {
      throw new Error('Could not extract JSON from response');
    }
  } catch (error) {
    logger.error(`Error extracting task details with Claude: ${error.message}`);
    return fallbackExtractTaskDetails(transcription, language);
  }
}

// ==================== FALLBACK: EXTRAER DETALLES DE TAREA SIN CLAUDE ====================
function fallbackExtractTaskDetails(transcription, language) {
  const lowercaseText = transcription.toLowerCase();
  
  let title = null;
  const titlePatterns = language === 'en'
    ? [
        /(?:task|activity)\s+(?:called|titled|named)\s+["']?([^"'.,]+)["']?/i,
        /(?:create|new)\s+(?:task|activity)\s+(?:called|titled|named)\s+["']?([^"'.,]+)["']?/i,
      ]
    : [
        /(?:tarea|actividad)\s+(?:llamada|titulada|que se llama|con nombre|con título)\s+["']?([^"'.,]+)["']?/i,
        /(?:crear|nueva)\s+(?:tarea|actividad)\s+(?:llamada|titulada|que se llama|con nombre|con título)\s+["']?([^"'.,]+)["']?/i,
      ];
  
  for (const pattern of titlePatterns) {
    const match = transcription.match(pattern);
    if (match && match[1]) {
      title = match[1].trim();
      break;
    }
  }
  
  let status = 'pending';
  if (language === 'en') {
    if (lowercaseText.includes('in progress') || lowercaseText.includes('started')) status = 'in_progress';
    else if (lowercaseText.includes('completed') || lowercaseText.includes('done')) status = 'completed';
    else if (lowercaseText.includes('cancelled')) status = 'cancelled';
  } else {
    if (lowercaseText.includes('en progreso') || lowercaseText.includes('iniciada')) status = 'in_progress';
    else if (lowercaseText.includes('completada') || lowercaseText.includes('terminada')) status = 'completed';
    else if (lowercaseText.includes('cancelada')) status = 'cancelled';
  }
  
  let description = null;
  let completionDate = null;
  const today = new Date();
  
  if (language === 'en') {
    if (lowercaseText.includes('tomorrow')) {
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      completionDate = formatDate(tomorrow);
    } else if (lowercaseText.includes('next week')) {
      const nextWeek = new Date(today);
      nextWeek.setDate(nextWeek.getDate() + 7);
      completionDate = formatDate(nextWeek);
    }
  } else {
    if (lowercaseText.includes('mañana')) {
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      completionDate = formatDate(tomorrow);
    } else if (lowercaseText.includes('próxima semana') || lowercaseText.includes('proxima semana')) {
      const nextWeek = new Date(today);
      nextWeek.setDate(nextWeek.getDate() + 7);
      completionDate = formatDate(nextWeek);
    }
  }
  
  if (!completionDate) {
    completionDate = getDefaultDate();
  }
  
  return { title, description, status, completion_date: completionDate };
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ==================== CREAR PROYECTO ====================
async function processCreateProjectCommand(transcription, language) {
  logger.info(`Processing create project command in ${language}`);
  
  try {
    const projectDetails = await extractProjectDetailsWithClaude(transcription, language);
    
    if (!projectDetails.title || projectDetails.title.trim() === '') {
      const titleMatch = transcription.match(/(?:llamado|titulado|nombre|título|called|titled|named)\s+["']?([^"'.,]+)["']?/i);
      if (titleMatch && titleMatch[1]) {
        projectDetails.title = titleMatch[1].trim();
      } else {
        const possibleTitle = transcription
          .replace(/crear proyecto|nuevo proyecto|create project|new project/i, '')
          .trim();
        
        if (possibleTitle) {
          const words = possibleTitle.split(' ');
          projectDetails.title = words.slice(0, Math.min(5, words.length)).join(' ');
        } else {
          projectDetails.title = language === 'en' ? 'New project' : 'Nuevo proyecto';
        }
      }
    }
    
    const existingProject = await Project.findOne({
      where: {
        title: {
          [Op.iLike]: projectDetails.title
        }
      }
    });
    
    if (existingProject) {
      logger.warn(`A project with the title "${projectDetails.title}" already exists`);
      return {
        success: false,
        response: language === 'en'
          ? `A project named "${projectDetails.title}" already exists. Do you want to create a project with a different name or update the existing one?`
          : `Ya existe un proyecto llamado "${projectDetails.title}". ¿Quieres crear un proyecto con un nombre diferente o actualizar el existente?`
      };
    }
    
    if (!projectDetails.description || projectDetails.description.trim() === '') {
      projectDetails.description = language === 'en'
        ? `Project to manage activities related to ${projectDetails.title.toLowerCase()}.`
        : `Proyecto para gestionar actividades relacionadas con ${projectDetails.title.toLowerCase()}.`;
    }
    
    if (!projectDetails.priority) {
      projectDetails.priority = 'medium';
    }
    
    const projectData = {
      title: projectDetails.title,
      description: projectDetails.description,
      priority: projectDetails.priority,
      culmination_date: projectDetails.culmination_date,
      creation_date: new Date()
    };
    
    logger.info(`Creating project with data: ${JSON.stringify(projectData)}`);
    
    const newProject = await Project.create(projectData);
    logger.info(`Project created successfully with ID: ${newProject.id}`);
    
    const priorityText = language === 'en'
      ? projectData.priority
      : (projectData.priority === 'high' ? 'alta' : projectData.priority === 'low' ? 'baja' : 'media');
    
    let responseMessage = language === 'en'
      ? `I've created the project "${projectData.title}" with ${priorityText} priority.`
      : `He creado el proyecto "${projectData.title}" con prioridad ${priorityText}.`;
    
    if (projectData.culmination_date) {
      responseMessage += language === 'en'
        ? ` The completion date is set for ${projectData.culmination_date}.`
        : ` La fecha de finalización está establecida para el ${projectData.culmination_date}.`;
    }
    
    responseMessage += language === 'en'
      ? ` You can now start adding tasks to this project.`
      : ` Ya puedes empezar a añadir tareas a este proyecto.`;
    
    return {
      success: true,
      action: 'createProject',
      projectDetails: newProject.dataValues,
      response: responseMessage
    };
  } catch (error) {
    logger.error(`Error creating project: ${error.message}`);
    return {
      success: false,
      response: language === 'en'
        ? `Sorry, I couldn't create the project due to an error: ${error.message}. Please try to be more specific.`
        : `Lo siento, no pude crear el proyecto debido a un error: ${error.message}. Por favor, intenta ser más específico.`
    };
  }
}

// ==================== EXTRAER DETALLES DE PROYECTO CON CLAUDE ====================
async function extractProjectDetailsWithClaude(transcription, language) {
  if (!openaiClient) {
    return { title: null, description: null, priority: 'medium', culmination_date: null };
  }
  
  try {
    const systemPrompt = language === 'en'
      ? `You are an assistant specialized in extracting project details for a management system.
Your goal is to identify and extract specific information from voice commands to create projects.
Do not invent information that is not clearly implicit in the text.
If you're unsure about any data, leave it as null so the system uses default values.`
      : `Eres un asistente especializado en extraer detalles de proyectos para un sistema de gestión.
Tu objetivo es identificar y extraer información específica de comandos de voz para crear proyectos.
No inventes información que no esté claramente implícita en el texto.
Si no estás seguro de algún dato, déjalo como null para que el sistema use valores predeterminados.`;
    
    const userPrompt = language === 'en'
      ? `Analyze this transcription: "${transcription}"

Extract the project details that are being requested to create.

Return ONLY a JSON object with the fields:
- title: project title (extract the words that seem to be the title)
- description: description (null if not specified)
- priority: priority ("high", "medium" or "low")
- culmination_date: deadline in YYYY-MM-DD format (null if not specified)

If there is no information about a field, leave it as null.
For culmination_date, if a deadline is mentioned like "by end of year", calculate the corresponding date.`
      : `Analiza esta transcripción: "${transcription}"

Extrae los detalles del proyecto que se está solicitando crear.

Devuelve SOLO un objeto JSON con los campos:
- title: título del proyecto (extrae las palabras que parezcan ser el título)
- description: descripción (null si no está especificada)
- priority: prioridad ("high", "medium" o "low")
- culmination_date: fecha límite en formato YYYY-MM-DD (null si no está especificada)

Si no hay información sobre algún campo, déjalo como null.
Para culmination_date, si se menciona un plazo como "para fin de año", calcula la fecha correspondiente.`;
    
    const completion = await openaiClient.chat.completions.create({
      model: "claude-sonnet-4-20250514",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.1,
      max_tokens: 300,
    });
    
    const responseContent = completion.choices[0].message.content;
    const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const extractedData = JSON.parse(jsonMatch[0]);
      logger.info(`Project details extracted by Claude: ${JSON.stringify(extractedData)}`);
      return extractedData;
    } else {
      throw new Error('Could not extract JSON from response');
    }
  } catch (error) {
    logger.error(`Error extracting project details with Claude: ${error.message}`);
    return { title: null, description: null, priority: 'medium', culmination_date: null };
  }
}

// ==================== BUSCAR TAREAS ====================
async function processSearchTaskCommand(transcription, projectId, language) {
  logger.info(`Processing search task command in ${language}`);
  
  try {
    const searchParams = await extractSearchParams(transcription, projectId, language);
    
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
    
    if (searchParams.projectId) {
      whereClause.projectId = searchParams.projectId;
    }
    
    logger.info(`Searching tasks with criteria: ${JSON.stringify(whereClause)}`);
    
    const tasks = await Task.findAll({
      where: whereClause,
      include: [
        {
          model: Project,
          attributes: ['id', 'title']
        }
      ],
      limit: 10
    });
    
    logger.info(`Found ${tasks.length} matching tasks`);
    
    const searchResults = tasks.map(task => ({
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      completion_date: task.completion_date,
      projectName: task.Project ? task.Project.title : (language === 'en' ? 'Unknown' : 'Desconocido')
    }));
    
    let responseMessage;
    
    if (searchResults.length === 0) {
      if (searchParams.searchTerm) {
        responseMessage = language === 'en'
          ? `I didn't find any tasks related to "${searchParams.searchTerm}". Do you want to try other search terms?`
          : `No encontré ninguna tarea relacionada con "${searchParams.searchTerm}". ¿Quieres probar con otros términos de búsqueda?`;
      } else {
        responseMessage = language === 'en'
          ? `I didn't find any tasks matching your search. Try other criteria or create new tasks.`
          : `No encontré ninguna tarea que coincida con tu búsqueda. Intenta con otros criterios o crea nuevas tareas.`;
      }
    } else {
      responseMessage = language === 'en'
        ? `I found ${searchResults.length} task${searchResults.length === 1 ? '' : 's'}`
        : `He encontrado ${searchResults.length} tarea${searchResults.length === 1 ? '' : 's'}`;
      
      if (searchParams.searchTerm) {
        responseMessage += language === 'en'
          ? ` related to "${searchParams.searchTerm}"`
          : ` relacionada${searchResults.length === 1 ? '' : 's'} con "${searchParams.searchTerm}"`;
      }
      
      if (searchParams.status) {
        const statusText = language === 'en'
          ? searchParams.status
          : {
              'pending': 'pendiente',
              'in_progress': 'en progreso',
              'completed': 'completada',
              'cancelled': 'cancelada'
            }[searchParams.status] || searchParams.status;
        
        responseMessage += language === 'en'
          ? ` with ${statusText} status`
          : ` con estado ${statusText}`;
      }
      
      responseMessage += language === 'en' ? `. The tasks are:` : `. Las tareas son:`;
      
      const summaryCount = Math.min(3, searchResults.length);
      for (let i = 0; i < summaryCount; i++) {
        const task = searchResults[i];
        responseMessage += `\n- "${task.title}" (${task.projectName})`;
      }
      
      if (searchResults.length > summaryCount) {
        responseMessage += language === 'en'
          ? `\n...and ${searchResults.length - summaryCount} more.`
          : `\n...y ${searchResults.length - summaryCount} más.`;
      }
    }
    
    return {
      success: true,
      action: 'searchTasks',
      searchParams,
      searchResults,
      response: responseMessage
    };
  } catch (error) {
    logger.error(`Error searching tasks: ${error.message}`);
    return {
      success: false,
      response: language === 'en'
        ? `Sorry, I couldn't complete the search due to an error: ${error.message}. Please try a different query.`
        : `Lo siento, no pude completar la búsqueda debido a un error: ${error.message}. Por favor, intenta con una consulta diferente.`
    };
  }
}

// ==================== EXTRAER PARÁMETROS DE BÚSQUEDA ====================
async function extractSearchParams(transcription, projectId, language) {
  const lowercaseText = transcription.toLowerCase();
  
  let searchTerm = null;
  const keywords = language === 'en'
    ? ['search', 'find', 'show', 'list', 'view', 'related', 'about', 'with']
    : ['buscar', 'encontrar', 'mostrar', 'listar', 'ver', 'relacionadas', 'sobre', 'que tengan', 'de', 'con'];
  
  for (const keyword of keywords) {
    if (lowercaseText.includes(keyword)) {
      const regex = new RegExp(`${keyword}\\s+(?:tasks?|tareas?|activities|actividades)?\\s+(?:about|sobre|de|con|related|relacionadas)?\\s+["']?([^"'.,]+)["']?`, 'i');
      const match = transcription.match(regex);
      
      if (match && match[1]) {
        searchTerm = match[1].trim();
        break;
      }
    }
  }
  
  if (!searchTerm && (lowercaseText.includes('tasks') || lowercaseText.includes('tareas'))) {
    const afterTasksMatch = transcription.match(/(?:tasks|tareas)\s+(?:de|sobre|con|of|about|related)?\s+(.+?)(?:\.|$)/i);
    if (afterTasksMatch) {
      searchTerm = afterTasksMatch[1].trim();
    }
  }
  
  let status = null;
  if (language === 'en') {
    if (lowercaseText.includes('pending')) status = 'pending';
    else if (lowercaseText.includes('in progress')) status = 'in_progress';
    else if (lowercaseText.includes('completed') || lowercaseText.includes('done')) status = 'completed';
    else if (lowercaseText.includes('cancelled')) status = 'cancelled';
  } else {
    if (lowercaseText.includes('pendiente')) status = 'pending';
    else if (lowercaseText.includes('en progreso')) status = 'in_progress';
    else if (lowercaseText.includes('completada') || lowercaseText.includes('terminada')) status = 'completed';
    else if (lowercaseText.includes('cancelada')) status = 'cancelled';
  }
  
  return {
    searchTerm,
    status,
    projectId
  };
}

// ==================== BUSCAR PROYECTOS ====================
async function processSearchProjectCommand(transcription, language) {
  logger.info(`Processing search project command in ${language}`);
  
  try {
    let searchTerm = null;
    const searchTermPattern = language === 'en'
      ? /(?:search|find|show|list|view)\s+(?:projects?)?(?:\s+(?:about|related to|with))?\s+["']?([^"'.,]+)["']?/i
      : /(?:buscar|encontrar|mostrar|listar|ver)\s+(?:proyectos?|planes?)?(?:\s+(?:sobre|de|con|relacionad[oa]s?\s+con))?\s+["']?([^"'.,]+)["']?/i;
    
    const match = transcription.match(searchTermPattern);
    if (match && match[1]) {
      searchTerm = match[1].trim();
    } else {
      const afterProjectsMatch = transcription.match(/(?:projects|proyectos)\s+(?:about|sobre|de|con|related to|relacionados?\s+con)?\s+["']?([^"'.,]+)["']?/i);
      if (afterProjectsMatch && afterProjectsMatch[1]) {
        searchTerm = afterProjectsMatch[1].trim();
      }
    }
    
    if (!searchTerm) {
      return {
        success: false,
        response: language === 'en'
          ? `I couldn't identify what criteria to use to search for projects. Please specify which projects you want to find.`
          : `No pude identificar qué criterios usar para buscar proyectos. Por favor, especifica qué proyectos quieres encontrar.`
      };
    }
    
    logger.info(`Searching projects with term: ${searchTerm}`);
    
    const projects = await Project.findAll({
      where: {
        [Op.or]: [
          { title: { [Op.iLike]: `%${searchTerm}%` } },
          { description: { [Op.iLike]: `%${searchTerm}%` } }
        ]
      },
      include: [
        {
          model: Task,
          required: false
        }
      ]
    });
    
    logger.info(`Found ${projects.length} matching projects`);
    
    const searchResults = projects.map(project => {
      const taskCount = project.Tasks ? project.Tasks.length : 0;
      return {
        id: project.id,
        title: project.title,
        description: project.description,
        priority: project.priority,
        culmination_date: project.culmination_date,
        taskCount
      };
    });
    
    let responseMessage;
    
    if (searchResults.length === 0) {
      responseMessage = language === 'en'
        ? `I didn't find any projects related to "${searchTerm}". Do you want to try other search terms or create a new project?`
        : `No encontré ningún proyecto relacionado con "${searchTerm}". ¿Quieres probar con otros términos de búsqueda o crear un nuevo proyecto?`;
    } else {
      responseMessage = language === 'en'
        ? `I found ${searchResults.length} project${searchResults.length === 1 ? '' : 's'} related to "${searchTerm}":`
        : `He encontrado ${searchResults.length} proyecto${searchResults.length === 1 ? '' : 's'} relacionado${searchResults.length === 1 ? '' : 's'} con "${searchTerm}":`;
      
      for (const project of searchResults) {
        const priorityText = language === 'en'
          ? project.priority || 'not specified'
          : (project.priority === 'high' ? 'alta' : project.priority === 'low' ? 'baja' : project.priority === 'medium' ? 'media' : 'no especificada');
        
        responseMessage += language === 'en'
          ? `\n- "${project.title}" (priority: ${priorityText}) with ${project.taskCount} task${project.taskCount === 1 ? '' : 's'}`
          : `\n- "${project.title}" (prioridad: ${priorityText}) con ${project.taskCount} tarea${project.taskCount === 1 ? '' : 's'}`;
      }
    }
    
    return {
      success: true,
      action: 'searchProjects',
      searchTerm,
      searchResults,
      response: responseMessage
    };
  } catch (error) {
    logger.error(`Error searching projects: ${error.message}`);
    return {
      success: false,
      response: language === 'en'
        ? `Sorry, I couldn't complete the project search due to an error: ${error.message}. Please try a different query.`
        : `Lo siento, no pude completar la búsqueda de proyectos debido a un error: ${error.message}. Por favor, intenta con una consulta diferente.`
    };
  }
}

// ==================== ACTUALIZAR TAREA ====================
async function processUpdateTaskCommand(transcription, projects, language) {
  logger.info(`Processing update task command in ${language}`);
  
  try {
    let projectTitle = null;
    let projectId = null;
    
    const projectMention = transcription.match(/(?:proyecto|plan|project|plan)\s+["']?([^"'.,]+)["']?/i);
    if (projectMention && projectMention[1]) {
      projectTitle = projectMention[1].trim();
      logger.info(`Project mentioned: ${projectTitle}`);
      
      if (projects && projects.length > 0) {
        for (const project of projects) {
          if (project.title.toLowerCase() === projectTitle.toLowerCase() || 
              project.title.toLowerCase().includes(projectTitle.toLowerCase()) || 
              projectTitle.toLowerCase().includes(project.title.toLowerCase())) {
            projectId = project.id;
            projectTitle = project.title;
            logger.info(`Project identified: ${projectTitle} (ID: ${projectId})`);
            break;
          }
        }
      }
    }
    
    let updateDetails = await extractUpdateDetails(transcription, language);
    
    if (!updateDetails.taskIdentifier) {
      const taskMention = transcription.match(/(?:tarea|actividad|task|activity)\s+["']?([^"'.,]+)["']?/i);
      if (taskMention && taskMention[1]) {
        updateDetails.taskIdentifier = taskMention[1].trim();
        logger.info(`Task identifier extracted manually: ${updateDetails.taskIdentifier}`);
      } else {
        logger.error('No task identifier found in command');
        return {
          success: false,
          response: language === 'en'
            ? 'I couldn\'t identify which task you want to update. Please mention the name or ID of the task you want to modify.'
            : 'No pude identificar qué tarea deseas actualizar. Por favor, menciona el nombre o ID de la tarea que quieres modificar.'
        };
      }
    }
    
    logger.info(`Searching for task with identifier: ${updateDetails.taskIdentifier}`);
    
    let task;
    let whereClause = {};
    
    if (!isNaN(updateDetails.taskIdentifier)) {
      task = await Task.findByPk(parseInt(updateDetails.taskIdentifier), {
        include: [{ model: Project }]
      });
    } else {
      whereClause = {
        title: {
          [Op.iLike]: updateDetails.taskIdentifier
        }
      };
      
      if (projectId) {
        whereClause.projectId = projectId;
      }
      
      task = await Task.findOne({
        where: whereClause,
        include: [{ model: Project }]
      });
      
      if (!task) {
        whereClause = {
          title: {
            [Op.iLike]: `%${updateDetails.taskIdentifier}%`
          }
        };
        
        if (projectId) {
          whereClause.projectId = projectId;
        }
        
        task = await Task.findOne({
          where: whereClause,
          include: [{ model: Project }]
        });
      }
      
      if (!task) {
        const keywords = updateDetails.taskIdentifier.split(' ');
        if (keywords.length > 0) {
          const mainKeyword = keywords[0];
          
          whereClause = {
            title: {
              [Op.iLike]: `%${mainKeyword}%`
            }
          };
          
          if (projectId) {
            whereClause.projectId = projectId;
          }
          
          const possibleTasks = await Task.findAll({
            where: whereClause,
            include: [{ model: Project }],
            limit: 5
          });
          
          if (possibleTasks.length > 0) {
            task = possibleTasks[0];
            for (const possibleTask of possibleTasks) {
              const taskTitle = possibleTask.title.toLowerCase();
              const taskIdentifier = updateDetails.taskIdentifier.toLowerCase();
              
              let matchCount = 0;
              for (const word of keywords) {
                if (taskTitle.includes(word.toLowerCase())) {
                  matchCount++;
                }
              }
              
              if (matchCount > 0) {
                task = possibleTask;
                break;
              }
            }
          }
        }
      }
    }
    
    if (!task) {
      logger.error(`No task found matching: ${updateDetails.taskIdentifier}`);
      return {
        success: false,
        response: language === 'en'
          ? `I didn't find any task matching "${updateDetails.taskIdentifier}". Please verify the task name or ID and try again.`
          : `No encontré ninguna tarea que coincida con "${updateDetails.taskIdentifier}". Por favor, verifica el nombre o ID de la tarea e intenta de nuevo.`
      };
    }
    
    logger.info(`Task found: ${task.id} - ${task.title}`);
    
    if (!updateDetails.updates || Object.keys(updateDetails.updates).length === 0) {
      const lowercaseText = transcription.toLowerCase();
      
      if (lowercaseText.includes('completa') || lowercaseText.includes('complete') ||
          lowercaseText.includes('completar') || lowercaseText.includes('completada') || 
          lowercaseText.includes('completado') || lowercaseText.includes('completed') ||
          lowercaseText.includes('finalizar') || lowercaseText.includes('finish') ||
          lowercaseText.includes('terminar') || lowercaseText.includes('done')) {
        updateDetails.updates = { status: 'completed' };
        logger.info('Detected intention to mark as completed, applying status update');
      } else if (lowercaseText.includes('progreso') || lowercaseText.includes('progress') ||
                lowercaseText.includes('iniciar') || lowercaseText.includes('start') ||
                lowercaseText.includes('comenzar') || lowercaseText.includes('begin') ||
                lowercaseText.includes('empezar')) {
        updateDetails.updates = { status: 'in_progress' };
        logger.info('Detected intention to mark as in progress, applying status update');
      } else if (lowercaseText.includes('cancelar') || lowercaseText.includes('cancel') ||
                lowercaseText.includes('cancelada') || lowercaseText.includes('cancelled') ||
                lowercaseText.includes('cancelado') || lowercaseText.includes('canceled') ||
                lowercaseText.includes('suspender') || lowercaseText.includes('suspend')) {
        updateDetails.updates = { status: 'cancelled' };
        logger.info('Detected intention to mark as cancelled, applying status update');
      } else if (lowercaseText.includes('pendiente') || lowercaseText.includes('pending')) {
        updateDetails.updates = { status: 'pending' };
        logger.info('Detected intention to mark as pending, applying status update');
      } else {
        if (lowercaseText.includes('estado') || lowercaseText.includes('estatus') || lowercaseText.includes('status')) {
          if (lowercaseText.includes(' a ') || lowercaseText.includes(' to ')) {
            const afterStatusMatch = transcription.match(/(?:estado|estatus|status)\s+(?:a|to)\s+(.+?)(?:\.|$)/i);
            if (afterStatusMatch && afterStatusMatch[1]) {
              const statusText = afterStatusMatch[1].trim().toLowerCase();
              
              if (statusText.includes('completa') || statusText.includes('complete') || statusText.includes('terminad') || statusText.includes('done')) {
                updateDetails.updates = { status: 'completed' };
              } else if (statusText.includes('progreso') || statusText.includes('progress')) {
                updateDetails.updates = { status: 'in_progress' };
              } else if (statusText.includes('cancela') || statusText.includes('cancel') || statusText.includes('suspendid') || statusText.includes('suspend')) {
                updateDetails.updates = { status: 'cancelled' };
              } else if (statusText.includes('pendiente') || statusText.includes('pending')) {
                updateDetails.updates = { status: 'pending' };
              }
            }
          }
        }
      }
      
      if (!updateDetails.updates || Object.keys(updateDetails.updates).length === 0) {
        logger.error('No updates specified in command');
        return {
          success: false,
          response: language === 'en'
            ? `I couldn't identify what changes you want to make to the task "${task.title}". Please specify what you want to update (title, description, status, date).`
            : `No pude identificar qué cambios quieres hacer a la tarea "${task.title}". Por favor, especifica qué quieres actualizar (título, descripción, estado, fecha).`
        };
      }
    }
    
    logger.info(`Updating task ${task.id} with: ${JSON.stringify(updateDetails.updates)}`);
    
    const oldStatus = task.status;
    
    await task.update(updateDetails.updates);
    
    let responseMessage = language === 'en'
      ? `I've updated the task "${task.title}"`
      : `He actualizado la tarea "${task.title}"`;
    
    if (updateDetails.updates.title) {
      responseMessage += language === 'en'
        ? `, changing its title to "${updateDetails.updates.title}"`
        : `, cambiando su título a "${updateDetails.updates.title}"`;
    }
    
    if (updateDetails.updates.status && oldStatus !== updateDetails.updates.status) {
      const statusText = language === 'en'
        ? {
            'pending': 'pending',
            'in_progress': 'in progress',
            'completed': 'completed',
            'cancelled': 'cancelled'
          }[updateDetails.updates.status] || updateDetails.updates.status
        : {
            'pending': 'pendiente',
            'in_progress': 'en progreso',
            'completed': 'completada',
            'cancelled': 'cancelada'
          }[updateDetails.updates.status] || updateDetails.updates.status;
      
      responseMessage += language === 'en'
        ? `, marking it as ${statusText}`
        : `, marcándola como ${statusText}`;
    }
    
    if (updateDetails.updates.description) {
      responseMessage += language === 'en'
        ? `, updating its description`
        : `, actualizando su descripción`;
    }
    
    if (updateDetails.updates.completion_date) {
      responseMessage += language === 'en'
        ? `, setting its deadline for ${updateDetails.updates.completion_date}`
        : `, estableciendo su fecha límite para el ${updateDetails.updates.completion_date}`;
    }
    
    responseMessage += `.`;
    
    return {
      success: true,
      action: 'updateTask',
      taskDetails: {
        id: task.id,
        title: task.title,
        description: task.description,
        status: task.status,
        completion_date: task.completion_date,
        projectName: task.Project ? task.Project.title : (language === 'en' ? 'Unknown' : 'Desconocido')
      },
      response: responseMessage
    };
  } catch (error) {
    logger.error(`Error updating task: ${error.message}`);
    return {
      success: false,
      response: language === 'en'
        ? `Sorry, I couldn't update the task due to an error: ${error.message}.`
        : `Lo siento, no pude actualizar la tarea debido a un error: ${error.message}.`
    };
  }
}

// ==================== EXTRAER DETALLES DE ACTUALIZACIÓN ====================
async function extractUpdateDetails(transcription, language) {
  if (!openaiClient) {
    return fallbackExtractUpdateDetails(transcription, language);
  }
  
  try {
    const systemPrompt = language === 'en'
      ? `You are a specialist in updating tasks. Extract update details from voice commands.
Your goal is to identify which task to update and which fields to modify.
Do not invent information that is not clearly implicit in the text.`
      : `Eres un especialista en actualización de tareas. Extrae detalles de actualización de comandos de voz.
Tu objetivo es identificar qué tarea se quiere actualizar y qué campos se quieren modificar.
No inventes información que no esté claramente implícita en el texto.`;
    
    const userPrompt = language === 'en'
      ? `Extract the following details from this voice command: "${transcription}"

Return ONLY a JSON object with these fields:
- taskIdentifier: words that identify which task to update (name or ID)
- updates: an object with the fields to update, which can include:
  - title: new title
  - description: new description
  - status: new status ("in_progress", "completed", "pending", "cancelled")
  - completion_date: new deadline in YYYY-MM-DD format

Only include fields in 'updates' that will actually be changed according to the command.
If "in progress" is mentioned, use "in_progress" for status.
If "complete", "completed" or "done" is mentioned, use "completed" for status.
If "pending" is mentioned, use "pending" for status.
If "cancel", "cancelled" or "canceled" is mentioned, use "cancelled" for status.`
      : `Extrae los siguientes detalles de este comando de voz: "${transcription}"

Devuelve SOLO un objeto JSON con estos campos:
- taskIdentifier: palabras que identifican qué tarea actualizar (nombre o ID)
- updates: un objeto con los campos a actualizar, que pueden incluir:
  - title: nuevo título
  - description: nueva descripción
  - status: nuevo estado ("in_progress", "completed", "pending", "cancelled")
  - completion_date: nueva fecha límite en formato YYYY-MM-DD

Solo incluye campos en 'updates' que realmente se vayan a cambiar según el comando.
Si "en progreso" se menciona, usa "in_progress" para status.
Si "completar", "completada" o "completado" se menciona, usa "completed" para status.
Si "pendiente" se menciona, usa "pending" para status.
Si "cancelar", "cancelada" o "cancelado" se menciona, usa "cancelled" para status.`;
    
    const completion = await openaiClient.chat.completions.create({
      model: "claude-sonnet-4-20250514",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.1,
      max_tokens: 300,
    });
    
    const responseContent = completion.choices[0].message.content;
    const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const extractedData = JSON.parse(jsonMatch[0]);
      logger.info(`Update details extracted by Claude: ${JSON.stringify(extractedData)}`);
      return extractedData;
    } else {
      throw new Error('Could not extract JSON from response');
    }
  } catch (error) {
    logger.error(`Error extracting update details with Claude: ${error.message}`);
    return fallbackExtractUpdateDetails(transcription, language);
  }
}

// ==================== FALLBACK: EXTRAER DETALLES DE ACTUALIZACIÓN ====================
function fallbackExtractUpdateDetails(transcription, language) {
  const lowercaseText = transcription.toLowerCase();
  
  let taskIdentifier = null;
  
  const patterns = language === 'en'
    ? [
        /(?:update|modify|change|edit|mark)\s+(?:the\s+)?(?:task|activity)\s+(?:called |titled |named |number |id )?["']?([^"'.,]+)["']?/i,
        /(?:task|activity)\s+(?:called |titled |named |number |id )?["']?([^"'.,]+)["']?/i,
      ]
    : [
        /(?:actualizar|modificar|cambiar|editar|cambia|marca|marcar)\s+(?:la\s+)?(?:tarea|actividad)\s+(?:llamada |titulada |con nombre |con título |número |id )?["']?([^"'.,]+)["']?/i,
        /(?:tarea|actividad)\s+(?:llamada |titulada |con nombre |con título |número |id )?["']?([^"'.,]+)["']?/i,
      ];
  
  for (const pattern of patterns) {
    const match = transcription.match(pattern);
    if (match && match[1]) {
      taskIdentifier = match[1].trim();
      break;
    }
  }
  
  const updates = {};
  
  if (language === 'en') {
    if (lowercaseText.includes('pending')) updates.status = 'pending';
    else if (lowercaseText.includes('in progress')) updates.status = 'in_progress';
    else if (lowercaseText.includes('completed') || lowercaseText.includes('done')) updates.status = 'completed';
    else if (lowercaseText.includes('cancelled') || lowercaseText.includes('canceled')) updates.status = 'cancelled';
  } else {
    if (lowercaseText.includes('pendiente')) updates.status = 'pending';
    else if (lowercaseText.includes('en progreso')) updates.status = 'in_progress';
    else if (lowercaseText.includes('completada') || lowercaseText.includes('completar') || lowercaseText.includes('terminada')) updates.status = 'completed';
    else if (lowercaseText.includes('cancelada') || lowercaseText.includes('cancelar')) updates.status = 'cancelled';
  }
  
  return {
    taskIdentifier,
    updates
  };
}

// ==================== ACTUALIZAR PROYECTO ====================
async function processUpdateProjectCommand(transcription, language) {
  logger.info(`Processing update project command in ${language}`);
  
  try {
    let projectIdentifier = null;
    let updates = {};
    
    const lowercaseText = transcription.toLowerCase();
    
    const projectPatterns = language === 'en'
      ? [
          /(?:project|plan)\s+["']?([^"'.,]+?)(?:\s+to\s+|\s+as\s+|\s+with\s+|\s+for\s+|$)/i,
          /(?:update|change|modify|edit)\s+(?:the\s+)?(?:project\s+)?["']?([^"'.,]+?)(?:\s+to\s+|\s+as\s+|\s+with\s+|\s+for\s+|$)/i,
        ]
      : [
          /(?:proyecto|plan)\s+["']?([^"'.,]+?)(?:\s+a\s+|\s+como\s+|\s+con\s+|\s+para\s+|$)/i,
          /(?:actualizar|cambiar|modificar|editar)\s+(?:el\s+)?(?:proyecto\s+)?["']?([^"'.,]+?)(?:\s+a\s+|\s+como\s+|\s+con\s+|\s+para\s+|$)/i,
        ];
    
    for (const pattern of projectPatterns) {
      const match = transcription.match(pattern);
      if (match && match[1]) {
        projectIdentifier = match[1].trim();
        logger.info(`Project identifier extracted: ${projectIdentifier}`);
        break;
      }
    }
    
    if (!projectIdentifier) {
      logger.error('No project identifier found in command');
      return {
        success: false,
        response: language === 'en'
          ? 'I couldn\'t identify which project you want to update. Please mention the name or ID of the project you want to modify.'
          : 'No pude identificar qué proyecto deseas actualizar. Por favor, menciona el nombre o ID del proyecto que quieres modificar.'
      };
    }
    
    if (lowercaseText.includes('prioridad') || lowercaseText.includes('priority')) {
      if (lowercaseText.includes('alta') || lowercaseText.includes('high') || lowercaseText.includes('urgent')) {
        updates.priority = 'high';
      } else if (lowercaseText.includes('baja') || lowercaseText.includes('low')) {
        updates.priority = 'low';
      } else if (lowercaseText.includes('media') || lowercaseText.includes('medium') || 
                lowercaseText.includes('medio') || lowercaseText.includes('normal')) {
        updates.priority = 'medium';
      }
    }
    
    if (lowercaseText.includes('título') || lowercaseText.includes('titulo') || 
        lowercaseText.includes('title') || lowercaseText.includes('nombre') || 
        lowercaseText.includes('name')) {
      const titlePatterns = language === 'en'
        ? [
            /(?:title|name)\s+(?:to|as)\s+["']?([^"'.,]+)["']?/i,
            /(?:change|update)\s+(?:to|as)\s+["']?([^"'.,]+)["']?/i,
          ]
        : [
            /(?:título|titulo|nombre)\s+(?:a|por|como)\s+["']?([^"'.,]+)["']?/i,
            /(?:cambiar|actualizar)\s+(?:a|por|como)\s+["']?([^"'.,]+)["']?/i,
          ];
      
      for (const pattern of titlePatterns) {
        const match = transcription.match(pattern);
        if (match && match[1]) {
          updates.title = match[1].trim();
          logger.info(`Title extracted: ${updates.title}`);
          break;
        }
      }
      
      if (!updates.title && (lowercaseText.includes(' a ') || lowercaseText.includes(' to '))) {
        const afterAMatch = transcription.match(/\s(?:a|to)\s+["']?([^"'.,]+)["']?/i);
        if (afterAMatch && afterAMatch[1] && 
            !afterAMatch[1].toLowerCase().startsWith('prioridad') && 
            !afterAMatch[1].toLowerCase().startsWith('priority') &&
            !afterAMatch[1].toLowerCase().includes('fecha') &&
            !afterAMatch[1].toLowerCase().includes('date')) {
          updates.title = afterAMatch[1].trim();
          logger.info(`Title extracted after "a/to": ${updates.title}`);
        }
      }
    }
    
    if (lowercaseText.includes('descripción') || lowercaseText.includes('descripcion') || lowercaseText.includes('description')) {
      const descPattern = language === 'en'
        ? /(?:description)\s+(?:to|as)\s+["']?([^"'.,]+)["']?/i
        : /(?:descripción|descripcion)\s+(?:a|por|como)\s+["']?([^"'.,]+)["']?/i;
      
      const descMatch = transcription.match(descPattern);
      if (descMatch && descMatch[1]) {
        updates.description = descMatch[1].trim();
      }
    }
    
    if (lowercaseText.includes('fecha') || lowercaseText.includes('date') ||
        lowercaseText.includes('culminación') || lowercaseText.includes('culminacion') || 
        lowercaseText.includes('deadline') || lowercaseText.includes('vencimiento') || 
        lowercaseText.includes('finalización') || lowercaseText.includes('completion')) {
      const currentYear = new Date().getFullYear();
      
      const dateMatch = transcription.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
      if (dateMatch) {
        const day = parseInt(dateMatch[1]);
        const month = parseInt(dateMatch[2]) - 1;
        let year = dateMatch[3] ? parseInt(dateMatch[3]) : currentYear;
        
        if (year < 100) {
          year += year < 50 ? 2000 : 1900;
        }
        
        const date = new Date(year, month, day);
        updates.culmination_date = formatDate(date);
      } else if (lowercaseText.includes('fin de año') || lowercaseText.includes('final de año') || lowercaseText.includes('end of year')) {
        updates.culmination_date = `${currentYear}-12-31`;
      } else if (lowercaseText.includes('próximo mes') || lowercaseText.includes('proximo mes') || lowercaseText.includes('next month')) {
        const nextMonth = new Date();
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        updates.culmination_date = formatDate(nextMonth);
      }
    }
    
    if (Object.keys(updates).length === 0 && 
        (lowercaseText.includes('cambiar') || lowercaseText.includes('change') ||
         lowercaseText.includes('actualizar') || lowercaseText.includes('update') ||
         lowercaseText.includes('modificar') || lowercaseText.includes('modify'))) {
      
      if (lowercaseText.includes(' a ') || lowercaseText.includes(' to ')) {
        const afterAMatch = transcription.match(/\s(?:a|to)\s+["']?([^"'.,]+)["']?/i);
        if (afterAMatch && afterAMatch[1]) {
          updates.title = afterAMatch[1].trim();
          logger.info(`Title inferred after "a/to": ${updates.title}`);
        }
      }
    }
    
    if (Object.keys(updates).length === 0) {
      logger.error('No updates specified in command');
      return {
        success: false,
        response: language === 'en'
          ? `I couldn't identify what changes you want to make to the project "${projectIdentifier}". Please specify what you want to update (title, description, priority, date).`
          : `No pude identificar qué cambios quieres hacer al proyecto "${projectIdentifier}". Por favor, especifica qué quieres actualizar (título, descripción, prioridad, fecha).`
      };
    }
    
    let project;
    
    if (!isNaN(projectIdentifier)) {
      project = await Project.findByPk(parseInt(projectIdentifier));
    } else {
      project = await Project.findOne({
        where: {
          title: {
            [Op.iLike]: `%${projectIdentifier}%`
          }
        }
      });
      
      if (!project) {
        const keywords = projectIdentifier.split(' ');
        if (keywords.length > 0) {
          const mainKeyword = keywords[0];
          
          const possibleProjects = await Project.findAll({
            where: {
              title: {
                [Op.iLike]: `%${mainKeyword}%`
              }
            },
            limit: 5
          });
          
          if (possibleProjects.length > 0) {
            project = possibleProjects[0];
          }
        }
      }
    }
    
    if (!project) {
      logger.error(`No project found matching: ${projectIdentifier}`);
      return {
        success: false,
        response: language === 'en'
          ? `I didn't find any project matching "${projectIdentifier}". Please verify the project name or ID and try again.`
          : `No encontré ningún proyecto que coincida con "${projectIdentifier}". Por favor, verifica el nombre o ID del proyecto e intenta de nuevo.`
      };
    }
    
    logger.info(`Updating project ${project.id} with: ${JSON.stringify(updates)}`);
    
    const oldPriority = project.priority;
    
    await project.update(updates);
    
    let responseMessage = language === 'en'
      ? `I've updated the project "${project.title}"`
      : `He actualizado el proyecto "${project.title}"`;
    
    if (updates.title) {
      responseMessage += language === 'en'
        ? `, changing its title to "${updates.title}"`
        : `, cambiando su título a "${updates.title}"`;
    }
    
    if (updates.priority && oldPriority !== updates.priority) {
      const priorityText = language === 'en'
        ? updates.priority
        : {
            'high': 'alta',
            'medium': 'media',
            'low': 'baja'
          }[updates.priority] || updates.priority;
      
      responseMessage += language === 'en'
        ? `, setting its priority to ${priorityText}`
        : `, estableciendo su prioridad a ${priorityText}`;
    }
    
    if (updates.description) {
      responseMessage += language === 'en'
        ? `, updating its description`
        : `, actualizando su descripción`;
    }
    
    if (updates.culmination_date) {
      responseMessage += language === 'en'
        ? `, setting its completion date for ${updates.culmination_date}`
        : `, estableciendo su fecha de finalización para el ${updates.culmination_date}`;
    }
    
    responseMessage += `.`;
    
    return {
      success: true,
      action: 'updateProject',
      projectDetails: project.dataValues,
      response: responseMessage
    };
  } catch (error) {
    logger.error(`Error updating project: ${error.message}`);
    return {
      success: false,
      response: language === 'en'
        ? `Sorry, I couldn't update the project due to an error: ${error.message}.`
        : `Lo siento, no pude actualizar el proyecto debido a un error: ${error.message}.`
    };
  }
}

// ==================== CONTAR TAREAS ====================
async function processCountTasksCommand(language) {
  logger.info(`Processing count tasks command in ${language}`);
  
  try {
    const taskCount = await Task.count();
    logger.info(`Total tasks: ${taskCount}`);
    
    const pendingTasks = await Task.count({ where: { status: 'pending' } });
    const inProgressTasks = await Task.count({ where: { status: 'in_progress' } });
    const completedTasks = await Task.count({ where: { status: 'completed' } });
    const cancelledTasks = await Task.count({ where: { status: 'cancelled' } });
    
    const totalByStatus = pendingTasks + inProgressTasks + completedTasks + cancelledTasks;
    if (totalByStatus !== taskCount) {
      logger.warn(`Discrepancy in task count: total=${taskCount}, sum of statuses=${totalByStatus}`);
    }
    
    const projects = await Project.findAll({
      include: [
        {
          model: Task,
          attributes: ['id', 'status']
        }
      ]
    });
    
    const tasksByProject = projects.map(project => {
      const projectTasks = project.Tasks || [];
      return {
        projectId: project.id,
        projectName: project.title,
        taskCount: projectTasks.length,
        pendingCount: projectTasks.filter(task => task.status === 'pending').length,
        inProgressCount: projectTasks.filter(task => task.status === 'in_progress').length,
        completedCount: projectTasks.filter(task => task.status === 'completed').length,
        cancelledCount: projectTasks.filter(task => task.status === 'cancelled').length
      };
    });
    
    let responseMessage;
    
    if (taskCount === 0) {
      responseMessage = language === 'en'
        ? 'You have no tasks in the system. Do you want to create a new task?'
        : 'No tienes ninguna tarea en el sistema. ¿Quieres crear una nueva tarea?';
    } else {
      responseMessage = language === 'en'
        ? `You currently have ${taskCount} task${taskCount === 1 ? '' : 's'} total in the system. `
        : `Actualmente tienes ${taskCount} tarea${taskCount === 1 ? '' : 's'} en total en el sistema. `;
      
      responseMessage += language === 'en'
        ? `Of those, ${pendingTasks} ${pendingTasks === 1 ? 'is' : 'are'} pending, ${inProgressTasks} in progress and ${completedTasks} completed.`
        : `De ellas, ${pendingTasks} ${pendingTasks === 1 ? 'está' : 'están'} pendiente${pendingTasks === 1 ? '' : 's'}, ${inProgressTasks} en progreso y ${completedTasks} completada${completedTasks === 1 ? '' : 's'}.`;
      
      const projectsWithTasks = tasksByProject.filter(p => p.taskCount > 0);
      if (projectsWithTasks.length > 0 && projectsWithTasks.length <= 3) {
        responseMessage += language === 'en'
          ? ` Distribution by project:`
          : ` Distribución por proyecto:`;
        
        for (const project of projectsWithTasks) {
          responseMessage += `\n- "${project.projectName}": ${project.taskCount} ${language === 'en' ? 'task' : 'tarea'}${project.taskCount === 1 ? '' : (language === 'en' ? 's' : 's')}`;
        }
      }
    }
    
    return {
      success: true,
      action: 'countTasks',
      counts: {
        total: taskCount,
        pending: pendingTasks,
        inProgress: inProgressTasks,
        completed: completedTasks,
        cancelled: cancelledTasks
      },
      tasksByProject: tasksByProject,
      response: responseMessage
    };
  } catch (error) {
    logger.error(`Error counting tasks: ${error.message}`);
    return {
      success: false,
      response: language === 'en'
        ? `Sorry, I couldn't count the tasks due to an error: ${error.message}.`
        : `Lo siento, no pude contar las tareas debido a un error: ${error.message}.`
    };
  }
}

// ==================== CONTAR PROYECTOS ====================
async function processCountProjectsCommand(language) {
  logger.info(`Processing count projects command in ${language}`);
  
  try {
    const projectCount = await Project.count();
    logger.info(`Total projects: ${projectCount}`);
    
    const projects = await Project.findAll({
      include: [
        {
          model: Task,
          attributes: ['id']
        }
      ]
    });
    
    const projectStats = projects.map(project => ({
      id: project.id,
      title: project.title,
      taskCount: project.Tasks ? project.Tasks.length : 0
    }));
    
    let responseMessage;
    
    if (projectCount === 0) {
      responseMessage = language === 'en'
        ? 'You have no projects in the system. Do you want to create a new project?'
        : 'No tienes ningún proyecto en el sistema. ¿Quieres crear un nuevo proyecto?';
    } else {
      responseMessage = language === 'en'
        ? `You currently have ${projectCount} project${projectCount === 1 ? '' : 's'} in the system.`
        : `Actualmente tienes ${projectCount} proyecto${projectCount === 1 ? '' : 's'} en el sistema.`;
      
      responseMessage += language === 'en'
        ? ' The projects are:'
        : ' Los proyectos son:';
      
      for (const project of projectStats) {
        responseMessage += `\n- "${project.title}" ${language === 'en' ? 'with' : 'con'} ${project.taskCount} ${language === 'en' ? 'task' : 'tarea'}${project.taskCount === 1 ? '' : (language === 'en' ? 's' : 's')}`;
      }
    }
    
    return {
      success: true,
      action: 'countProjects',
      count: projectCount,
      projects: projectStats,
      response: responseMessage
    };
  } catch (error) {
    logger.error(`Error counting projects: ${error.message}`);
    return {
      success: false,
      response: language === 'en'
        ? `Sorry, I couldn't count the projects due to an error: ${error.message}.`
        : `Lo siento, no pude contar los proyectos debido a un error: ${error.message}.`
    };
  }
}

// ==================== ASISTENCIA GENERAL CON CONTEXTO ====================
// ==================== ASISTENCIA GENERAL CON CONTEXTO ====================
async function processAssistanceCommand(transcription, projects, language, userToken) {
  logger.info(`Processing assistance command with context in ${language}`);
  
  const normalizedText = transcription.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  
  // ✅ NO redirigir preguntas de análisis - dejarlas para el asistente
  const isAnalysisQuery = language === 'en'
    ? normalizedText.includes('overdue') || normalizedText.includes('analytics') || 
      normalizedText.includes('progress') || normalizedText.includes('summary') ||
      normalizedText.includes('explain') || normalizedText.includes('tell me about')
    : normalizedText.includes('atrasad') || normalizedText.includes('vencid') ||
      normalizedText.includes('analisis') || normalizedText.includes('progreso') ||
      normalizedText.includes('resumen') || normalizedText.includes('explicame');
  
  if (!isAnalysisQuery) {
    // Solo redirigir comandos de acción, no preguntas
    if ((normalizedText.includes('crear') || normalizedText.includes('create') || normalizedText.includes('crea')) && 
        (normalizedText.includes('tarea') || normalizedText.includes('task') || normalizedText.includes('actividad') || normalizedText.includes('activity'))) {
      logger.info('Redirecting from assistance to createTask');
      return processCreateTaskCommand(transcription, null, projects, language);
    }
    
    if ((normalizedText.includes('crear') || normalizedText.includes('create') || normalizedText.includes('crea')) && 
        (normalizedText.includes('proyecto') || normalizedText.includes('project'))) {
      logger.info('Redirecting from assistance to createProject');
      return processCreateProjectCommand(transcription, language);
    }
  }
  
  // ✅ OBTENER CONTEXTO COMPLETO desde el endpoint de assistant
  let fullContext = null;
  try {
    // Construir la URL base desde las variables de entorno o usar localhost
    const baseURL = process.env.API_URL || 'http://localhost:5500';
    const contextURL = `${baseURL}/api/assistant/context`;
    
    logger.info(`Fetching context from: ${contextURL}`);
    
    // ✅ USAR EL TOKEN DEL USUARIO, NO CLAUDE_API_KEY
    const contextResponse = await axios.get(contextURL, {
      headers: {
        'x-auth-token': userToken || process.env.JWT_SECRET // Usar el token del usuario
      },
      timeout: 5000 // 5 segundos de timeout
    });
    
    fullContext = contextResponse.data;
    logger.info(`Full context retrieved: ${fullContext.summary.totalProjects} projects, ${fullContext.summary.totalTasks} tasks`);
  } catch (error) {
    logger.error(`Error retrieving full context: ${error.message}`);
    if (error.response) {
      logger.error(`Context API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
    }
  }
  
  // Generar respuesta con Claude usando contexto completo
  if (openaiClient && fullContext) {
    try {
      const systemPrompt = language === 'en'
        ? `You are a helpful virtual assistant for SmartTask, a task and project management application.

IMPORTANT: You have COMPLETE access to the user's data. Use it to give SPECIFIC, ACCURATE answers.

USER'S COMPLETE DATA:
${JSON.stringify(fullContext, null, 2)}

Summary Statistics:
- Total Projects: ${fullContext.summary.totalProjects}
- Total Tasks: ${fullContext.summary.totalTasks}
- Pending: ${fullContext.summary.tasksByStatus.pending}
- In Progress: ${fullContext.summary.tasksByStatus.in_progress}
- Completed: ${fullContext.summary.tasksByStatus.completed}
- Overdue: ${fullContext.summary.overdueTasksCount}
- Upcoming (next 7 days): ${fullContext.summary.upcomingTasksCount}

Your responses MUST:
1. Use ACTUAL data from the context (project names, task counts, dates)
2. Be SPECIFIC - mention exact numbers, project names, task titles
3. Be conversational but accurate
4. If asked about a specific project, use the data you have about it
5. For "overdue" questions, use the overdueTasks array
6. For "analytics" questions, use the summary statistics

Examples of GOOD responses:
❌ BAD: "I don't have information about that project"
✅ GOOD: "Your 'Asistencia de tesis' project has 8 tasks: 8 pending, 0 in progress, 0 completed"

❌ BAD: "You might have some overdue tasks"
✅ GOOD: "You have 5 overdue tasks: 'estado del arte' (2 days overdue), 'Traducción a inglés' (1 day overdue)..."

Current date for reference: ${new Date().toISOString().split('T')[0]}`
        : `Eres un asistente virtual útil para SmartTask, una aplicación de gestión de tareas y proyectos.

IMPORTANTE: Tienes acceso COMPLETO a los datos del usuario. Úsalos para dar respuestas ESPECÍFICAS y PRECISAS.

DATOS COMPLETOS DEL USUARIO:
${JSON.stringify(fullContext, null, 2)}

Estadísticas Resumidas:
- Total Proyectos: ${fullContext.summary.totalProjects}
- Total Tareas: ${fullContext.summary.totalTasks}
- Pendientes: ${fullContext.summary.tasksByStatus.pending}
- En Progreso: ${fullContext.summary.tasksByStatus.in_progress}
- Completadas: ${fullContext.summary.tasksByStatus.completed}
- Atrasadas: ${fullContext.summary.overdueTasksCount}
- Próximas (próximos 7 días): ${fullContext.summary.upcomingTasksCount}

Tus respuestas DEBEN:
1. Usar datos REALES del contexto (nombres de proyectos, conteos, fechas)
2. Ser ESPECÍFICAS - mencionar números exactos, nombres de proyectos, títulos de tareas
3. Ser conversacionales pero precisas
4. Si preguntan sobre un proyecto específico, usar los datos que tienes sobre él
5. Para preguntas sobre "atrasadas", usar el array overdueTasks
6. Para preguntas sobre "análisis", usar las estadísticas del resumen

Ejemplos de respuestas BUENAS:
❌ MAL: "No tengo información sobre ese proyecto"
✅ BIEN: "Tu proyecto 'Asistencia de tesis' tiene 8 tareas: 8 pendientes, 0 en progreso, 0 completadas"

❌ MAL: "Podrías tener algunas tareas atrasadas"
✅ BIEN: "Tienes 5 tareas atrasadas: 'estado del arte' (2 días de retraso), 'Traducción a inglés' (1 día de retraso)..."

Fecha actual para referencia: ${new Date().toISOString().split('T')[0]}`;
      
      const userPrompt = language === 'en'
        ? `User question: "${transcription}"

Provide a SPECIFIC answer using the ACTUAL data from the context. Include real project names, task counts, and dates.`
        : `Pregunta del usuario: "${transcription}"

Proporciona una respuesta ESPECÍFICA usando los datos REALES del contexto. Incluye nombres reales de proyectos, conteos de tareas y fechas.`;
      
      const completion = await openaiClient.chat.completions.create({
        model: "claude-sonnet-4-20250514",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.3, // ✅ Reducido para respuestas más precisas
        max_tokens: 500,
      });

      return {
        success: true,
        response: completion.choices[0].message.content.trim()
      };
    } catch (error) {
      logger.error(`Claude assistance error: ${error.message}`);
    }
  }
  
  // Si no hay contexto o Claude no está disponible, dar respuesta básica
  const projectsContext = projects && projects.length > 0
    ? projects.map(p => p.title).join(', ')
    : (language === 'en' ? 'No projects' : 'No hay proyectos');
  
  // Respuestas predefinidas basadas en palabras clave (fallback)
  if (normalizedText.includes('hola') || normalizedText.includes('hello')) {
    return {
      success: true,
      response: language === 'en'
        ? 'Hello! I\'m your SmartTask assistant. I have access to all your projects and tasks. What would you like to know?'
        : '¡Hola! Soy tu asistente de SmartTask. Tengo acceso a todos tus proyectos y tareas. ¿Qué te gustaría saber?'
    };
  }
  
  if (normalizedText.includes('ayuda') || normalizedText.includes('help')) {
    return {
      success: true,
      response: language === 'en'
        ? `I can help you with: creating tasks/projects, searching, analyzing your work, and more. You have ${projects.length} project(s) currently.`
        : `Puedo ayudarte con: crear tareas/proyectos, buscar, analizar tu trabajo, y más. Actualmente tienes ${projects.length} proyecto(s).`
    };
  }
  
  // Respuesta predeterminada
  return {
    success: true,
    response: language === 'en'
      ? `I'm here to help! You have ${projects.length} project(s). Ask me about your tasks, projects, deadlines, or progress.`
      : `¡Estoy aquí para ayudar! Tienes ${projects.length} proyecto(s). Pregúntame sobre tus tareas, proyectos, fechas límite o progreso.`
  };
}

module.exports = router;