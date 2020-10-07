require('dotenv').config()

export const environment = {
    NODE_ENV : 'development',
    BASE_URL : process.env.BASE_URL || 'http://localhost:3030',
};

