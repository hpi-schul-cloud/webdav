require('dotenv').config()

export const environment = {
    NODE_ENV : 'development',
    BASE_URL : process.env.BASE_URL || 'http://localhost:3030',
    PORT : process.env.PORT || 1900
};

