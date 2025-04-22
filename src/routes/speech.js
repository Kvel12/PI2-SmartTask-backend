// routes/speech.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const speech = require('@google-cloud/speech');
const { OpenAI } = require('openai');
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

// Configurar el cliente de Google Speech-to-Text
let speechClient;
try {
  // Asegurarse de que la variable de entorno contiene un JSON válido
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

// Configurar el cliente de OpenAI
let openai;
try {
  if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    logger.info('Cliente OpenAI inicializado correctamente');
  } else {
    logger.error('Variable de entorno OPENAI_API_KEY no configurada');
  }
} catch (error) {
  logger.error('Error al configurar OpenAI:', error);
}

// Endpoint para convertir audio a texto
router.post('/speech-to-text', auth, upload.single('audio'), async (req, res) => {
    try {
    logger.info('Iniciando procesamiento de audio a texto');
    logger.info(`Headers recibidos: ${JSON.stringify(req.headers)}`);
        
    if (!speechClient) {
        logger.error('Google Speech-to-Text no está configurado correctamente');
        return res.status(500).json({ error: 'Google Speech-to-Text no está configurado correctamente' });
    }
    
    if (!req.file) {
        logger.error('No se recibió ningún archivo de audio');
        return res.status(400).json({ error: 'No se recibió ningún archivo de audio' });
    }

    logger.info(`Archivo recibido: ${req.file.filename}, tipo: ${req.file.mimetype}, tamaño: ${req.file.size} bytes`);

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
      logger.info(`Archivo temporal eliminado: ${req.file.path}`);
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

// Endpoint para procesar comandos de voz con un LLM o una versión simplificada
router.post('/process-voice-command', auth, async (req, res) => {
  const { transcription, commandType, projectId } = req.body;
  
  if (!transcription) {
    return res.status(400).json({ error: 'La transcripción es requerida' });
  }

  try {
    logger.info(`Procesando comando de voz: "${transcription}"`);
    
    // Si OpenAI no está disponible, usar enfoque basado en palabras clave
    if (!openai) {
      logger.warn('OpenAI no está configurado. Usando enfoque basado en palabras clave');
      return processWithKeywords(transcription, commandType, projectId, res);
    }

    // Preprocesar la transcripción para detectar el tipo de comando
    let detectedCommandType = commandType;
    
    if (!detectedCommandType) {
      // Si no se especificó un tipo de comando, intentar detectarlo automáticamente
      try {
        detectedCommandType = await detectCommandType(transcription);
        logger.info(`Tipo de comando detectado: ${detectedCommandType}`);
      } catch (error) {
        logger.error(`Error al detectar tipo de comando: ${error.message}`);
        detectedCommandType = 'assistance';
      }
    }
    
    // Generar respuesta según el tipo de comando detectado
    let response;
    
    switch (detectedCommandType) {
      case 'createTask':
        response = await processCreateTaskCommand(transcription, projectId);
        break;
      case 'createProject':
        response = await processCreateProjectCommand(transcription);
        break;
      case 'searchTask':
        response = await processSearchTaskCommand(transcription);
        break;
      case 'updateTask':
        response = await processUpdateTaskCommand(transcription);
        break;
      case 'assistance':
      default:
        response = await processAssistanceCommand(transcription);
        break;
    }
    
    logger.info(`Respuesta generada para comando de voz`);
    res.json(response);
  } catch (error) {
    logger.error(`Error al procesar comando de voz: ${error.message}`, error);
    res.status(500).json({ 
      success: false,
      error: 'Error al procesar el comando de voz',
      details: error.message 
    });
  }
});

// Endpoint para procesar texto transcrito directamente (sin audio)
router.post('/process-voice-text', auth, async (req, res) => {
    const { transcription, commandType, projectId } = req.body;
    
    if (!transcription) {
      return res.status(400).json({ error: 'La transcripción es requerida' });
    }
  
    try {
      logger.info(`Procesando transcripción de voz: "${transcription}"`);
      
      // Obtener información de proyectos y tareas para enviar como contexto al LLM
      let projectsContext = [];
      let tasksContext = [];
      
      try {
        // Obtener proyectos del usuario para dar contexto al LLM
        const userId = req.user.userId;
        const projects = await Project.findAll({ where: { userId } });
        
        projectsContext = projects.map(p => ({
          id: p.id,
          title: p.title,
          priority: p.priority,
          culmination_date: p.culmination_date
        }));
        
        // Si hay un proyecto específico, obtener sus tareas
        if (projectId) {
          const tasks = await Task.findAll({ where: { projectId } });
          tasksContext = tasks.map(t => ({
            id: t.id,
            title: t.title,
            status: t.status,
            completion_date: t.completion_date
          }));
        }
      } catch (error) {
        logger.warn(`Error al obtener contexto para LLM: ${error.message}`);
        // Continuamos sin contexto si hay un error
      }
      
      // Preprocesar la transcripción para detectar el tipo de comando
      let detectedCommandType = commandType;
      
      if (!detectedCommandType) {
        // Si no se especificó un tipo de comando, intentar detectarlo automáticamente
        try {
          detectedCommandType = await detectCommandType(transcription);
          logger.info(`Tipo de comando detectado: ${detectedCommandType}`);
        } catch (error) {
          logger.error(`Error al detectar tipo de comando: ${error.message}`);
          detectedCommandType = 'assistance';
        }
      }
      
      // Generar respuesta según el tipo de comando detectado
      let response;
      
      switch (detectedCommandType) {
        case 'createTask':
          response = await processCreateTaskCommand(transcription, projectId, projectsContext);
          break;
        case 'createProject':
          response = await processCreateProjectCommand(transcription, projectsContext);
          break;
        case 'searchTask':
          response = await processSearchTaskCommand(transcription, projectsContext, tasksContext);
          break;
        case 'updateTask':
          response = await processUpdateTaskCommand(transcription, projectsContext, tasksContext);
          break;
        case 'assistance':
        default:
          response = await processAssistanceCommand(transcription, projectsContext, tasksContext);
          break;
      }
      
      logger.info(`Respuesta generada para comando de voz`);
      res.json(response);
    } catch (error) {
      logger.error(`Error al procesar texto de voz: ${error.message}`, error);
      res.status(500).json({ 
        success: false,
        error: 'Error al procesar el texto de voz',
        details: error.message 
      });
    }
  });


// Función para procesar comandos mediante palabras clave (alternativa cuando OpenAI no está disponible)
async function processWithKeywords(transcription, commandType, projectId, res) {
  const lowercaseTranscription = transcription.toLowerCase();
  let detectedType = commandType || 'assistance';
  
  // Detectar tipo por palabras clave si no se especificó
  if (!commandType) {
    if (lowercaseTranscription.includes('crear tarea') || lowercaseTranscription.includes('nueva tarea')) {
      detectedType = 'createTask';
    } else if (lowercaseTranscription.includes('crear proyecto') || lowercaseTranscription.includes('nuevo proyecto')) {
      detectedType = 'createProject';
    } else if (lowercaseTranscription.includes('buscar') || lowercaseTranscription.includes('encontrar')) {
      detectedType = 'searchTask';
    } else if (lowercaseTranscription.includes('actualizar') || lowercaseTranscription.includes('modificar')) {
      detectedType = 'updateTask';
    }
  }
  
  // Generar respuesta basada en palabras clave
  switch (detectedType) {
    case 'createTask': {
      // Extraer título básico
      const titleMatch = transcription.match(/(?:crear|nueva) tarea (?:llamada|titulada|con nombre|con título)? ?["']?([^"'.,]+)["']?/i);
      const title = titleMatch ? titleMatch[1].trim() : "Nueva tarea";
      
      // Intentar extraer estado
      let status = 'pending';
      if (lowercaseTranscription.includes('en progreso')) status = 'in_progress';
      else if (lowercaseTranscription.includes('completada')) status = 'completed';
      else if (lowercaseTranscription.includes('cancelada')) status = 'cancelled';
      
      // Intentar extraer fecha límite básica
      let completionDate = new Date();
      if (lowercaseTranscription.includes('mañana')) {
        completionDate.setDate(completionDate.getDate() + 1);
      } else if (lowercaseTranscription.includes('próxima semana')) {
        completionDate.setDate(completionDate.getDate() + 7);
      } else if (lowercaseTranscription.includes('próximo mes')) {
        completionDate.setMonth(completionDate.getMonth() + 1);
      }
      
      return res.json({
        success: true,
        action: 'createTask',
        taskDetails: {
          title: title,
          description: 'Tarea creada por comando de voz',
          status: status,
          completion_date: completionDate.toISOString().split('T')[0],
          projectId: projectId
        }
      });
    }
    
    case 'createProject': {
      // Extraer título básico
      const titleMatch = transcription.match(/(?:crear|nuevo) proyecto (?:llamado|titulado|con nombre|con título)? ?["']?([^"'.,]+)["']?/i);
      const title = titleMatch ? titleMatch[1].trim() : "Nuevo proyecto";
      
      // Intentar extraer prioridad
      let priority = 'medium';
      if (lowercaseTranscription.includes('alta') || lowercaseTranscription.includes('urgente')) {
        priority = 'high';
      } else if (lowercaseTranscription.includes('baja')) {
        priority = 'low';
      }
      
      return res.json({
        success: true,
        action: 'createProject',
        projectDetails: {
          title: title,
          description: 'Proyecto creado por comando de voz',
          priority: priority,
          culmination_date: null,
          creation_date: new Date().toISOString()
        }
      });
    }
    
    case 'searchTask': {
      // Extraer término de búsqueda básico
      const searchMatch = transcription.match(/(?:buscar|encontrar|mostrar) (?:tareas? (?:sobre|de|con))? ?["']?([^"'.,]+)["']?/i);
      const searchTerm = searchMatch ? searchMatch[1].trim() : "";
      
      return res.json({
        success: true,
        action: 'searchTasks',
        searchParams: {
          searchTerm: searchTerm,
          status: null,
          dateRange: null,
          projectId: projectId
        }
      });
    }
    
    case 'assistance':
    default:
      return res.json({
        success: true,
        response: '¿En qué puedo ayudarte? Puedes pedirme crear tareas o proyectos, buscar información o ayudarte con la gestión de tus actividades.'
      });
  }
}

// Detectar automáticamente el tipo de comando basado en la transcripción
async function detectCommandType(transcription) {
  try {
    if (!openai) {
      throw new Error('Cliente OpenAI no inicializado');
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", // Usar modelo más básico y económico
      messages: [
        { 
          role: "system", 
          content: "Eres un asistente especializado en detectar tipos de comandos de voz para un sistema de gestión de tareas. Tu función es analizar la transcripción y determinar de qué tipo es." 
        },
        { 
          role: "user", 
          content: `Analiza esta transcripción: "${transcription}" y clasifícala en una de estas categorías: "createTask" (si está solicitando crear una tarea), "createProject" (si está solicitando crear un proyecto), "searchTask" (si está buscando tareas), "updateTask" (si está actualizando una tarea existente), "assistance" (si está pidiendo ayuda o información general). Responde solo con el tipo, sin explicación.` 
        }
      ],
      max_tokens: 20, // Limitamos los tokens para obtener solo la clasificación
      temperature: 0.3,
    });

    // Extraer el tipo de comando identificado
    const detectedType = completion.choices[0].message.content.trim().toLowerCase();
    
    // Validar que el tipo sea uno de los aceptados
    const validTypes = ['createtask', 'createproject', 'searchtask', 'updatetask', 'assistance'];
    for (const validType of validTypes) {
      if (detectedType.includes(validType)) {
        return validType;
      }
    }
    
    // Si no coincide con ninguno de los tipos esperados, devolver "assistance" por defecto
    return 'assistance';
  } catch (error) {
    logger.error(`Error al detectar tipo de comando: ${error.message}`);
    return 'assistance'; // Por defecto, tratar como una solicitud de asistencia
  }
}

// Procesar un comando para crear una tarea
async function processCreateTaskCommand(transcription, projectId) {
  try {
    // Verificar que el proyecto existe si se proporcionó un ID
    if (projectId) {
      const project = await Project.findByPk(projectId);
      if (!project) {
        return {
          success: false,
          error: 'Proyecto no encontrado'
        };
      }
    }

    if (!openai) {
      throw new Error('Cliente OpenAI no inicializado');
    }

    // Usar LLM para extraer detalles de la tarea desde la transcripción
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", // Usar modelo más básico y económico
      messages: [
        { 
          role: "system", 
          content: `Eres un asistente especializado en extraer detalles de tareas para un sistema de gestión de proyectos. 
          Estructura de una tarea:
          - title: Título de la tarea (obligatorio)
          - description: Descripción de la tarea (opcional)
          - status: Estado de la tarea (in_progress, completed, pending, cancelled)
          - completion_date: Fecha límite de la tarea en formato YYYY-MM-DD` 
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
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 300, // Limitamos los tokens para la respuesta
    });

    // Extraer y analizar la respuesta
    const taskDetails = JSON.parse(completion.choices[0].message.content);
    
    // Validar que al menos tengamos un título
    if (!taskDetails.title) {
      return {
        success: false,
        error: 'No se pudo identificar el título de la tarea'
      };
    }

    // Asegurar que tengamos valores para todos los campos
    const formattedTaskDetails = {
      title: taskDetails.title,
      description: taskDetails.description || '',
      status: taskDetails.status || 'pending',
      completion_date: taskDetails.completion_date || new Date().toISOString().split('T')[0],
      projectId: projectId
    };

    // No creamos la tarea automáticamente para permitir confirmación del usuario
    return {
      success: true,
      action: 'createTask',
      taskDetails: formattedTaskDetails
    };
  } catch (error) {
    logger.error(`Error al procesar comando de creación de tarea: ${error.message}`);
    // Implementar fallback para cuando hay un error
    const titleMatch = transcription.match(/(?:crear|nueva) tarea (?:llamada|titulada|con nombre|con título)? ?["']?([^"'.,]+)["']?/i);
    const title = titleMatch ? titleMatch[1].trim() : "Nueva tarea";
    
    return {
      success: true,
      action: 'createTask',
      taskDetails: {
        title: title,
        description: 'Tarea creada por comando de voz',
        status: 'pending',
        completion_date: new Date().toISOString().split('T')[0],
        projectId: projectId
      }
    };
  }
}

// Procesar un comando para crear un proyecto
async function processCreateProjectCommand(transcription) {
  try {
    if (!openai) {
      throw new Error('Cliente OpenAI no inicializado');
    }

    // Usar LLM para extraer detalles del proyecto desde la transcripción
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", // Usar modelo más básico y económico
      messages: [
        { 
          role: "system", 
          content: `Eres un asistente especializado en extraer detalles de proyectos para un sistema de gestión.
          Estructura de un proyecto:
          - title: Título del proyecto (obligatorio)
          - description: Descripción del proyecto (opcional)
          - culmination_date: Fecha de culminación del proyecto en formato YYYY-MM-DD (opcional)
          - priority: Prioridad del proyecto (high, medium, low)` 
        },
        { 
          role: "user", 
          content: `Analiza esta transcripción: "${transcription}" 
          Extrae los detalles del proyecto que se está solicitando crear. 
          Devuelve SOLO un objeto JSON con los campos title, description, culmination_date y priority.
          Si no hay información sobre algún campo, déjalo como null o con un valor por defecto apropiado.
          Para culmination_date, si no se especifica una fecha exacta pero se menciona un plazo (como "para fin de año"), calcula la fecha correspondiente.
          Para priority, si no se especifica, usa "medium" como valor por defecto.` 
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 300, // Limitamos los tokens para la respuesta
    });

    // Extraer y analizar la respuesta
    const projectDetails = JSON.parse(completion.choices[0].message.content);
    
    // Validar que al menos tengamos un título
    if (!projectDetails.title) {
      return {
        success: false,
        error: 'No se pudo identificar el título del proyecto'
      };
    }

    // Verificar si ya existe un proyecto con ese título (deben ser únicos)
    const existingProject = await Project.findOne({
      where: {
        title: projectDetails.title
      }
    });

    if (existingProject) {
      return {
        success: false,
        error: 'Ya existe un proyecto con ese título'
      };
    }

    // Asegurar que tengamos valores para todos los campos
    const formattedProjectDetails = {
      title: projectDetails.title,
      description: projectDetails.description || '',
      priority: projectDetails.priority || 'medium',
      culmination_date: projectDetails.culmination_date || null,
      creation_date: new Date().toISOString()
    };

    // No creamos el proyecto automáticamente para permitir confirmación del usuario
    return {
      success: true,
      action: 'createProject',
      projectDetails: formattedProjectDetails
    };
  } catch (error) {
    logger.error(`Error al procesar comando de creación de proyecto: ${error.message}`);
    
    // Implementar fallback para cuando hay un error
    const titleMatch = transcription.match(/(?:crear|nuevo) proyecto (?:llamado|titulado|con nombre|con título)? ?["']?([^"'.,]+)["']?/i);
    const title = titleMatch ? titleMatch[1].trim() : "Nuevo proyecto";
    
    return {
      success: true,
      action: 'createProject',
      projectDetails: {
        title: title,
        description: 'Proyecto creado por comando de voz',
        priority: 'medium',
        culmination_date: null,
        creation_date: new Date().toISOString()
      }
    };
  }
}

// Procesar un comando para buscar tareas
async function processSearchTaskCommand(transcription) {
  try {
    if (!openai) {
      throw new Error('Cliente OpenAI no inicializado');
    }

    // Usar LLM para extraer criterios de búsqueda desde la transcripción
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", // Usar modelo más básico y económico
      messages: [
        { 
          role: "system", 
          content: `Eres un asistente especializado en extraer criterios de búsqueda para un sistema de gestión de tareas.` 
        },
        { 
          role: "user", 
          content: `Analiza esta transcripción: "${transcription}" 
          Extrae los criterios de búsqueda para tareas, que pueden incluir:
          - searchTerm: palabras clave para buscar en el título o descripción
          - status: estado de las tareas (in_progress, completed, pending, cancelled)
          - dateRange: rango de fechas en formato {from: "YYYY-MM-DD", to: "YYYY-MM-DD"}
          
          Devuelve SOLO un objeto JSON con estos campos. Si algún criterio no está presente, omítelo del objeto.` 
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 300, // Limitamos los tokens para la respuesta
    });

    // Extraer y analizar la respuesta
    const searchParams = JSON.parse(completion.choices[0].message.content);
    
    // Construir la respuesta
    return {
      success: true,
      action: 'searchTasks',
      searchParams
    };
  } catch (error) {
    logger.error(`Error al procesar comando de búsqueda: ${error.message}`);
    
    // Implementar fallback para cuando hay un error
    const searchMatch = transcription.match(/(?:buscar|encontrar|mostrar) (?:tareas? (?:sobre|de|con))? ?["']?([^"'.,]+)["']?/i);
    const searchTerm = searchMatch ? searchMatch[1].trim() : "";
    
    return {
      success: true,
      action: 'searchTasks',
      searchParams: {
        searchTerm: searchTerm
      }
    };
  }
}

// Procesar un comando para actualizar una tarea
async function processUpdateTaskCommand(transcription) {
  try {
    if (!openai) {
      throw new Error('Cliente OpenAI no inicializado');
    }

    // Usar LLM para extraer detalles de la actualización
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", // Usar modelo más básico y económico
      messages: [
        { 
          role: "system", 
          content: `Eres un asistente especializado en extraer detalles para actualizar tareas en un sistema de gestión de proyectos.` 
        },
        { 
          role: "user", 
          content: `Analiza esta transcripción: "${transcription}" 
          Extrae los detalles de la actualización de tarea, incluyendo:
          - taskIdentifier: Palabras exactas o número que identifique la tarea a actualizar
          - updates: Objeto con los campos a actualizar, que pueden incluir:
            - title: Nuevo título
            - description: Nueva descripción
            - status: Nuevo estado (in_progress, completed, pending, cancelled)
            - completion_date: Nueva fecha límite en formato YYYY-MM-DD
          
          Devuelve SOLO un objeto JSON con estos campos. Incluye en 'updates' solo los campos que realmente se van a actualizar.` 
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 300, // Limitamos los tokens para la respuesta
    });

    // Extraer y analizar la respuesta
    const updateDetails = JSON.parse(completion.choices[0].message.content);
    
    // Validar que tengamos un identificador y al menos un campo a actualizar
    if (!updateDetails.taskIdentifier || !updateDetails.updates || Object.keys(updateDetails.updates).length === 0) {
      return {
        success: false,
        error: 'No se pudo identificar la tarea o los campos a actualizar'
      };
    }

    return {
      success: true,
      action: 'updateTask',
      updateDetails
    };
  } catch (error) {
    logger.error(`Error al procesar comando de actualización: ${error.message}`);
    
    // Fallback simple
    return {
      success: false,
      error: 'No se pudo procesar la solicitud de actualización de tarea'
    };
  }
}

// Procesar un comando de asistencia general
// Procesar un comando de asistencia general con información contextual
async function processAssistanceCommand(transcription, projectsContext = [], tasksContext = []) {
  try {
    if (!openai) {
      throw new Error('Cliente OpenAI no inicializado');
    }

    // Crear un prompt con contexto
    let contextPrompt = '';
    
    if (projectsContext.length > 0) {
      contextPrompt += `\nInformación de proyectos del usuario:
${JSON.stringify(projectsContext, null, 2)}`;
    }
    
    if (tasksContext.length > 0) {
      contextPrompt += `\nInformación de tareas:
${JSON.stringify(tasksContext, null, 2)}`;
    }

    // Usar LLM para generar una respuesta de asistencia
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", // Usar modelo más básico y económico
      messages: [
        { 
          role: "system", 
          content: `Eres un asistente virtual para un sistema de gestión de tareas llamado SmartTask. 
          Puedes ayudar con información sobre cómo usar la aplicación, responder preguntas sobre gestión de proyectos y tareas, 
          y ofrecer consejos para mejorar la productividad.
          
          Características de SmartTask:
          - Creación y gestión de proyectos con títulos, descripciones, fechas y prioridades
          - Creación y gestión de tareas dentro de cada proyecto
          - Las tareas tienen título, descripción, estado y fecha límite
          - Estados de tarea: pendiente, en progreso, completada, cancelada
          - Visualización de estadísticas en un dashboard
          
          ${contextPrompt}
          
          Mantén tus respuestas concisas, útiles y enfocadas en ayudar al usuario con su sistema de gestión de tareas.` 
        },
        { 
          role: "user", 
          content: `El usuario ha dicho: "${transcription}"
          Proporciona una respuesta útil y concisa. No uses más de 3-4 oraciones.` 
        }
      ],
      temperature: 0.7,
      max_tokens: 150, // Limitar la longitud de la respuesta
    });

    // Extraer la respuesta
    const assistantResponse = completion.choices[0].message.content.trim();
    
    return {
      success: true,
      response: assistantResponse
    };
  } catch (error) {
    logger.error(`Error al procesar comando de asistencia: ${error.message}`);
    
    // Proveer una respuesta predeterminada en caso de error
    return {
      success: true,
      response: '¿En qué puedo ayudarte? Puedo asistirte con la creación de tareas y proyectos, o ayudarte a buscar información en tu sistema de gestión de tareas.'
    };
  }
}

module.exports = router;