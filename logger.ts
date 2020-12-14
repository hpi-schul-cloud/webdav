import * as winston from 'winston';
import {environment} from './config/globals';


class LoggerService{
    logger: winston.Logger;

    constructor() {
        const errorFormat = winston.format.combine(
            winston.format.errors({ stack: true }),
            winston.format.timestamp({
                format: 'YYYY-MM-DD HH:mm:ss'
            }),
            winston.format.json()
        )
        
        const consoleFormat = winston.format.combine(
            winston.format.errors({ stack: true }),
            winston.format.colorize({ message: true }),
            winston.format.printf(({ level, message, stack }) => {
                const timeStamp = new Date().toTimeString().split(' ')[0];
                if (stack)
                    return `[${timeStamp}] ${message} \n${stack}`;
                return `[${timeStamp}] ${message}`;}),
            
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
       this.logger = logger
    }
    async info(message: string, obj?: any) : Promise<void>{
        this.logger.info(message, obj)
    }
    async debug(message: string, obj?: any) : Promise<void> {
        this.logger.debug(message, obj)
    }
    async error(message: string, obj?: any) : Promise<void> {
        this.logger.error(message, obj)
    }
    async warn(message: string, obj? : any) : Promise<void> {
        this.logger.warn(message, obj)
    }    
}

const logger = new LoggerService();

export default logger;