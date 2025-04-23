// routes/speech.js
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

// Configurar logger
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

// Inicializar OpenAI (apuntando a Claude)
let openaiClient;
try {
  if (process.env.CLAUDE_API_KEY) {
    openaiClient = new OpenAI({
      apiKey: process.env.CLAUDE_API_KEY,
      baseURL: "https://api.anthropic.com/v1/",
    });
    logger.info('Cliente de Claude (via OpenAI SDK) inicializado correctamente');
  } else {
    logger.warn('Variable de entorno CLAUDE_API_KEY no configurada');
  }
} catch (error) {
  logger.error(`Error al inicializar cliente de Claude: ${error.message}`);
}

// Configurar Google Speech-to-Text
let speechClient;
try {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    speechClient = new speech.SpeechClient({
      credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
    });
    logger.info('Cliente de Google Speech-to-Text inicializado correctamente');
  } else {
    logger.error('Variable de entorno GOOGLE_APPLICATION_CREDENTIALS_JSON no configurada');
  }
} catch (error) {
  logger.error('Error al configurar Google Speech-to-Text:', error);
}

// Asegurarse de que exista el directorio de uploads
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  try {
    fs.mkdirSync(uploadDir, { recursive: true });
    logger.info(`Directorio de uploads creado: ${uploadDir}`);
  } catch (error) {
    logger.error(`Error al crear directorio de uploads: ${error.message}`);
  }
}

// Configuración de multer para manejar archivos de audio
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
    fileSize: 10 * 1024 * 1024, // Límite de 10MB
  },
  fileFilter: (req, file, cb) => {
    // Validar el tipo de archivo
    const allowedMimeTypes = ['audio/webm', 'audio/ogg', 'audio/wav', 'audio/mpeg', 'audio/mp3'];
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Formato de archivo no soportado: ${file.mimetype}`), false);
    }
  }
});

// Endpoint para convertir audio a texto
router.post('/speech-to-text', auth, upload.single('audio'), async (req, res) => {
  try {
    logger.info('Iniciando procesamiento de audio a texto');
    
    if (!speechClient) {
      logger.error('Google Speech-to-Text no está configurado correctamente');
      return res.status(500).json({ error: 'Google Speech-to-Text no está configurado correctamente' });
    }
    
    if (!req.file) {
      logger.error('No se recibió ningún archivo de audio');
      return res.status(400).json({ error: 'No se recibió ningún archivo de audio' });
    }

    logger.info(`Archivo recibido: ${req.file.filename}, tipo: ${req.file.mimetype}, tamaño: ${req.file.size} bytes`);

    // Leer el archivo de audio
    const audioBytes = fs.readFileSync(req.file.path).toString('base64');
    
    // Determinar el encoding basado en el tipo de archivo
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
        encoding = 'ENCODING_UNSPECIFIED'; // Dejar que Google detecte automáticamente
    }
    
    logger.info(`Procesando audio con encoding: ${encoding}`);

    // Configurar la solicitud para Google Speech-to-Text
    const request = {
      audio: {
        content: audioBytes,
      },
      config: {
        encoding: encoding,
        sampleRateHertz: 16000, // Frecuencia de muestreo recomendada
        languageCode: 'es-ES', // Español (España)
        alternativeLanguageCodes: ['es-MX', 'es-CO', 'es-AR', 'es-CL', 'es-US'], // Soporte para variantes regionales
        enableAutomaticPunctuation: true,
        model: 'default',
      },
    };

    // Realizar la solicitud a Google Speech-to-Text
    const [response] = await speechClient.recognize(request);
    
    // Extraer la transcripción
    const transcription = response.results
      .map(result => result.alternatives[0].transcript)
      .join('\n');
    
    logger.info(`Transcripción completada: "${transcription}"`);

    // Eliminar el archivo de audio temporal
    try {
      fs.unlinkSync(req.file.path);
    } catch (unlinkError) {
      logger.error(`Error al eliminar archivo temporal: ${unlinkError.message}`);
    }

    res.json({ success: true, transcription });
  } catch (error) {
    logger.error(`Error detallado en speech-to-text: ${error.stack}`);
    
    // Limpiar el archivo en caso de error
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkError) {
        logger.error(`Error al eliminar archivo temporal: ${unlinkError.message}`);
      }
    }
    
    res.status(500).json({ 
      error: 'Error al procesar el audio',
      details: error.message 
    });
  }
});

// Endpoint para procesar texto transcrito
router.post('/process-voice-text', auth, async (req, res) => {
  const { transcription, commandType, projectId } = req.body;
  
  if (!transcription) {
    return res.status(400).json({ error: 'La transcripción es requerida' });
  }

  try {
    logger.info(`Procesando transcripción de voz: "${transcription}"`);
    
    // Obtener proyectos para el contexto
    let projects = [];
    try {
      projects = await Project.findAll();
      logger.info(`Loaded ${projects.length} projects for context`);
    } catch (error) {
      logger.warn(`Error al obtener proyectos: ${error.message}`);
    }
    
    // Detectar el tipo de comando - VERSIÓN MEJORADA
    let detectedCommandType = commandType;
    
    if (!detectedCommandType) {
      // Detección por palabras clave - versión mejorada
      const normalizedText = transcription.trim().toLowerCase();
      
      // Uso expresiones regulares más precisas para capturar los comandos
      const createTaskRegex = /\b(crear|nueva|agregar|añadir)\s+(una\s+)?tarea\b/i;
      const createProjectRegex = /\b(crear|nuevo|agregar|añadir)\s+(un\s+)?proyecto\b/i;
      const searchTaskRegex = /\b(buscar|encontrar|mostrar|listar)\s+(tareas?|actividades)\b/i;
      const updateTaskRegex = /\b(actualizar|modificar|cambiar|marcar)\s+(la\s+)?tarea\b/i;
      const countTasksRegex = /\b(cuantas|cuántas|numero|número|total\s+de)\s+tareas\b/i;
      
      if (createTaskRegex.test(normalizedText)) {
        detectedCommandType = 'createTask';
        logger.info('Command type detected via regex: createTask');
      } else if (createProjectRegex.test(normalizedText)) {
        detectedCommandType = 'createProject';
        logger.info('Command type detected via regex: createProject');
      } else if (searchTaskRegex.test(normalizedText)) {
        detectedCommandType = 'searchTask';
        logger.info('Command type detected via regex: searchTask');
      } else if (updateTaskRegex.test(normalizedText)) {
        detectedCommandType = 'updateTask';
        logger.info('Command type detected via regex: updateTask');
      } else if (countTasksRegex.test(normalizedText)) {
        detectedCommandType = 'countTasks';
        logger.info('Command type detected via regex: countTasks');
      } else {
        // Verificación de respaldo por palabras clave simples
        if (normalizedText.includes('crear tarea') || normalizedText.includes('nueva tarea')) {
          detectedCommandType = 'createTask';
          logger.info('Command type detected via keywords: createTask');
        } else if (normalizedText.includes('crear proyecto') || normalizedText.includes('nuevo proyecto')) {
          detectedCommandType = 'createProject';
          logger.info('Command type detected via keywords: createProject');
        } else if (normalizedText.includes('buscar') && normalizedText.includes('tarea')) {
          detectedCommandType = 'searchTask';
          logger.info('Command type detected via keywords: searchTask');
        } else if (normalizedText.includes('cambiar') || normalizedText.includes('actualizar')) {
          detectedCommandType = 'updateTask';
          logger.info('Command type detected via keywords: updateTask');
        } else if (normalizedText.includes('cuántas') || normalizedText.includes('cuantas')) {
          detectedCommandType = 'countTasks';
          logger.info('Command type detected via keywords: countTasks');
        } else {
          detectedCommandType = 'assistance';
          logger.info('No specific command detected, defaulting to assistance');
        }
      }
    }
    
    logger.info(`Executing command type: ${detectedCommandType}`);
    
    // Procesar el comando según su tipo
    let response;
    
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
    logger.error(`Error processing voice command: ${error.message}`);
    return res.status(500).json({ 
      success: false,
      error: 'Error al procesar el comando de voz',
      details: error.message 
    });
  }
});

// Procesador de comando para crear tarea
async function processCreateTaskCommand(transcription, projectId, projects = []) {
  logger.info(`Processing create task command: "${transcription}"`);
  
  try {
    // Extraer detalles de la tarea
    let taskDetails = await extractTaskDetails(transcription);
    
    // Buscar el proyecto al que asignar la tarea
    let targetProjectId = projectId;
    let targetProjectName = "";
    
    if (!targetProjectId && projects.length > 0) {
      // Buscar menciones de proyectos en el texto
      const normalizedText = transcription.toLowerCase();
      
      for (const project of projects) {
        if (normalizedText.includes(project.title.toLowerCase())) {
          targetProjectId = project.id;
          targetProjectName = project.title;
          logger.info(`Proyecto identificado en el texto: ${targetProjectName} (ID: ${targetProjectId})`);
          break;
        }
      }
      
      // Si no se encontró ningún proyecto, usar el primero
      if (!targetProjectId) {
        targetProjectId = projects[0].id;
        targetProjectName = projects[0].title;
        logger.info(`No se identificó proyecto en el texto, usando el primero: ${targetProjectName} (ID: ${targetProjectId})`);
      }
    } else if (targetProjectId) {
      // Obtener el nombre del proyecto si se proporcionó un ID
      try {
        const project = await Project.findByPk(targetProjectId);
        if (project) {
          targetProjectName = project.title;
          logger.info(`Usando proyecto especificado: ${targetProjectName} (ID: ${targetProjectId})`);
        }
      } catch (error) {
        logger.error(`Error al obtener detalles del proyecto: ${error.message}`);
      }
    } else {
      logger.error(`No hay proyectos disponibles y no se especificó un ID de proyecto`);
      return {
        success: false,
        error: 'No se pudo determinar un proyecto para la tarea'
      };
    }
    
    // Crear la tarea
    const taskData = {
      title: taskDetails.title || 'Nueva tarea',
      description: taskDetails.description || 'Tarea creada por comando de voz',
      status: taskDetails.status || 'pending',
      completion_date: taskDetails.completion_date || new Date(Date.now() + 7*24*60*60*1000).toISOString().split('T')[0],
      projectId: targetProjectId,
      creation_date: new Date()
    };
    
    logger.info(`Creando tarea con datos: ${JSON.stringify(taskData)}`);
    
    const newTask = await Task.create(taskData);
    logger.info(`Tarea creada con éxito con ID: ${newTask.id}`);
    
    return {
      success: true,
      action: 'createTask',
      taskDetails: newTask.dataValues,
      message: `He creado una nueva tarea: "${taskData.title}" en el proyecto "${targetProjectName}".`
    };
  } catch (error) {
    logger.error(`Error al crear tarea: ${error.message}`);
    return {
      success: false,
      error: `Error al crear la tarea: ${error.message}`
    };
  }
}

// Extraer detalles de tarea del texto
async function extractTaskDetails(transcription) {
  try {
    if (openaiClient) {
      try {
        // Usar OpenAI/Claude para extraer detalles
        const completion = await openaiClient.chat.completions.create({
          model: "claude-3-haiku-20240307",
          messages: [
            { 
              role: "system", 
              content: `Eres un asistente especializado en extraer detalles de tareas para un sistema de gestión de proyectos.` 
            },
            { 
              role: "user", 
              content: `Analiza esta transcripción: "${transcription}" 
              Extrae los detalles de la tarea que se está solicitando crear. 
              Devuelve SOLO un objeto JSON con los campos title, description, status y completion_date.
              Si no hay información sobre algún campo, déjalo como null o con un valor por defecto apropiado.
              Para completion_date, si no se especifica una fecha exacta pero se menciona un plazo (como "para mañana" o "en una semana"), calcula la fecha correspondiente.
              Para status, si no se especifica, usa "pending" como valor por defecto.` 
            }
          ],
          temperature: 0.3,
          max_tokens: 300,
        });
    
        // Extraer y analizar la respuesta
        const responseContent = completion.choices[0].message.content;
        
        // Intentar extraer el JSON de la respuesta
        const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No se pudo extraer JSON de la respuesta');
        }
      } catch (apiError) {
        logger.error(`Error al extraer detalles de tarea con Claude: ${apiError.message}`);
        // Continuar con la extracción basada en palabras clave
      }
    }
    
    // Extracción basada en palabras clave (fallback)
    const lowercaseText = transcription.toLowerCase();
    
    // Extraer título
    let title = "Nueva tarea";
    const titleMatch = transcription.match(/(?:crear|nueva) tarea (?:llamada|titulada|con nombre|con título)? ?["']?([^"'.,]+)["']?/i);
    
    if (titleMatch) {
      title = titleMatch[1].trim();
    } else if (lowercaseText.includes("crear tarea")) {
      // Extraer todo después de "crear tarea"
      const afterCreateMatch = transcription.match(/crear tarea (.+)/i);
      if (afterCreateMatch) {
        // Usar las primeras palabras como título
        const words = afterCreateMatch[1].split(' ');
        if (words.length > 3) {
          title = words.slice(0, 3).join(' ');
        } else {
          title = afterCreateMatch[1];
        }
      }
    }
    
    // Extraer estado
    let status = 'pending';
    if (lowercaseText.includes('en progreso')) status = 'in_progress';
    else if (lowercaseText.includes('completada')) status = 'completed';
    else if (lowercaseText.includes('cancelada')) status = 'cancelled';
    
    // Extraer descripción
    let description = null;
    if (lowercaseText.includes('para')) {
      const descriptionMatch = transcription.match(/para (.+)$/i);
      if (descriptionMatch) {
        description = descriptionMatch[1].trim();
      }
    }
    
    // Extraer fecha de finalización
    let completionDate = null;
    const today = new Date();
    
    if (lowercaseText.includes('mañana')) {
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      completionDate = tomorrow.toISOString().split('T')[0];
    } else if (lowercaseText.includes('próxima semana')) {
      const nextWeek = new Date(today);
      nextWeek.setDate(nextWeek.getDate() + 7);
      completionDate = nextWeek.toISOString().split('T')[0];
    } else if (lowercaseText.includes('próximo mes')) {
      const nextMonth = new Date(today);
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      completionDate = nextMonth.toISOString().split('T')[0];
    } else {
      // Por defecto, una semana desde hoy
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
  } catch (error) {
    logger.error(`Error al extraer detalles de tarea: ${error.message}`);
    // Devolver valores por defecto
    return {
      title: "Nueva tarea",
      description: "Tarea creada por comando de voz",
      status: "pending",
      completion_date: new Date(Date.now() + 7*24*60*60*1000).toISOString().split('T')[0]
    };
  }
}

// Procesador de comando para crear proyecto
async function processCreateProjectCommand(transcription) {
  logger.info(`Processing create project command: "${transcription}"`);
  
  try {
    // Extraer detalles del proyecto
    let projectDetails = await extractProjectDetails(transcription);
    
    // Verificar si ya existe un proyecto con este título
    const existingProject = await Project.findOne({
      where: {
        title: projectDetails.title
      }
    });
    
    if (existingProject) {
      logger.warn(`Ya existe un proyecto con el título "${projectDetails.title}"`);
      return {
        success: false,
        error: `Ya existe un proyecto llamado "${projectDetails.title}"`
      };
    }
    
    // Crear el proyecto
    const projectData = {
      title: projectDetails.title || 'Nuevo proyecto',
      description: projectDetails.description || 'Proyecto creado por comando de voz',
      priority: projectDetails.priority || 'medium',
      culmination_date: projectDetails.culmination_date || null,
      creation_date: new Date()
    };
    
    logger.info(`Creando proyecto con datos: ${JSON.stringify(projectData)}`);
    
    const newProject = await Project.create(projectData);
    logger.info(`Proyecto creado con éxito con ID: ${newProject.id}`);
    
    return {
      success: true,
      action: 'createProject',
      projectDetails: newProject.dataValues,
      message: `He creado un nuevo proyecto: "${projectData.title}".`
    };
  } catch (error) {
    logger.error(`Error al crear proyecto: ${error.message}`);
    return {
      success: false,
      error: `Error al crear el proyecto: ${error.message}`
    };
  }
}

// Extraer detalles de proyecto del texto
async function extractProjectDetails(transcription) {
  try {
    if (openaiClient) {
      try {
        // Usar OpenAI/Claude para extraer detalles
        const completion = await openaiClient.chat.completions.create({
          model: "claude-3-haiku-20240307",
          messages: [
            { 
              role: "system", 
              content: `Eres un asistente especializado en extraer detalles de proyectos para un sistema de gestión.` 
            },
            { 
              role: "user", 
              content: `Analiza esta transcripción: "${transcription}" 
              Extrae los detalles del proyecto que se está solicitando crear. 
              Devuelve SOLO un objeto JSON con los campos title, description, priority y culmination_date.
              Si no hay información sobre algún campo, déjalo como null o con un valor por defecto apropiado.
              Para culmination_date, si no se especifica una fecha exacta pero se menciona un plazo (como "para fin de año"), calcula la fecha correspondiente.
              Para priority, si no se especifica, usa "medium" como valor por defecto.` 
            }
          ],
          temperature: 0.3,
          max_tokens: 300,
        });
    
        // Extraer y analizar la respuesta
        const responseContent = completion.choices[0].message.content;
        
        // Intentar extraer el JSON de la respuesta
        const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No se pudo extraer JSON de la respuesta');
        }
      } catch (apiError) {
        logger.error(`Error al extraer detalles de proyecto con Claude: ${apiError.message}`);
        // Continuar con la extracción basada en palabras clave
      }
    }
    
    // Extracción basada en palabras clave (fallback)
    const lowercaseText = transcription.toLowerCase();
    
    // Extraer título
    let title = "Nuevo proyecto";
    const titleMatch = transcription.match(/(?:crear|nuevo) proyecto(?:s)? (?:llamado|titulado|con nombre|con título)? ?["']?([^"'.,]+)["']?/i);
    
    if (titleMatch) {
      title = titleMatch[1].trim();
    } else if (lowercaseText.includes("crear proyecto")) {
      // Extraer todo después de "crear proyecto"
      const afterCreateMatch = transcription.match(/crear proyecto(?:s)? (.+)/i);
      if (afterCreateMatch) {
        // Usar las primeras palabras como título
        const words = afterCreateMatch[1].split(' ');
        if (words.length > 3) {
          title = words.slice(0, 3).join(' ');
        } else {
          title = afterCreateMatch[1];
        }
      }
    }
    
    // Extraer prioridad
    let priority = 'medium';
    if (lowercaseText.includes('alta') || lowercaseText.includes('urgente')) {
      priority = 'high';
    } else if (lowercaseText.includes('baja')) {
      priority = 'low';
    }
    
    // Extraer descripción
    let description = null;
    if (lowercaseText.includes('para')) {
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
  } catch (error) {
    logger.error(`Error al extraer detalles de proyecto: ${error.message}`);
    // Devolver valores por defecto
    return {
      title: "Nuevo proyecto",
      description: "Proyecto creado por comando de voz",
      priority: "medium",
      culmination_date: null
    };
  }
}

// Procesador de comando para buscar tareas
async function processSearchTaskCommand(transcription, projectId) {
  logger.info(`Processing search task command: "${transcription}"`);
  
  try {
    // Extraer parámetros de búsqueda
    let searchParams = await extractSearchParams(transcription, projectId);
    
    // Construir la consulta
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
    
    logger.info(`Buscando tareas con criterios: ${JSON.stringify(whereClause)}`);
    
    // Ejecutar la búsqueda
    const tasks = await Task.findAll({
      where: whereClause,
      include: [
        {
          model: Project,
          attributes: ['id', 'title']
        }
      ],
      limit: 10 // Limitar resultados por rendimiento
    });
    
    logger.info(`Se encontraron ${tasks.length} tareas coincidentes`);
    
    // Formatear resultados
    const searchResults = tasks.map(task => ({
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      completion_date: task.completion_date,
      projectName: task.Project ? task.Project.title : 'Desconocido'
    }));
    
    return {
      success: true,
      action: 'searchTasks',
      searchParams,
      searchResults,
      message: `He encontrado ${searchResults.length} tareas que coinciden con tu búsqueda.`
    };
  } catch (error) {
    logger.error(`Error al buscar tareas: ${error.message}`);
    return {
      success: false,
      error: `Error al buscar tareas: ${error.message}`
    };
  }
}

// Extraer parámetros de búsqueda del texto
async function extractSearchParams(transcription, projectId) {
  try {
    if (openaiClient) {
      try {
        // Usar OpenAI/Claude para extraer parámetros
        const completion = await openaiClient.chat.completions.create({
          model: "claude-3-haiku-20240307",
          messages: [
            { 
              role: "system", 
              content: `Eres un asistente especializado en extraer parámetros de búsqueda para un sistema de gestión de tareas.` 
            },
            { 
              role: "user", 
              content: `Analiza esta transcripción: "${transcription}" 
              Extrae los criterios de búsqueda para tareas, que pueden incluir:
              - searchTerm: palabras clave para buscar en el título o descripción
              - status: estado de las tareas (in_progress, completed, pending, cancelled)
              
              Devuelve SOLO un objeto JSON con estos campos. Si algún criterio no está presente, omítelo del objeto.` 
            }
          ],
          temperature: 0.3,
          max_tokens: 300,
        });
    
        // Extraer y analizar la respuesta
        const responseContent = completion.choices[0].message.content;
        
        // Intentar extraer el JSON de la respuesta
        const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const params = JSON.parse(jsonMatch[0]);
          params.projectId = projectId; // Añadir projectId de la solicitud
          return params;
        } else {
          throw new Error('No se pudo extraer JSON de la respuesta');
        }
      } catch (apiError) {
        logger.error(`Error al extraer parámetros de búsqueda con Claude: ${apiError.message}`);
        // Continuar con la extracción basada en palabras clave
      }
    }
    
    // Extracción basada en palabras clave (fallback)
    const lowercaseText = transcription.toLowerCase();
    
    // Extraer término de búsqueda
    let searchTerm = null;
    const searchMatch = transcription.match(/(?:buscar|encontrar|mostrar|listar) (?:tareas? (?:sobre|de|con|relacionadas))? ?["']?([^"'.,]+)["']?/i);
    
    if (searchMatch) {
      searchTerm = searchMatch[1].trim();
    }
    
    // Extraer estado
    let status = null;
    if (lowercaseText.includes('pendiente')) status = 'pending';
    else if (lowercaseText.includes('en progreso')) status = 'in_progress';
    else if (lowercaseText.includes('completada')) status = 'completed';
    else if (lowercaseText.includes('cancelada')) status = 'cancelled';
    
    return {
      searchTerm,
      status,
      projectId
    };
  } catch (error) {
    logger.error(`Error al extraer parámetros de búsqueda: ${error.message}`);
    // Devolver valores por defecto
    return {
      searchTerm: null,
      status: null,
      projectId
    };
  }
}

// Procesador de comando para actualizar tarea
async function processUpdateTaskCommand(transcription) {
  logger.info(`Processing update task command: "${transcription}"`);
  
  try {
    // Extraer detalles de la actualización
    let updateDetails = await extractUpdateDetails(transcription);
    
    if (!updateDetails.taskIdentifier) {
      logger.error('No se encontró identificador de tarea en el comando');
      return {
        success: false,
        error: 'No se pudo identificar qué tarea deseas actualizar.'
      };
    }
    
    // Buscar la tarea a actualizar
    let task;
    
    if (!isNaN(updateDetails.taskIdentifier)) {
      // Si el identificador es un número, buscar por ID
      task = await Task.findByPk(parseInt(updateDetails.taskIdentifier), {
        include: [{ model: Project }]
      });
    } else {
      // Si no, buscar por título
      task = await Task.findOne({
        where: {
          title: {
            [Op.iLike]: `%${updateDetails.taskIdentifier}%`
          }
        },
        include: [{ model: Project }]
      });
    }
    
    if (!task) {
      logger.error(`No se encontró ninguna tarea que coincida con: ${updateDetails.taskIdentifier}`);
      return {
        success: false,
        error: `No se encontró ninguna tarea que coincida con "${updateDetails.taskIdentifier}".`
      };
    }
    
    // Asegurarse de que hay actualizaciones para aplicar
    if (!updateDetails.updates || Object.keys(updateDetails.updates).length === 0) {
      // Si no se especificaron actualizaciones específicas pero se menciona "completar"
      // entonces actualizamos el estado a "completed"
      if (transcription.toLowerCase().includes('completar') || 
          transcription.toLowerCase().includes('completada') ||
          transcription.toLowerCase().includes('finalizar') ||
          transcription.toLowerCase().includes('terminar')) {
        updateDetails.updates = { status: 'completed' };
        logger.info('Se detectó la intención de marcar como completada, aplicando actualización de estado');
      } else {
        logger.error('No se especificaron actualizaciones en el comando');
        return {
          success: false,
          error: 'No se especificaron cambios para actualizar la tarea.'
        };
      }
    }
    
    logger.info(`Actualizando tarea ${task.id} con: ${JSON.stringify(updateDetails.updates)}`);
    
    // Aplicar las actualizaciones
    await task.update(updateDetails.updates);
    
    return {
      success: true,
      action: 'updateTask',
      taskDetails: {
        id: task.id,
        title: task.title,
        description: task.description,
        status: task.status,
        completion_date: task.completion_date,
        projectName: task.Project ? task.Project.title : 'Desconocido'
      },
      message: `He actualizado la tarea "${task.title}" correctamente.`
    };
  } catch (error) {
    logger.error(`Error al actualizar tarea: ${error.message}`);
    return {
      success: false,
      error: `Error al actualizar la tarea: ${error.message}`
    };
  }
}

// Extraer detalles de actualización del texto
async function extractUpdateDetails(transcription) {
  try {
    if (openaiClient) {
      try {
        // Usar OpenAI/Claude para extraer detalles
        const completion = await openaiClient.chat.completions.create({
          model: "claude-3-haiku-20240307",
          messages: [
            { 
              role: "system", 
              content: `Eres un especialista en actualización de tareas. Extrae detalles de actualización de comandos de voz.` 
            },
            { 
              role: "user", 
              content: `Extrae los siguientes detalles de este comando de voz: "${transcription}"
              
              Devuelve SOLO un objeto JSON con estos campos:
              - taskIdentifier: palabras que identifican qué tarea actualizar
              - updates: un objeto con los campos a actualizar, que pueden incluir:
                - title: nuevo título 
                - description: nueva descripción
                - status: nuevo estado (in_progress, completed, pending, cancelled)
                - completion_date: nueva fecha límite en formato YYYY-MM-DD
              
              Solo incluye campos en 'updates' que realmente se vayan a cambiar.
              Si "en progreso" se menciona, usa "in_progress" para status.
              Si "completar" o "completada" se menciona, usa "completed" para status.
              Devuelve SOLO el JSON, nada más.` 
            }
          ],
          temperature: 0.3,
          max_tokens: 300,
        });
    
        // Extraer y analizar la respuesta
        const responseContent = completion.choices[0].message.content;
        
        // Intentar extraer el JSON de la respuesta
        const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No se pudo extraer JSON de la respuesta');
        }
      } catch (apiError) {
        logger.error(`Error al extraer detalles de actualización con Claude: ${apiError.message}`);
        // Continuar con la extracción basada en palabras clave
      }
    }
    
    // Extracción basada en palabras clave (fallback)
    const lowercaseText = transcription.toLowerCase();
    
    // Extraer identificador de tarea
    let taskIdentifier = null;
    const taskMatch = transcription.match(/(?:actualizar|modificar|cambiar) (?:la )?tarea (?:llamada |titulada |con nombre |con título )?["']?([^"'.,]+)["']?/i);
    
    if (taskMatch) {
      taskIdentifier = taskMatch[1].trim();
    } else {
      // Intentar otras formas de identificar la tarea
      const taskMatch2 = transcription.match(/(?:tarea|actividad) (?:llamada |titulada |con nombre |con título )?["']?([^"'.,]+)["']?/i);
      if (taskMatch2) {
        taskIdentifier = taskMatch2[1].trim();
      }
    }
    
    // Extraer actualizaciones
    const updates = {};
    
    // Actualizar estado
    if (lowercaseText.includes('a pendiente') || 
        lowercaseText.includes('estado pendiente')) {
      updates.status = 'pending';
    } else if (lowercaseText.includes('a en progreso') || 
              lowercaseText.includes('estado en progreso')) {
      updates.status = 'in_progress';
    } else if (lowercaseText.includes('a completada') || 
              lowercaseText.includes('estado completada') ||
              lowercaseText.includes('como completada') ||
              lowercaseText.includes('marcar como completada') ||
              lowercaseText.includes('completar') ||
              lowercaseText.includes('terminar') ||
              lowercaseText.includes('finalizar')) {
      updates.status = 'completed';
    } else if (lowercaseText.includes('a cancelada') || 
              lowercaseText.includes('estado cancelada')) {
      updates.status = 'cancelled';
    }
    
    // Actualizar título
    const titleMatch = transcription.match(/(?:cambiar|actualizar) (?:el )?título (?:a|por) ["']?([^"'.,]+)["']?/i);
    if (titleMatch) {
      updates.title = titleMatch[1].trim();
    }
    
    // Actualizar fecha
    if (lowercaseText.includes('fecha')) {
      let newDate = new Date();
      
      if (lowercaseText.includes('mañana')) {
        newDate.setDate(newDate.getDate() + 1);
      } else if (lowercaseText.includes('próxima semana')) {
        newDate.setDate(newDate.getDate() + 7);
      } else if (lowercaseText.includes('próximo mes')) {
        newDate.setMonth(newDate.getMonth() + 1);
      }
      
      updates.completion_date = newDate.toISOString().split('T')[0];
    }
    
    return {
      taskIdentifier,
      updates
    };
  } catch (error) {
    logger.error(`Error al extraer detalles de actualización: ${error.message}`);
    // Devolver valores por defecto
    return {
      taskIdentifier: null,
      updates: {}
    };
  }
}

// Procesador de comando para contar tareas
async function processCountTasksCommand() {
  logger.info('Processing count tasks command');
  
  try {
    // Contar todas las tareas
    const taskCount = await Task.count();
    logger.info(`Total de tareas: ${taskCount}`);
    
    return {
      success: true,
      response: `Actualmente tienes ${taskCount} tareas en total en el sistema.`
    };
  } catch (error) {
    logger.error(`Error al contar tareas: ${error.message}`);
    return {
      success: false,
      error: `Error al contar tareas: ${error.message}`
    };
  }
}

// Procesador de comando de asistencia general
async function processAssistanceCommand(transcription) {
  logger.info(`Processing assistance command: "${transcription}"`);
  
  // Generar respuesta con Claude si está disponible
  if (openaiClient) {
    try {
      // Usar Claude vía OpenAI SDK para generar una respuesta
      const completion = await openaiClient.chat.completions.create({
        model: "claude-3-haiku-20240307",
        messages: [
          { 
            role: "system", 
            content: `Eres un asistente útil para una aplicación de gestión de tareas llamada SmartTask. 
            La aplicación permite a los usuarios:
            - Crear y gestionar proyectos con títulos, descripciones, fechas y prioridades
            - Crear y gestionar tareas dentro de proyectos
            - Buscar tareas por varios criterios
            - Actualizar detalles de tareas
            
            Mantén tus respuestas amigables, útiles y concisas (máximo 2-4 oraciones).` 
          },
          { 
            role: "user", 
            content: `El usuario ha preguntado: "${transcription}"
            
            Proporciona una respuesta útil sin jerga técnica. No menciones que eres una IA.` 
          }
        ],
        temperature: 0.7,
        max_tokens: 150,
      });

      return {
        success: true,
        response: completion.choices[0].message.content.trim()
      };
    } catch (error) {
      logger.error(`Claude assistance error: ${error.message}`);
    }
  }
  
  // Respuestas predefinidas basadas en palabras clave (fallback)
  const lowercaseText = transcription.toLowerCase();
  
  if (lowercaseText.includes('hola') || 
      lowercaseText.includes('buenos días') || 
      lowercaseText.includes('buenas tardes') || 
      lowercaseText.includes('buenas noches')) {
    return {
      success: true,
      response: '¡Hola! Soy tu asistente virtual de SmartTask. ¿En qué puedo ayudarte hoy?'
    };
  }
  
  if (lowercaseText.includes('ayuda') || 
      lowercaseText.includes('qué puedes hacer')) {
    return {
      success: true,
      response: 'Puedo ayudarte con varias tareas. Puedes pedirme crear tareas o proyectos, buscar tareas, actualizar tareas existentes, o contar el número de tareas que tienes.'
    };
  }
  
  if (lowercaseText.includes('cómo crear') && lowercaseText.includes('tarea')) {
    return {
      success: true,
      response: 'Para crear una tarea, puedes decir: "Crear tarea [título] en el proyecto [nombre del proyecto]". También puedes especificar detalles como estado ("en progreso") y fecha límite.'
    };
  }
  
  if (lowercaseText.includes('cómo crear') && lowercaseText.includes('proyecto')) {
    return {
      success: true,
      response: 'Para crear un proyecto, puedes decir: "Crear proyecto [título]". Opcionalmente puedes especificar la prioridad como "alta", "media" o "baja", y añadir una descripción.'
    };
  }
  
  // Respuesta predeterminada
  return {
    success: true,
    response: '¿En qué puedo ayudarte? Puedo asistirte con la creación de tareas y proyectos, o ayudarte a buscar información en tu sistema de gestión de tareas.'
  };
}

module.exports = router;