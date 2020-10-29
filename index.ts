import {v2 as webdav} from "webdav-server";
import * as express from 'express'
import WebFileSystem from "./WebFileSystem";
import UserManager from "./UserManager";
import logger from './logger';
import {environment} from './config/globals';


// TODO: User Management (same credentials as in web client)

const userManager = new UserManager()

const server = new webdav.WebDAVServer({
    httpAuthentication: new webdav.HTTPBasicAuthentication(userManager)

});

server.setFileSystem('courses', new WebFileSystem('courses'), (succeeded) => {
    if (succeeded) {
        logger.info("Successfully mounted 'courses' file system!")
    }
});

server.setFileSystem('my', new WebFileSystem('my'), (succeeded) => {
    if (succeeded) {
        logger.info("Successfully mounted 'my files' file system!")
    }
});

server.setFileSystem('teams', new WebFileSystem('teams'), (succeeded) => {
    if (succeeded) {
        logger.info("Successfully mounted 'teams' file system!")
    }
});

server.setFileSystem('shared', new WebFileSystem('shared'), (succeeded) => {
    if (succeeded) {
        logger.info("Successfully mounted 'shared' file system!")
    }
});

const app = express()

app.get('/nextcloud/status.php', (req, res) => {
    // TODO: Answer with real data
    res.send({
        installed: true,
        maintenance: false,
        needsDbUpgrade: false,
        version: "10.0.3.3",
        versionstring: "10.0.3",
        edition: "Community",
        productname: "HPI Schul-Cloud"
    })
})

app.get('/ocs/v1.php/cloud/capabilities?format=json', (req, res) => {
    res.send({
        ocs: {
            data: {
                capabilities: {
                    dav: {
                        chunking: "1.0"
                    },
                    core: {
                        'webdav-root' : environment.WEBDAV_ROOT,
                        status: {
                            edition: "Community",
                            installed: "true",
                            needsDbUpgrade: "false",
                            versionstring: "10.0.3",
                            productname: "HPI Schul-Cloud",
                            maintenance: "false",
                            version : "10.0.3.3"
                        },
                        pollinterval: 60
                    }
                }
            }
        }
    })
    // TODO: Send server capabilities as JSON
})

// root path doesn't seem to work that easily with all webdav clients, if it doesn't work simply put an empty string there
app.use(webdav.extensions.express(environment.WEBDAV_ROOT, server))

app.listen(environment.PORT, () => {
    logger.info('Ready on port ' + environment.PORT)
})
