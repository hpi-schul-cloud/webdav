import {v2 as webdav} from "webdav-server";
import * as express from 'express'
import WebFileSystem from "./WebFileSystem";
import UserManager from "./UserManager";
import logger from './logger';
import {environment} from './config/globals';

import bodyParser = require('body-parser');
import bodyParserXml = require('body-parser-xml');

bodyParserXml(bodyParser)

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
let reqCounter = 0;

function reqLabler (req,res ,next) {
    req.counter = reqCounter;
    reqCounter+=1
    next();
}

app.use(reqLabler)
app.use((req, res, next) => {
    logger.error('Calling ' + req.method + ' ' + req.originalUrl + ' --> newUlr: '+req.url + ' - Number: ' + String(reqCounter-1))
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
app.get('/status.php', (req, res) => {
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

/*
app.get('/ocs/v2.php/core/navigation/apps', (req, res) => {
    logger.info('Requesting v2 navigation (JSON)...')
    res.send()
})

// Maybe needs to be answered: https://doc.owncloud.com/server/admin_manual/configuration/user/user_provisioning_api.html
app.get('/ocs/v1.php/cloud/user', (req, res) => {
    logger.info('Requesting v1 user (JSON)...')
    res.send()
})

app.get('/remote.php/dav/avatars/lehrer@schul-cloud.org/128.png', (req, res) => {
    logger.info('Requesting avatar..')
    res.send()
})
 */

// HEAD Request to webdav root maybe needs to be processed, doesn't work until now
app.head('/remote.php/webdav/', (req, res, next) => {
    logger.info('Requesting HEAD of root...')
    res.send()
})

const xmlParser =
app.propfind('/remote.php/dav/files/lehrer@schul-cloud.org/',(req, res, next) => {
    //console.log(req.body)
    //console.log(Object.keys(req.body))
    //Console.log(req.body['d:propfind']['d:prop'])
    //req.body['d:propfind']['d:prop'].array.forEach(element => {
    //    console.log(JSON.stringify(element))
    //});
    const oldUrl = req.url
    const urlParts = oldUrl.split('/')
    const path = urlParts.slice(5)
    req.url = '/remote.php/webdav/'+ path.join('/')
    logger.error(req.url)
    return app._router.handle(req,res,next)
})

function logReqRes(req, res, next) {
    const oldWrite = res.write;
    const oldEnd = res.end;

    const chunks = [];

    res.write = (...restArgs) => {
      chunks.push(Buffer.from(restArgs[0]));
      oldWrite.apply(res, restArgs);
    };

    res.end = (...restArgs) => {
      if (restArgs[0]) {
        chunks.push(Buffer.from(restArgs[0]));
      }
      const body = Buffer.concat(chunks).toString('utf8');

      logger.warn({
        number: req.counter,
        time: new Date().toUTCString(),
        fromIP: req.headers['x-forwarded-for'] ||
        req.connection.remoteAddress,
        method: req.method,
        originalUri: req.originalUrl,
        laterUri: req.url,
        uri: req.url,
        requestData: JSON.stringify(req.body),
        responseData: body,
        referer: req.headers.referer || '',
        ua: req.headers['user-agent']
      });

      // console.log(body);
      oldEnd.apply(res, restArgs);
    };

    next();
  }

  app.use(logReqRes)

// root path doesn't seem to work that easily with all webdav clients, if it doesn't work simply put an empty string there
app.use(webdav.extensions.express(environment.WEBDAV_ROOT, server))

app.listen(environment.PORT, () => {
    logger.info('Ready on port ' + environment.PORT)
})
