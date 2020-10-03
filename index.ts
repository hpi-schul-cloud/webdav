import {v2 as webdav} from "webdav-server";
import WebFileSystem from "./WebFileSystem";
import UserManager from "./UserManager";
import {AddressInfo} from "net";

require('dotenv').config()

// TODO: User Management (same credentials as in web client)

const userManager = new UserManager()

const server = new webdav.WebDAVServer({
    httpAuthentication: new webdav.HTTPBasicAuthentication(userManager)
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
