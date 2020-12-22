import * as dotenv from 'dotenv'

dotenv.config()

const {NODE_ENV = 'development'} = process.env
/* 
NODE_ENV is one of: ['development', 'production']
LOG_LEVEL can be set to: ['debug','info','warn','error']
*/ 

let defaultLogLevel = null;
switch (NODE_ENV) {
	case 'development':
		defaultLogLevel = 'info';
		break;
	case 'production':
		defaultLogLevel = 'warn';
		break;
	default:
		defaultLogLevel = 'debug';
}

export const environment = {
    NODE_ENV,
    BASE_URL : process.env.BASE_URL || 'http://localhost:3030',
    PORT : process.env.PORT || 1900,
    WEBDAV_ROOT: process.env.WEBDAV_ROOT || '/remote.php/webdav/',
    LOG_LEVEL: process.env.LOG_LEVEL ||defaultLogLevel,
};

