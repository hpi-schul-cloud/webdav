import {v2 as webdav} from "webdav-server";
import WebFileSystem from "./WebFileSystem";
import UserManager from "./UserManager";
import {AddressInfo} from "net";

require('dotenv').config()

// TODO: User Management (same credentials as in web client)

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

server.setFileSystem('courses', new WebFileSystem(), (succeeded) => {
    if (succeeded) {
        console.log("Successfully mounted 'courses' file system!")
    }
});

server.setFileSystem('my', new WebFileSystem(), (succeeded) => {
    if (succeeded) {
        console.log("Successfully mounted 'my files' file system!")
    }
});

server.setFileSystem('teams', new WebFileSystem(), (succeeded) => {
    if (succeeded) {
        console.log("Successfully mounted 'teams' file system!")
    }
});

server.start((s) => {
    const { port } = s.address() as AddressInfo
    console.log('Ready on port ' + port)
});
