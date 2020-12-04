import * as dotenv from 'dotenv'

dotenv.config()

export const environment = {
    NODE_ENV : 'development',
    BASE_URL : process.env.BASE_URL || 'http://localhost:3030',
    PORT : process.env.PORT || 1900,
    WEBDAV_ROOT: process.env.WEBDAV_ROOT || '/remote.php/dav/files/lehrer@schul-cloud.org/'
};

