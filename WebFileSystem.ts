import {v2 as webdav} from "webdav-server";
import * as request from 'request'

class WebFileSystemSerializer implements webdav.FileSystemSerializer {
    uid(): string {
        return "WebFileSystemSerializer_1.0.0";
    }

    serialize(fs, callback) {
        console.log(fs.url);
        callback(null, {
            url: fs.url,
            props: fs.props
        });
    }

    unserialize(serializedData, callback) {
        const fs = new WebFileSystem(serializedData.url);
        fs.props = new webdav.LocalPropertyManager(serializedData.props);
        callback(null, fs);
    }
}

class WebFileSystem extends webdav.FileSystem {
    props: webdav.IPropertyManager;
    locks: webdav.ILockManager;

    constructor(public url: string) {
        super(new WebFileSystemSerializer());

        this.props = new webdav.LocalPropertyManager();
        this.locks = new webdav.LocalLockManager();
    }

    _fastExistCheck = function (ctx, path, callback) {
        callback(path.isRoot());
    }

    _openReadStream = function (path, info, callback) {
        const stream = request.get(this.url);
        stream.end();
        callback(null, stream);
    }

    _propertyManager = function (path, info, callback) {
        callback(null, this.props);
    }

    _lockManager = function (path, info, callback) {
        callback(null, this.locks);
    }

    _type = function (path, info, callback) {
        callback(null, webdav.ResourceType.File);
    }
}

export default WebFileSystem;
