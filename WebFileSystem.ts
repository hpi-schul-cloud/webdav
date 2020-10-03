import {v2 as webdav} from "webdav-server";
import * as fetch from 'node-fetch'
import {Path} from "webdav-server/lib/manager/v2/Path";
import {RequestContext} from "webdav-server/lib/server/v2/RequestContext";
import {
    LockManagerInfo,
    OpenReadStreamInfo,
    PropertyManagerInfo,
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
    resources: Map<String, any>

    // TODO: add parameter to switch between 'courses', 'my files', and 'teams'

    constructor () {
        super(new WebFileSystemSerializer());

        this.props = new webdav.LocalPropertyManager();
        this.locks = new webdav.LocalLockManager();
        this.resources = new Map();
    }

    async loadDirectory (path: Path) : Promise<string[]> {
        const rootID = this.resources.get('/' + path.rootName()).id;
        const parentID = this.resources.get(path.toString()).id;

        const res = await fetch(process.env.BASE_URL + '/fileStorage?owner=' + rootID + (parentID != rootID ? '&parent=' + parentID : ''), {
            headers: {
                'Authorization': 'Bearer ' + process.env.JWT
            }
        })

        const data = await res.json()
        for (const resource of data) {
            this.resources.set(path.getChildPath(resource.name).toString(), {
                type: resource.isDirectory ? webdav.ResourceType.Directory : webdav.ResourceType.File,
                id: resource._id
            });
        }
        return data.map((resource) => resource.name)
    }

    async loadCourses() : Promise<string[]> {
        const res = await fetch(process.env.BASE_URL + '/courses', {
            headers: {
                'Authorization': 'Bearer ' + process.env.JWT
            }
        })
        const data = await res.json()

        for (const course of data['data']) {
            this.resources.set(new Path([course.name]).toString(), {
                type: webdav.ResourceType.Directory,
                id: course.id
            });
        }

        return data['data'].map((course) => course.name)
    }

    async loadPath(path: Path) : Promise<Boolean> {
        await this.loadCourses()
        let currentPath = path.getParent()
        while (!this.resources.has(path.toString())) {
            if (this.resources.has(currentPath.toString())) {
                const resources = await this.loadDirectory(currentPath);

                if (!resources.includes(path.paths[currentPath.paths.length])) {
                    return false;
                }

                currentPath = currentPath.getChildPath(path.paths[currentPath.paths.length])
            } else {
                if (currentPath.hasParent()) {
                    currentPath = currentPath.getParent()
                } else {
                    return false;
                }
            }
        }
        return true
    }

    _fastExistCheck (ctx : RequestContext, path : Path, callback : (exists : boolean) => void) : void {
        console.log("Checking existence: " + path)

        // TODO: Implement real existence check

        callback(true);
    }

    async _openReadStream (path: Path, info: OpenReadStreamInfo, callback: ReturnCallback<Readable>) : Promise<void> {
        console.log("Reading file: " + path)

        const res = await fetch(process.env.BASE_URL + '/fileStorage/signedUrl?file=' + this.resources.get(path.toString()).id, {
            headers: {
                'Authorization': 'Bearer ' + process.env.JWT
            }
        })

        const data = await res.json()

        console.log("Signed URL: ", data.url)

        const file = await fetch(data.url)
        const buffer = await file.buffer()

        callback(null, new webdav.VirtualFileReadable([ buffer ]))
    }

    async _readDir(path: Path, info: ReadDirInfo, callback: ReturnCallback<string[] | Path[]>): Promise<void> {
        console.log("Reading dir: " + path)

        if (path.isRoot()) {
            callback(null, await this.loadCourses())
        } else {
            if (this.resources.has(path.toString())) {
                const resources = await this.loadDirectory(path)

                callback(null, resources)
            } else {
                if (await this.loadPath(path)) {
                    const resources = await this.loadDirectory(path)

                    callback(null, resources)
                } else {
                    console.log('Directory could not be found')
                    callback(webdav.Errors.ResourceNotFound)
                }
            }
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

    async _type(path: Path, info: TypeInfo, callback: ReturnCallback<ReturnType<any>>): Promise<void> {
        console.log("Checking type: " + path);

        if (!path.hasParent()) {
            callback(null, webdav.ResourceType.Directory);
        } else if (this.resources.has(path.toString())) {
            callback(null, this.resources.get(path.toString()).type);
        } else {
            if (await this.loadPath(path)) {
                callback(null, this.resources.get(path.toString()).type);
            } else {
                console.log('Type could not be identified')
                callback(webdav.Errors.ResourceNotFound)
            }
        }
    }
}

export default WebFileSystem;
