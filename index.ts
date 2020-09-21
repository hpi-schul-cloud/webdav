import {v2 as webdav} from "webdav-server";
import WebFileSystem from "./WebFileSystem";

// User manager (tells who are the users)
const userManager = new webdav.SimpleUserManager();
const user = userManager.addUser('username', 'password', false);

// Privilege manager (tells which users can access which files/folders)
const privilegeManager = new webdav.SimplePathPrivilegeManager();
privilegeManager.setRights(user, '/', [ 'all' ]);

const server = new webdav.WebDAVServer({
    httpAuthentication: new webdav.HTTPDigestAuthentication(userManager, 'Default realm'),
    privilegeManager: privilegeManager
});

server.setFileSystem('courses', new WebFileSystem('/courses'), () => {});

server.start((s) => console.log('Ready on port', s.address().port));
