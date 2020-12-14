import * as winston from 'winston';
import {environment} from './config/globals';


class LoggerService{
    log_data: any;
    logger: winston.Logger;

    constructor() {
        this.log_data = null
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
       this.logger = logger
    }
    setLogData(log_data) : void{
      this.log_data = log_data
    }
    async info(message: string, obj?: any) : Promise<void>{
        this.logger.log('info', message, {
            obj
        })
    }
    async debug(message, obj?: any) : Promise<void> {
        this.logger.log('debug', message, {
            obj
        })
    }
    async error(message, obj?) {
        this.logger.log('error', message, {
            obj
        })
    }
    async warn(message, obj?) {
        this.logger.log('warn', message, {
            obj
        })
    }    
}

const logger = new LoggerService();

export default logger;