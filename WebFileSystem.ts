import {v2 as webdav} from "webdav-server";
import * as fetch from 'node-fetch'
import {Path} from "webdav-server/lib/manager/v2/Path";
import {RequestContext} from "webdav-server/lib/server/v2/RequestContext";
import {
    CreationDateInfo, DisplayNameInfo, LastModifiedDateInfo,
    LockManagerInfo,
    OpenReadStreamInfo,
    PropertyManagerInfo,
    ReadDirInfo, SizeInfo,
    TypeInfo
} from "webdav-server/lib/manager/v2/fileSystem/ContextInfo";
import {ReturnCallback} from "webdav-server/lib/manager/v2/fileSystem/CommonTypes";
import {Readable} from "stream";
import {ILockManager} from "webdav-server/lib/manager/v2/fileSystem/LockManager";
import {IPropertyManager} from "webdav-server/lib/manager/v2/fileSystem/PropertyManager";
import User from "./User";
import {environment} from './config/globals';
import logger from './logger';

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
    resources: Map<string, Map<string, any>>

    // TODO: add parameter to switch between 'courses', 'my files', and 'teams'

    constructor () {
        super(new WebFileSystemSerializer());

        this.props = new webdav.LocalPropertyManager();
        this.locks = new webdav.LocalLockManager();
        this.resources = new Map();
    }

    /*
     * Loads the resources of the given directory
     *
     * @param {Path} path   Path of the directory
     * @param {User} user   Current user
     *
     * @return {Promise<string[]>}  List of resources in directory
     */
    async loadDirectory (path: Path, user: User) : Promise<string[]> {
        const rootID = this.resources.get(user.uid).get('/' + path.rootName()).id;
        const parentID = this.resources.get(user.uid).get(path.toString()).id;

        const res = await fetch(environment.BASE_URL + '/fileStorage?owner=' + rootID + (parentID != rootID ? '&parent=' + parentID : ''), {
            headers: {
                'Authorization': 'Bearer ' + user.jwt
            }
        })

        const data = await res.json()
        for (const resource of data) {
            const creationDate = new Date(resource.createdAt)
            const lastModifiedDate = new Date(resource.updatedAt)

            logger.info(resource.name)
            logger.info(resource.permissions)

            this.resources.get(user.uid).set(path.getChildPath(resource.name).toString(), {
                type: resource.isDirectory ? webdav.ResourceType.Directory : webdav.ResourceType.File,
                id: resource._id,
                size: resource.size,
                creationDate: creationDate.getTime(),
                lastModifiedDate: lastModifiedDate.getTime(),
                permissions: resource.permissions
            });
        }
        return data.map((resource) => resource.name)
    }

    /*
     * Loads the courses of the user
     *
     * @param {User} user   Current user
     *
     * @return {Promise<string[]>}  List of courses
     */
    async loadCourses(user: User) : Promise<string[]> {
        const res = await fetch(environment.BASE_URL + '/courses', {
            headers: {
                'Authorization': 'Bearer ' + user.jwt
            }
        })
        const data = await res.json()

        for (const course of data['data']) {
            this.resources.get(user.uid).set(new Path([course.name]).toString(), {
                type: webdav.ResourceType.Directory,
                id: course.id
            });
        }

        return data['data'].map((course) => course.name)
    }

    /*
     * Loads every parent path until the given path
     *
     * @param {Path} path   Path to load
     * @param {User} user   Current user
     *
     * @return {Promise<Boolean>}   Returns whether the path exists
     */
    async loadPath(path: Path, user: User) : Promise<Boolean> {
        await this.loadCourses(user)
        let currentPath = path.getParent()
        while (!this.resources.get(user.uid).has(path.toString())) {
            if (this.resources.get(user.uid).has(currentPath.toString())) {
                const resources = await this.loadDirectory(currentPath, user);

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

    /*
     * Returns given metadata of a resource
     *
     * @param {Path} path   Path of the resource
     * @param {string} key  Property name
     * @param {User} user   Current user
     *
     * @return {Promise<number>}   Metadata value
     */
    async getMetadata(path: Path, key: string, user: User) : Promise<number> {
        if (this.resources.get(user.uid).has(path.toString())) {
            const value = this.resources.get(user.uid).get(path.toString())[key]
            if (value) {
                return value
            }
        } else {
            if (await this.loadPath(path, user)) {
                const value = this.resources.get(user.uid).get(path.toString())[key]
                if (value) {
                    return value
                }
            } else {
                return -1
            }
        }
    }

    /*
     * Creates an entry in resources-map if it not exists
     *
     * @param {string} uid   User-ID of the logged in user
     *
     */
    createUserFileSystem(uid: string) {
        if (!this.resources.has(uid)) {
            this.resources.set(uid, new Map())
        }
    }

    _fastExistCheck (ctx : RequestContext, path : Path, callback : (exists : boolean) => void) : void {
        logger.info("Checking existence: " + path)

        // TODO: Implement real existence check

        callback(true);
    }

    async _openReadStream (path: Path, info: OpenReadStreamInfo, callback: ReturnCallback<Readable>) : Promise<void> {
        logger.info("Reading file: " + path)

        if (info.context.user) {
            this.createUserFileSystem(info.context.user.uid)
            const res = await fetch(environment.BASE_URL + '/fileStorage/signedUrl?file=' + this.resources.get(info.context.user.uid).get(path.toString()).id, {
                headers: {
                    'Authorization': 'Bearer ' + (<User>info.context.user).jwt
                }
            })

            const data = await res.json()

            logger.info("Signed URL: ", data.url)

            // TODO: URL should be cached

            if (data.url) {
                const file = await fetch(data.url)
                const buffer = await file.buffer()

                callback(null, new webdav.VirtualFileReadable([ buffer ]))
            } else {
                logger.info(data)
                callback(webdav.Errors.Forbidden)
            }
        } else {
            callback(webdav.Errors.BadAuthentication)
        }
    }

    async _readDir(path: Path, info: ReadDirInfo, callback: ReturnCallback<string[] | Path[]>): Promise<void> {
        logger.info("Reading dir: " + path)

        if (info.context.user) {
            this.createUserFileSystem(info.context.user.uid)
            if (path.isRoot()) {
                callback(null, await this.loadCourses(<User>info.context.user))
            } else {
                if (this.resources.get(info.context.user.uid).has(path.toString())) {
                    const resources = await this.loadDirectory(path, <User>info.context.user)

                    callback(null, resources)
                } else {
                    if (await this.loadPath(path, <User>info.context.user)) {
                        const resources = await this.loadDirectory(path, <User>info.context.user)

                        callback(null, resources)
                    } else {
                        logger.info('Directory could not be found')
                        callback(webdav.Errors.ResourceNotFound)
                    }
                }
            }
        } else {
            callback(webdav.Errors.BadAuthentication)
        }
    }

    _propertyManager (path: Path, info: PropertyManagerInfo, callback: ReturnCallback<IPropertyManager>) : void {
        logger.info("Calling Property Manager: " + path)
        callback(null, this.props);
    }

    _lockManager (path: Path, info:LockManagerInfo, callback:ReturnCallback<ILockManager>) : void {
        logger.info("Calling Lock Manager: " + path)
        callback(null, this.locks);
    }

    async _type(path: Path, info: TypeInfo, callback: ReturnCallback<ReturnType<any>>): Promise<void> {
        logger.info("Checking type: " + path);

        if (info.context.user) {
            this.createUserFileSystem(info.context.user.uid)
            if (!path.hasParent()) {
                callback(null, webdav.ResourceType.Directory);
            } else if (this.resources.get(info.context.user.uid).has(path.toString())) {
                callback(null, this.resources.get(info.context.user.uid).get(path.toString()).type);
            } else {
                if (await this.loadPath(path, <User>info.context.user)) {
                    callback(null, this.resources.get(info.context.user.uid).get(path.toString()).type);
                } else {
                    logger.info('Type could not be identified')
                    callback(webdav.Errors.ResourceNotFound)
                }
            }
        } else {
            callback(webdav.Errors.BadAuthentication)
        }
    }

    async _size(path: Path, ctx: SizeInfo, callback: ReturnCallback<number>) {
        logger.info("Checking size: " + path);

        if (ctx.context.user) {
            this.createUserFileSystem(ctx.context.user.uid)
            const size = await this.getMetadata(path, 'size', <User>ctx.context.user)
            if (size >= 0) {
                callback(null, size)
            } else {
                callback(webdav.Errors.None)
            }
        } else {
            callback(webdav.Errors.BadAuthentication)
        }
    }

    async _creationDate(path: Path, ctx: CreationDateInfo, callback: ReturnCallback<number>) {
        logger.info("Checking creation date: " + path);

        if (ctx.context.user) {
            this.createUserFileSystem(ctx.context.user.uid)
            const creationDate = await this.getMetadata(path, 'creationDate', <User>ctx.context.user)
            if (creationDate >= 0) {
                callback(null, creationDate)
            } else {
                callback(webdav.Errors.None)
            }
        } else {
            callback(webdav.Errors.BadAuthentication)
        }
    }

    async _lastModifiedDate(path: Path, ctx: LastModifiedDateInfo, callback: ReturnCallback<number>) {
        logger.info("Checking last modified date: " + path);

        if (ctx.context.user) {
            this.createUserFileSystem(ctx.context.user.uid)
            const lastModifiedDate = await this.getMetadata(path, 'lastModifiedDate', <User>ctx.context.user)
            if (lastModifiedDate >= 0) {
                callback(null, lastModifiedDate)
            } else {
                callback(webdav.Errors.None)
            }
        } else {
            callback(webdav.Errors.BadAuthentication)
        }
    }
}

export default WebFileSystem;
