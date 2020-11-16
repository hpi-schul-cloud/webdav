import * as winston from 'winston';
import {environment} from './config/globals';

const errorFormat = winston.format.combine(
    winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.json()
)

const consoleFormat = winston.format.combine(
    winston.format.colorize({ message: true }),
    winston.format.printf((info) => {
        const timeStamp = new Date().toTimeString().split(' ')[0];
        return `[${timeStamp}] ${info.message}`;}),
) 

const logger = winston.createLogger({
    format: errorFormat,
    transports:[
        // writes all logs with level 'warn' or higher ('error' too) to the error.log
        new winston.transports.File({
            filename: 'logs/error.log',
            level: 'warn',
            maxsize: 10485760, // 10MB
        }),
    ],
})

// if we are not in production then log (everything) to console
if (environment.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
      format: consoleFormat,
    }));
}

export default logger;