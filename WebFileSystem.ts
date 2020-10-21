import {v2 as webdav} from "webdav-server";
import * as fetch from 'node-fetch'
import * as mime from 'mime-types'
import {Path} from "webdav-server/lib/manager/v2/Path";
import {
    CreateInfo,
    CreationDateInfo,
    DeleteInfo,
    LastModifiedDateInfo,
    LockManagerInfo,
    MoveInfo,
    OpenReadStreamInfo,
    OpenWriteStreamInfo,
    PropertyManagerInfo,
    ReadDirInfo,
    RenameInfo,
    SizeInfo,
    TypeInfo
} from "webdav-server/lib/manager/v2/fileSystem/ContextInfo";
import {ReturnCallback, SimpleCallback} from "webdav-server/lib/manager/v2/fileSystem/CommonTypes";
import {Readable, Writable} from "stream";
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
     * Populates permissions by combining user and roles permissions
     *
     * @param {Array<any>} permissions   Permissions of one file or directory
     * @param {User} user   Current user
     *
     * @return {any}  Permission object containing write, read, create and delete permissions
     */
    populatePermissions(permissions: Array<any>, user: User): any {
        let filePermissions = {
            write: false,
            read: false,
            create: false,
            delete: false
        }

        const userPerm = permissions.find(permission => permission.refPermModel === 'user' && permission.refId === user.uid)
        if (userPerm) {
            filePermissions.write = userPerm.write
            filePermissions.read = userPerm.read
            filePermissions.create = userPerm.create
            filePermissions.delete = userPerm.delete
        }

        for (const role of user.roles) {
            const rolePerm = permissions.find(permission => permission.refPermModel === 'role' && permission.refId === role)
            if (rolePerm) {
                filePermissions.write = rolePerm.write ? true : filePermissions.write
                filePermissions.read = rolePerm.read ? true : filePermissions.read
                filePermissions.create = rolePerm.create ? true : filePermissions.create
                filePermissions.delete = rolePerm.delete ? true : filePermissions.delete
            }
        }

        return filePermissions
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

            const permissions = this.populatePermissions(resource.permissions, user)

            /*
            *   Could be simpler than current population strategy:
            *
            const permissionRes = await fetch(environment.BASE_URL + '/fileStorage/permission?file=' + resource._id, {
                headers: {
                    'Authorization': 'Bearer ' + user.jwt
                }
            })

            logger.info(await permissionRes.json())
             */

            this.resources.get(user.uid).set(path.getChildPath(resource.name).toString(), {
                type: resource.isDirectory ? webdav.ResourceType.Directory : webdav.ResourceType.File,
                id: resource._id,
                size: resource.size,
                creationDate: creationDate.getTime(),
                lastModifiedDate: lastModifiedDate.getTime(),
                permissions
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

    async _openReadStream (path: Path, info: OpenReadStreamInfo, callback: ReturnCallback<Readable>) : Promise<void> {
        logger.info("Reading file: " + path)

        if (info.context.user) {
            this.createUserFileSystem(info.context.user.uid)
            const url = await this.retrieveSignedUrl(path, <User> info.context.user)

            logger.info("Signed URL: " + url)

            // TODO: URL should be cached in resources (but needs to be renewed sometimes)

            if (url) {
                const file = await fetch(url)
                const buffer = await file.buffer()

                callback(null, new webdav.VirtualFileReadable([ buffer ]))
            } else {
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
        callback(null, this.props)
    }

    _lockManager (path: Path, info:LockManagerInfo, callback:ReturnCallback<ILockManager>) : void {
        logger.info("Calling Lock Manager: " + path)
        callback(null, this.locks)
    }

    async _type(path: Path, info: TypeInfo, callback: ReturnCallback<ReturnType<any>>): Promise<void> {
        logger.info("Checking type: " + path)

        if (info.context.user) {
            const user: User = <User> info.context.user
            this.createUserFileSystem(user.uid)

            if (!path.hasParent()) {
                callback(null, webdav.ResourceType.Directory);
            } else if (this.resources.get(user.uid).has(path.toString())) {
                callback(null, this.resources.get(user.uid).get(path.toString()).type)
            } else {
                if (await this.loadPath(path, user)) {
                    callback(null, this.resources.get(user.uid).get(path.toString()).type)
                } else {
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

    /*
     * Creates resource with given path (only docx, pptx or xlsx)
     *
     * @param {Path} path   Path of the resource
     * @param {User} user   Current user
     * @param {webdav.ResourceType} type   Type of the new resource
     *
     * @return {Promise<Error>}   Error or null depending on success of creation
     */
    async createResource (path: Path, user: User, type: webdav.ResourceType) : Promise<Error> {
        const owner: string = this.resources.get(user.uid).get('/' + path.rootName()).id
        const parent: string = this.resources.get(user.uid).get(path.getParent().toString()).id

        // TODO: Manage permissions

        const res = await fetch(environment.BASE_URL + '/fileStorage' + (type.isDirectory ? '/directories' : '/files/new'), {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + user.jwt,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: path.fileName(),
                owner,
                parent: (parent != owner) ? parent : undefined
            })
        })

        const data = await res.json()

        // TODO: Add file to resources

        logger.info(data)

        // TODO: Handle non Microsoft Office options (maybe we don't need that, because it seems to work without them)
        /*
        if (!data._id) {
            return webdav.Errors.InvalidOperation
        }
         */

        return null
    }

    async _create(path: Path, ctx: CreateInfo, callback: SimpleCallback) {
        logger.info("Creating resource: " + path)

        if (ctx.context.user) {
            this.createUserFileSystem(ctx.context.user.uid)
            if (this.resources.get(ctx.context.user.uid).has(path.getParent().toString())) {
                const error = await this.createResource(path, <User> ctx.context.user, ctx.type)
                callback(error)
            } else {
                if (await this.loadPath(path.getParent(), <User> ctx.context.user)) {
                    const error = await this.createResource(path, <User> ctx.context.user, ctx.type)
                    callback(error)
                } else {
                    callback(webdav.Errors.ResourceNotFound)
                }
            }
        } else {
            callback(webdav.Errors.BadAuthentication)
        }
    }

    /*
     * Deletes resource with given path
     *
     * @param {Path} path   Path of the resource
     * @param {User} user   Current user
     *
     * @return {Promise<Error>}   Error or null depending on success of deletion
     */
    async deleteResource (path: Path, user: User) : Promise<Error> {
        if (this.resources.get(user.uid).get(path.toString()).permissions.delete) {
            const type: webdav.ResourceType = this.resources.get(user.uid).get(path.toString()).type
            const res = await fetch(environment.BASE_URL + '/fileStorage' + (type.isDirectory ? '/directories?_id=' : '?_id=') + this.resources.get(user.uid).get(path.toString()).id, {
                method: 'DELETE',
                headers: {
                    'Authorization': 'Bearer ' + user.jwt
                }
            })

            const data = await res.json()

            logger.info(data)

            this.resources.get(user.uid).delete(path.toString())

            return null
        } else {
            return webdav.Errors.Forbidden
        }
    }

    async _delete(path: Path, ctx: DeleteInfo, callback: SimpleCallback) {
        logger.info("Deleting resource: " + path)

        if (ctx.context.user) {
            this.createUserFileSystem(ctx.context.user.uid)
            if (this.resources.get(ctx.context.user.uid).has(path.toString())) {
                const error = await this.deleteResource(path, <User> ctx.context.user)
                callback(error)
            } else {
                if (await this.loadPath(path, <User> ctx.context.user)) {
                    const error = await this.deleteResource(path, <User> ctx.context.user)
                    callback(error)
                } else {
                    callback(webdav.Errors.ResourceNotFound)
                }
            }
        } else {
            callback(webdav.Errors.BadAuthentication)
        }
    }

    async retrieveSignedUrl (path: Path, user: User): Promise<string> {
        const res = await fetch(environment.BASE_URL + '/fileStorage/signedUrl?file=' + this.resources.get(user.uid).get(path.toString()).id, {
            headers: {
                'Authorization': 'Bearer ' + user.jwt
            }
        })

        const data = await res.json()
        
        return data.url
    }

    async requestSignedUrl (path: Path, user: User) {
        const filename = path.fileName()
        const contentType = mime.lookup(filename) || 'application/octet-stream'
        const parent = this.resources.get(user.uid).get(path.getParent().toString()).id

        const res = await fetch(environment.BASE_URL + '/fileStorage/signedUrl', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + user.jwt,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                filename,
                fileType: contentType,
                parent: this.resources.get(user.uid).get('/' + path.rootName()).id != parent ? parent : undefined,
                action: 'putObject'
            })
        })

        return await res.json()
    }

    async writeToSignedUrl (url: string, header: any, content) {
        const res = await fetch(url, {
            method: 'PUT',
            headers: {
                ...header
            },
            body: Buffer.concat(content),
        })
    }

    async writeToFileStorage (path: Path, user: User, header, content) {
        const owner = this.resources.get(user.uid).get('/' + path.rootName()).id
        const parent = this.resources.get(user.uid).get(path.getParent().toString()).id
        const type = mime.lookup(path.fileName()) || 'application/octet-stream'

        const res = await fetch(environment.BASE_URL + '/fileStorage', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + user.jwt,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: path.fileName(),
                owner,
                parent: parent != owner ? parent : undefined,
                type,
                size: Buffer.concat(content).byteLength,
                storageFileName: header['x-amz-meta-flat-name'],
                thumbnail: header['x-amz-meta-thumbnail']
            })
        })

        return await res.json()
    }

    async processStream(path: Path, user: User, contents: Array<any>) {
        let stream = new webdav.VirtualFileWritable(contents)

        stream.on('finish', async () => {
            const data = await this.requestSignedUrl(path, user)
            await this.writeToSignedUrl(data.url, data.header, contents)
            const file = await this.writeToFileStorage(path, user, data.header, contents)

            const creationDate = new Date(file.createdAt)
            const lastModifiedDate = new Date(file.updatedAt)
            const permissions = this.populatePermissions(file.permissions, user)

            this.resources.get(user.uid).set(path.toString(), {
                type: webdav.ResourceType.File,
                id: file._id,
                size: file.size,
                creationDate: creationDate.getTime(),
                lastModifiedDate: lastModifiedDate.getTime(),
                permissions
            })
        })

        return stream
    }

    async _openWriteStream(path: Path, ctx: OpenWriteStreamInfo, callback: ReturnCallback<Writable>) {
        logger.info("Writing file: " + path)

        if (ctx.context.user) {
            const user: User = <User> ctx.context.user
            this.createUserFileSystem(user.uid)

            if (this.resources.get(user.uid).has(path.toString())) {
                logger.info('Resource exists')
                const url = await this.retrieveSignedUrl(path, user)

                const file = await fetch(url)
                const buffer = await file.buffer()

                const stream = await this.processStream(path, user, [ buffer ])

                callback(null, stream)
            } else {
                logger.info('Resource doesn\'t exist')

                const stream = await this.processStream(path, user, [])

                callback(null, stream)
            }
        } else {
            callback(webdav.Errors.BadAuthentication)
        }
    }

    _move(pathFrom: Path, pathTo: Path, ctx: MoveInfo, callback: ReturnCallback<boolean>) {
        logger.info("Moving file: " + pathFrom + " --> " + pathTo)

        if (ctx.context.user) {
            // TODO (Apparently not possible with SC-API)
            callback(webdav.Errors.Forbidden)
        } else {
            callback(webdav.Errors.BadAuthentication)
        }
    }

    /*
     * Renames resource with given path
     *
     * @param {Path} path   Path of the resource
     * @param {User} user   Current user
     * @param {string} newName   new name of the resource
     *
     * @return {Promise<Error>}   Error or null depending on success of renaming
     */
    async renameResource (path: Path, user: User, newName: string) : Promise<Error> {
        if (this.resources.get(user.uid).get(path.toString()).permissions.write) {
            const type: webdav.ResourceType = this.resources.get(user.uid).get(path.toString()).type
            const res = await fetch(environment.BASE_URL + '/fileStorage' + (type.isDirectory ? '/directories' : '') + '/rename', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + user.jwt
                },
                body: JSON.stringify({
                    id: this.resources.get(user.uid).get(path.toString()).id,
                    newName
                })
            })

            const data = await res.json()

            logger.info(data)

            return null
        } else {
            return webdav.Errors.Forbidden
        }
    }

   async _rename(pathFrom: Path, newName: string, ctx: RenameInfo, callback: ReturnCallback<boolean>) {
        logger.info("Renaming file: " + pathFrom + " --> " + newName)

        if (ctx.context.user) {
            this.createUserFileSystem(ctx.context.user.uid)
            if (this.resources.get(ctx.context.user.uid).has(pathFrom.toString())) {
                const error = await this.renameResource(pathFrom, <User> ctx.context.user, newName)
                callback(error)
            } else {
                if (await this.loadPath(pathFrom, <User> ctx.context.user)) {
                    const error = await this.renameResource(pathFrom, <User> ctx.context.user, newName)
                    callback(error)
                } else {
                    callback(webdav.Errors.ResourceNotFound)
                }
            }
        } else {
            callback(webdav.Errors.BadAuthentication)
        }
    }
}

export default WebFileSystem;
