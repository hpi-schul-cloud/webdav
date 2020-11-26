import {v2 as webdav} from "webdav-server";
import * as express from 'express'
import WebFileSystem from "./WebFileSystem";
import UserManager from "./UserManager";
import logger from './logger';
import {environment} from './config/globals';
var bodyParser = require('body-parser');
require('body-parser-xml')(bodyParser)

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

/*
Calling GET /ocs/v1.php/cloud/capabilities?format=json...
Calling GET /ocs/v1.php/config?format=json...
Calling GET /ocs/v1.php/cloud/user?format=json...
Calling GET /remote.php/dav/avatars/lehrer@schul-cloud.org/128.png...
Calling GET /ocs/v2.php/apps/notifications/api/v2/notifications?format=json...
Calling GET /ocs/v2.php/core/navigation/apps?absolute=true&format=json...
 */
app.use((req, res, next) => {
    logger.error('Calling ' + req.method + ' ' + req.originalUrl + '...')
    next()
})

app.get('/nextcloud/status.php', (req, res) => {
    logger.info('Requesting status...')
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

// TODO: Determine what is needed
const capabilities = {
    ocs: {
        data: {
            capabilities: {
                files: {
                    blacklisted_files : [],
                    bigfilechunking: false,
                    privateLinks: false,
                    privateLinksDetailsParam: false,
                    undelete: false,
                    versioning: false
                },
                dav: {
                    chunking: '1.0'
                },
                core: {
                    'webdav-root' : environment.WEBDAV_ROOT,
                    status: {
                        edition: 'Community',
                        installed: 'true',
                        needsDbUpgrade: 'false',
                        versionstring: '10.0.3',
                        productname: 'HPI Schul-Cloud',
                        maintenance: 'false',
                        version : '10.0.3.3'
                    },
                    pollinterval: 60
                }
            }
        }
    }
}

app.get('/ocs/v1.php/cloud/capabilities', (req, res) => {
    logger.info('Requesting v1 capabilities (JSON)...')
    res.send(capabilities)
})

// Seems to get requested much earlier, however, nextcloud tries to get /remote.php/webdav
app.get('/ocs/v2.php/cloud/capabilities', (req, res) => {
    logger.info('Requesting v2 capabilities (JSON)...')
    res.send(capabilities)
})

// HEAD Request to webdav root maybe needs to be processed, doesn't work until now
app.head('/remote.php/webdav/', (req, res, next) => {
    logger.info('Requesting HEAD of root...')
    res.send()
})

const xmlParser = bodyParser.xml()
app.propfind('/remote.php/dav/files/lehrer@schul-cloud.org/', xmlParser,(req, res, next) => {
    console.log(req.body)
    let oldUrl = req.url
    let urlParts = oldUrl.split('/')
    let path = urlParts.slice(5)
    req.url = '/remote.php/webdav/'+ path.join('/')
    logger.error(req.url)
    return app._router.handle(req,res,next)
})

// root path doesn't seem to work that easily with all webdav clients, if it doesn't work simply put an empty string there
app.use(webdav.extensions.express(environment.WEBDAV_ROOT, server))

app.listen(environment.PORT, () => {
    logger.info('Ready on port ' + environment.PORT)
})
