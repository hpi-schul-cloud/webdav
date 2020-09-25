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

    serialize(fs: WebFileSystem, callback: ReturnCallback<any>) {
        callback(null, {
            props: fs.props
        });
    }

    unserialize(serializedData: any, callback: ReturnCallback<WebFileSystem>) {
        const fs = new WebFileSystem();
        fs.props = new webdav.LocalPropertyManager(serializedData.props);
        callback(null, fs);
    }
}

class WebFileSystem extends webdav.FileSystem {
    props: webdav.IPropertyManager;
    locks: webdav.ILockManager;

    // TODO: add parameter to switch between 'courses', 'my files', and 'teams'

    constructor () {
        super(new WebFileSystemSerializer());

        this.props = new webdav.LocalPropertyManager();
        this.locks = new webdav.LocalLockManager();
    }

    _fastExistCheck (ctx : RequestContext, path : Path, callback : (exists : boolean) => void) : void {
        console.log("Checking existence: " + path)

        // TODO: Implement real existence check

        callback(true);
    }

    _openReadStream (path: Path, info: OpenReadStreamInfo, callback: ReturnCallback<Readable>) : void {
        console.log("Reading file: " + path)

        // TODO: Actually read file (using fileStorage service - https://github.com/hpi-schul-cloud/schulcloud-server/tree/develop/src/services/fileStorage)

        callback(null, null)
    }

    _readDir (path: Path, info: ReadDirInfo, callback: ReturnCallback<string[] | Path[]>) : void {
        console.log("Reading dir: " + path)

        // TODO: Implement directories other than root (using fileStorage service - https://github.com/hpi-schul-cloud/schulcloud-server/tree/develop/src/services/fileStorage)

        if (path.isRoot()) {
            fetch(process.env.BASE_URL + '/courses', {
                headers: {
                    'Authorization': 'Bearer ' + process.env.JWT
                }
            })
                .then(res => res.json())
                .then(json => {
                    const files = json['data'].map((course) => course.name)
                    callback(null, files)
                })
        } else {
            console.log("Directory not root")
            callback(webdav.Errors.ResourceNotFound)
        }
    }

    _propertyManager (path: Path, info: PropertyManagerInfo, callback: ReturnCallback<IPropertyManager>) : void {
        console.log("Calling Property Manager: " + path)
        callback(null, this.props);
    }

    _lockManager (path: Path, info:LockManagerInfo, callback:ReturnCallback<ILockManager>) : void {
        console.log("Calling Lock Manager: " + path)
        callback(null, this.locks);
    }

    _type (path: Path, info: TypeInfo, callback: ReturnCallback<ReturnType<any>>) : void {
        console.log("Checking type: " + path)

        // TODO: Actually check type

        callback(null, webdav.ResourceType.Directory);
    }
}

export default WebFileSystem;
