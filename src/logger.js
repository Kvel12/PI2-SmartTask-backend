const winston = require('winston'); // Import the Winston logging library

// Create a logger instance using Winston
const logger = winston.createLogger({
  // Set the logging level to 'info'. Logs with a level of 'info' or higher will be logged.
  level: 'info',

  // Define the format of the log messages
  format: winston.format.combine(
    winston.format.timestamp(), // Add a timestamp to each log message
    winston.format.json()       // Format log messages as JSON
  ),

  // Define the transports (output destinations) for the logs
  transports: [
    new winston.transports.Console(), // Log messages to the console
    new winston.transports.File({ filename: 'error.log', level: 'error' }), // Log 'error' level messages to 'error.log'
    new winston.transports.File({ filename: 'combined.log' }) // Log all messages to 'combined.log'
  ],
});

// Export the logger instance for use in other parts of the application
module.exports = logger;