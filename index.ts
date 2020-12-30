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
    httpAuthentication: new webdav.HTTPBasicAuthentication(userManager),
    respondWithPaths : true
});

/*server.setFileSystem('', new WebFileSystem('my'),(succeeded) => {
        if (succeeded) {
            logger.info("Successfully mounted 'courses' file system!")
        }
})*/
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

let reqCounter = 0;

function reqLabler (req,res ,next) {
    req.counter = reqCounter;
    reqCounter+=1
    next();
}

app.use(reqLabler)
app.use((req, res, next) => {
    logger.error('Calling ' + req.method + ' ' + req.originalUrl + ' --> new URL: '+ req.url + ' - Number: ' + String(reqCounter-1))
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
    "ocs":{
       "meta":{
          "status":"ok",
          "statuscode":100,
          "message":"OK",
          "totalitems":"",
          "itemsperpage":""
       },
       "data":{
          "version":{
             "major":10,
             "minor":5,
             "micro":0,
             "string":"10.5.0",
             "edition":"Community"
          },
          "capabilities":{
             "core":{
                "pollinterval":60,
                "webdav-root":environment.WEBDAV_ROOT,
                "status":{
                   "installed":true,
                   "maintenance":false,
                   "needsDbUpgrade":false,
                   "version":"10.5.0.10",
                   "versionstring":"10.5.0",
                   "edition":"Community",
                   "productname":"HPI-Schul-Cloud",
                   "hostname":"Schul-Cloud"
                }
             },
             "checksums":{
                "supportedTypes":[
                   "SHA1"
                ],
                "preferredUploadType":"SHA1"
             },
             "files":{
                "privateLinks":true,
                "privateLinksDetailsParam":true,
                "bigfilechunking":true,
                "blacklisted_files":[
                   ".htaccess"
                ],
                "undelete":true,
                "versioning":true
             },
             "dav":{
                "chunking":"1.0",
                "reports":[
                   "search-files"
                ],
                "trashbin":"1.0"
             },
             "files_sharing":{
                "api_enabled":true,
                "public":{
                   "enabled":true,
                   "password":{
                      "enforced_for":{
                         "read_only":false,
                         "read_write":false,
                         "upload_only":false,
                         "read_write_delete":false
                      },
                      "enforced":false
                   },
                   "roles_api":true,
                   "expire_date":{
                      "enabled":false
                   },
                   "send_mail":false,
                   "social_share":true,
                   "upload":true,
                   "multiple":true,
                   "supports_upload_only":true,
                   "defaultPublicLinkShareName":"Öffentlicher Link"
                },
                "user":{
                   "send_mail":false,
                   "expire_date":{
                      "enabled":false
                   }
                },
                "group":{
                   "expire_date":{
                      "enabled":false
                   }
                },
                "resharing":true,
                "group_sharing":true,
                "auto_accept_share":true,
                "share_with_group_members_only":true,
                "share_with_membership_groups_only":true,
                "can_share":true,
                "user_enumeration":{
                   "enabled":true,
                   "group_members_only":false
                },
                "default_permissions":31,
                "providers_capabilities":{
                   "ocinternal":{
                      "user":[
                         "shareExpiration"
                      ],
                      "group":[
                         "shareExpiration"
                      ],
                      "link":[
                         "shareExpiration",
                         "passwordProtected"
                      ]
                   },
                   "ocFederatedSharing":{
                      "remote":[

                      ]
                   }
                },
                "federation":{
                   "outgoing":true,
                   "incoming":true
                },
                "search_min_length":2
             },
             "notifications":{
                "ocs-endpoints":[
                   "list",
                   "get",
                   "delete"
                ]
             }
          }
       }
    }
 }

const config = {
    "ocs":{
       "meta":{
          "status":"ok",
          "statuscode":100,
          "message":null
       },
       "data":{
          "version":"1.7",
          "website":"ownCloud",
          "host":"localhost",
          "contact":"",
          "ssl":"false"
       }
    }
}

app.get('/ocs/v1.php/cloud/capabilities', (req, res) => {
    logger.info('Requesting v1 capabilities...')
    res.send(capabilities)
})

// Seems to get requested much earlier, however, nextcloud tries to get /remote.php/webdav
app.get('/ocs/v2.php/cloud/capabilities', (req, res) => {
    logger.info('Requesting v2 capabilities...')
    res.send(capabilities)
})

app.get('/ocs/v2.php/core/navigation/apps', (req, res, next) => {
    logger.info('Requesting v2 navigation...')
    next()
})

app.get('/ocs/v1.php/config', (req, res, next) => {
    logger.info('Requesting v1 config...')
    res.send(config)
})

// Maybe needs to be answered: https://doc.owncloud.com/server/admin_manual/configuration/user/user_provisioning_api.html
// returns HTML:
//     '<!DOCTYPE html>\n' +
//     '<html lang="en">\n' +
//     '<head>\n' +
//     '<meta charset="utf-8">\n' +
//     '<title>Error</title>\n' +
//     '</head>\n' +
//     '<body>\n' +
//     '<pre>Cannot GET /ocs/v1.php/cloud/user</pre>\n' +
//     '</body>\n' +
//     '</html>\n',
app.get('/ocs/v1.php/cloud/user', (req, res, next) => {
    logger.info('Requesting v1 user (JSON)...')
    next()
    /*res.send({
        ocs: {
            meta: {
                statuscode: 100,
                status: 'ok'
            },
            data: {
                users: [
                    'Frank'
                ]
            }
        }
    })
    */
})

// Also returns 404 HTML-Document
app.get('/remote.php/dav/avatars/lehrer@schul-cloud.org/128.png', (req, res, next) => {
    logger.info('Requesting avatar..')
    next()
})

// HEAD Request to webdav root maybe needs to be processed, doesn't work until now
// seems to be like some kind of "status-requests", simply responding with a 200 is sufficcient for now.
app.head('/remote.php/webdav//', (req, res, next) => {
    res.send('')
})

/*
Process:

Calling PROPFIND /remote.php/dav/files/lehrer@schul-cloud.org/ --> new URL: /remote.php/dav/files/lehrer@schul-cloud.org/ - Number: 8
/remote.php/webdav/
Calling PROPFIND /remote.php/dav/files/lehrer@schul-cloud.org/ --> new URL: /remote.php/webdav/ - Number: 9
 */
//app.propfind('/remote.php/dav/files/lehrer@schul-cloud.org/',(req, res, next) => {
    //console.log(req.body)
    //console.log(Object.keys(req.body))
    //Console.log(req.body['d:propfind']['d:prop'])
    //req.body['d:propfind']['d:prop'].array.forEach(element => {
    //    console.log(JSON.stringify(element))
    //});
    //const oldUrl = req.url
    //const urlParts = oldUrl.split('/')
    //const path = urlParts.slice(5)
    //req.url = '/remote.php/webdav/'+ path.join('/')
    //logger.error(req.url)
    //return app._router.handle(req,res,next)
//})

// PROPFIND Request to /remote.php/webdav/ returns weird xml:
// <?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:"><D:response><D:href>http://localhost:1900/remote.php/webdav/</D:href><D:propstat><D:status>HTTP/1.1 200 OK</D:status><D:prop/></D:propstat><D:propstat><D:prop><a:nssize xmlns="http://owncloud.org/ns" xmlns:a="http://owncloud.org:"/></D:prop><D:status>HTTP/1.1 404 Not Found</D:status></D:propstat></D:response></D:multistatus>'

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
        ua: req.headers['user-agent'],
        contentType: res.get('content-type')
      });
      // console.log(body);
      oldEnd.apply(res, restArgs);
    };
    next();
  }
app.use(logReqRes)

// root path doesn't seem to work that easily with all webdav clients, if it doesn't work simply put an empty string there
app.use(webdav.extensions.express(environment.WEBDAV_ROOT, server))
app.use(webdav.extensions.express(environment.WEBDAV_ROOT+'/', server))
app.use(webdav.extensions.express('/remote.php/dav/files/lehrer@schul-cloud.org', server))

app.listen(environment.PORT, () => {
    logger.info('Ready on port ' + environment.PORT)
})
