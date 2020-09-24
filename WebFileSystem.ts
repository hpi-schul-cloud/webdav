import {v2 as webdav} from "webdav-server";
import * as fetch from 'node-fetch'
import {Path} from "webdav-server/lib/manager/v2/Path";
import {RequestContext} from "webdav-server/lib/server/v2/RequestContext";
import {
    LockManagerInfo,
    OpenReadStreamInfo, PropertyManagerInfo,
    ReadDirInfo,
    TypeInfo
} from "webdav-server/lib/manager/v2/fileSystem/ContextInfo";
import {ReturnCallback} from "webdav-server/lib/manager/v2/fileSystem/CommonTypes";
import {Readable} from "stream";
import {ILockManager} from "webdav-server/lib/manager/v2/fileSystem/LockManager";
import {IPropertyManager} from "webdav-server/lib/manager/v2/fileSystem/PropertyManager";

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

    constructor (public url: string) {
        super(new WebFileSystemSerializer());

        this.props = new webdav.LocalPropertyManager();
        this.locks = new webdav.LocalLockManager();
    }

    _fastExistCheck (ctx : RequestContext, path : Path, callback : (exists : boolean) => void) {
        callback(path.isRoot());
    }

    _openReadStream (path: Path, info: OpenReadStreamInfo, callback: ReturnCallback<Readable>) {
        fetch(process.env.BASE_URL + '/courses', {
            headers: {
                'Authorization': 'Bearer ' + process.env.JWT
            }
        })
            .then(res => {
                callback(null, res.body)
                return res.json()
            })
            .then(json => {
                console.log(json)
            })
    }

    _readDir (path: Path, info: ReadDirInfo, callback: ReturnCallback<string[] | Path[]>) : void {

    }

    _propertyManager (path: Path, info: PropertyManagerInfo, callback: ReturnCallback<IPropertyManager>) {
        callback(null, this.props);
    }

    _lockManager (path: Path, info:LockManagerInfo, callback:ReturnCallback<ILockManager>) {
        callback(null, this.locks);
    }

    _type (path: Path, info: TypeInfo, callback: ReturnCallback<ReturnType<any>>) {
        callback(null, webdav.ResourceType.File);
    }
}

export default WebFileSystem;
