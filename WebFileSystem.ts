import {v2 as webdav} from "webdav-server";
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
import logger from './logger';
import api from './api';
import {AxiosResponse} from "axios";

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

interface Resource {
    id: string,
    type: webdav.ResourceType,
    size: number,
    creationDate: number,
    lastModifiedDate: number,
    owner?: boolean,
    permissions: {
        read: boolean,
        write: boolean,
        delete: boolean,
        create: boolean
    },
    role?: string,
}

interface ResourceResponse {
    _id: string,
    name: string,
    isDirectory: boolean,
    createdAt: string,
    updatedAt: string,
    permissions: Permissions[],
    size: number
}

interface Permissions {
    read: boolean,
    write: boolean,
    delete: boolean,
    create: boolean,
    refId?: string,
    refPermModel?: string
}

interface S3Header {
    'Content-Type': string,
    'x-amz-meta-name': string,
    'x-amz-meta-flat-name': string,
    'x-amz-meta-thumbnail': string
}

interface WritableURLResponse {
    url: string,
    header: S3Header
}

class WebFileSystem extends webdav.FileSystem {
    props: webdav.IPropertyManager;
    locks: webdav.ILockManager;
    resources: Map<string, Map<string, Resource>>
    rootPath: string

    constructor (rootPath?: string) {
        super(new WebFileSystemSerializer());

        this.props = new webdav.LocalPropertyManager();
        this.locks = new webdav.LocalLockManager();
        this.resources = new Map();
        this.rootPath = rootPath ? rootPath : 'courses'
    }

    _propertyManager (path: Path, info: PropertyManagerInfo, callback: ReturnCallback<IPropertyManager>) : void {
        callback(null, this.props)
    }

    _lockManager (path: Path, info:LockManagerInfo, callback:ReturnCallback<ILockManager>) : void {
        callback(null, this.locks)
    }

    /*
     * Returns whether a given path was already loaded
     *
     * @param {Path} path         Path to resource
     * @param {User} user         Current user
     *
     * @return {boolean}   Existence of resource
     */
    resourceExists(path: Path, user: User): boolean {
        return this.resources.get(user.uid).has(path.toString())
    }

    /*
     * Deletes a given resource from local cache
     *
     * @param {Path} path         Path to resource
     * @param {User} user         Current user
     */
    deleteResourceLocally (path: Path, user: User): void {
        this.resources.get(user.uid).delete(path.toString())
    }

    /*
     * Gets ID by path and user and returns null if resource not loaded
     *
     * @param {Path} path         Path to resource
     * @param {User} user           Current user
     *
     * @return {string}   ID of resource
     */
    getID(path: Path, user: User) : string {
        return this.resourceExists(path, user) ? this.resources.get(user.uid).get(path.toString()).id : null
    }

    /*
     * Gets permissions by path and user and returns null if resource not loaded
     *
     * @param {Path} path         Path to resource
     * @param {User} user           Current user
     *
     * @return {Permissions}   Permissions of resource
     */
    testPermission(path: Path, user: User, permission: string) : boolean {
        return this.resourceExists(path, user) ? this.resources.get(user.uid).get(path.toString()).permissions[permission] : null
    }

    /*
     * Tests read permission of resource and returns null if resource not loaded
     *
     * @param {Path} path         Path to resource
     * @param {User} user           Current user
     *
     * @return {boolean}   Read-permission of file
     */
    canRead(path: Path, user: User) : boolean {
        return this.testPermission(path, user, 'read')
    }

    /*
     * Tests write permission of resource and returns null if resource not loaded
     *
     * @param {Path} path         Path to resource
     * @param {User} user           Current user
     *
     * @return {boolean}   Write-permission of file
     */
    canWrite(path: Path, user: User) : boolean {
        return this.testPermission(path, user, 'write')
    }

    /*
     * Tests create permission of resource and returns null if resource not loaded
     *
     * @param {Path} path         Path to resource
     * @param {User} user           Current user
     *
     * @return {boolean}   Create-permission of file
     */
    canCreate(path: Path, user: User) : boolean {
        return this.testPermission(path, user, 'create')
    }

    /*
     * Tests delete permission of resource and returns null if resource not loaded
     *
     * @param {Path} path         Path to resource
     * @param {User} user           Current user
     *
     * @return {boolean}   Delete-permission of file
     */
    canDelete(path: Path, user: User) : boolean {
        return this.testPermission(path, user, 'delete')
    }

    /*
     * Returns the owner ID of the given resource
     *
     * @param {Path} path   Path of the resource
     * @param {User} user   Current user
     *
     * @return {string}   owner ID
     */
    getOwnerID (path: Path, user: User): string {
        if (this.rootPath === 'my') {
            return user.uid
        } else {
            return this.getID(new Path(path.rootName()), user)
        }
    }

    /*
     * Returns the parent ID of the given resource
     *
     * @param {Path} path   Path of the resource
     * @param {User} user   Current user
     *
     * @return {string}   parent ID
     */
    getParentID (path: Path, user: User): string {
        if (this.rootPath === 'my') {
            return this.resourceExists(path, user) ? this.getID(path, user) : user.uid
        } else {
            return this.getID(path, user)
        }
    }

    /*
     * Returns true if the filename is valid
     *
     * @param {string} name   Name of the file
     *
     * @return {Boolean}    true if fileName is valid, false else
     */
    validFileName(name: string): boolean {
        return !name.match(/[#%^[\],<>?/|~{}]+/)
    }

    /*
     * Loads the root directories of the user
     *
     * @param {User} user   Current user
     *
     * @return {Promise<string[]>}  List of root directories
     */
    async loadRootDirectories(user: User) : Promise<string[]> {
        if (this.rootPath !== 'my') {
            let qs
            let url
            switch (this.rootPath) {
                case 'courses':
                    qs = {$or: [
                        { userIds: user.uid },
                        { teacherIds: user.uid },
                        { substitutionIds: user.uid },
                    ],}
                    url = `/courses`
                    break
                case 'teams':
                    url = `/teams`
                    break
                case 'shared':
                    qs= {
                        $and: [
                            { permissions: { $elemMatch: { refPermModel: 'user', refId: user.uid } } },
                            { creator: { $ne: user.uid } },
                        ],
                    }
                    url= `/files`
                    break
                default:
                    return []
            }
            const res = await api({user}).get(url, {params: qs})

            const data = res.data
            logger.info(data)

            // TODO: make this look fancy :)
            let adder
            if (this.rootPath === 'shared'){
                adder = this.addFileToResources.bind(this)
            } else {
                adder = (path: Path, user: User, resource : ResourceResponse) => {
                    this.resources.get(user.uid).set(path.toString(), {
                        type: webdav.ResourceType.Directory,
                        id: resource._id,
                        size: null,
                        creationDate: null,
                        lastModifiedDate: null,
                        permissions: null
                   });
                }
            }

            for (const resource of data.data) {
                adder(new Path([resource.name]), user, resource)

                // TODO: Maybe can be integrated more beautiful
                if (this.rootPath === 'teams') {
                    const res = await api({user}).get('/teams/' + resource._id)

                    logger.debug(res.data)

                    this.resources.get(user.uid).get('/' + resource.name).role = res.data.user.role
                }
            }

            return data['data'].map((resource) => resource.name)
        } else {
            return await this.loadDirectory(new Path([]), user)
        }
    }

    /*
     * Populates permissions by combining user and roles permissions
     *
     * @param {Array<Permissions>} permissions   Permissions of one file or directory
     * @param {User} user   Current user
     *
     * @return {Permissions}  Permission object containing write, read, create and delete permissions
     */
    populatePermissions(file: ResourceResponse, path: Path, user: User): Permissions {
        const filePermissions = {
            write: false,
            read: false,
            create: false,
            delete: false
        }

        // TODO: Make it prettier
        file.permissions.filter((role) => (role.refPermModel == 'user' && role.refId == user.uid) ||
            (role.refPermModel == 'role' && (user.roles.includes(role.refId) ||
                (this.rootPath === 'teams' && role.refId == this.resources.get(user.uid).get('/' + path.rootName()).role))))
            .forEach((role) => {
                filePermissions.write = role.write ? true : filePermissions.write
                filePermissions.read = role.read ? true : filePermissions.read
                filePermissions.create = role.create ? true : filePermissions.create
                filePermissions.delete = role.delete ? true : filePermissions.delete
            })

        logger.info(`File-Permissions: ${filePermissions}`)

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
        const owner = this.getOwnerID(path, user)
        const parent = this.getParentID(path, user)

        try {
            const res = await api({user}).get('/fileStorage?owner=' + owner + (parent != owner ? '&parent=' + parent : ''));

            const data: ResourceResponse[] = res.data;

            logger.info(`Load Directory Response Data: ${data}`)

            if (this.rootPath === 'teams') {
                const teamRes = await api({user}).get('teams/' + owner)

                logger.debug(teamRes.data)
            }

            const resources = []
            for (const resource of data) {
                this.addFileToResources(path.getChildPath(resource.name), user, resource)
                resources.push(resource.name)
            }

            return resources
         } catch (error) {
            logger.error(`WebFileSystem.loadDirectory.error.${error.response.data.code}: ${error.response.data.message} uid: ${user.uid}`)
            this.deleteResourceLocally(path, user)
            if (error.response.data.code === 404) {
                throw webdav.Errors.ResourceNotFound
            } else {
                throw webdav.Errors.Forbidden
            }
        }
    }

    /*
     * Loads every parent path until the given path
     *
     * @param {Path} path   Path to load
     * @param {User} user   Current user
     *
     * @return {Promise<Boolean>}   Returns whether the path exists
     */
    async loadPath(path: Path, user: User) : Promise<boolean> {
        await this.loadRootDirectories(user)
        let currentPath = path.getParent()
        while (!this.resourceExists(path, user)) {
            if (this.resourceExists(currentPath, user)) {
                try {
                    const resources = await this.loadDirectory(currentPath, user)

                    if (!resources.includes(path.paths[currentPath.paths.length])) {
                        return false
                    }

                    currentPath = currentPath.getChildPath(path.paths[currentPath.paths.length])
                } catch (error) {
                    return false
                }
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
        if (this.resourceExists(path, user)) {
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
    createUserFileSystem(uid: string): void {
        if (!this.resources.has(uid)) {
            this.resources.set(uid, new Map())
        }
    }

    /*
     * Adds a file object returned by SC-Server to this.resources
     *
     * @param {Path} path         Path to resource
     * @param {User} user           Current user
     * @param {ResourceResponse} file           File JSON-Object returned by server
     *
     * @return {Resource}       Resource object saved to this.resources
     */
    addFileToResources (path: Path, user: User, file: ResourceResponse): Resource {
        const creationDate = new Date(file.createdAt)
        const lastModifiedDate = new Date(file.updatedAt)
        const permissions = this.populatePermissions(file, path, user)

        const resource: Resource = {
            type: file.isDirectory ? webdav.ResourceType.Directory : webdav.ResourceType.File,
            id: file._id,
            size: file.size,
            creationDate: creationDate.getTime(),
            lastModifiedDate: lastModifiedDate.getTime(),
            owner: file.permissions[0].refId == user.uid,
            permissions
        }

        this.resources.get(user.uid).set(path.toString(), resource);

        return resource
    }

    /*
     * Retrieves a download-URL of an existing S3-file
     *
     * @param {Path} path               Path to resource
     * @param {User} user               Current user
     *
     * @return {Promise<string>}   Signed URL
     */
    async retrieveSignedUrl (path: Path, user: User): Promise<string> {
        try {
            const res = await api({user}).get('/fileStorage/signedUrl?file=' + this.getID(path, user))

            if (res.data.url) {
                return res.data.url
            }
        } catch (error) {
            if (error.response?.data?.code === 404) {
                this.deleteResourceLocally(path, user)
                throw webdav.Errors.ResourceNotFound
            }
        }

        throw webdav.Errors.Forbidden
    }

    async _openReadStream (path: Path, info: OpenReadStreamInfo, callback: ReturnCallback<Readable>) : Promise<void> {
        logger.info("Reading file: " + path)

        if (info.context.user) {
            const user: User = <User> info.context.user

            this.createUserFileSystem(user.uid)

            if (this.canRead(path, user)) {
                try {
                    const url = await this.retrieveSignedUrl(path, user)

                    logger.info("Signed URL: " + url)

                    const file = await api({}).get(url, { responseType: 'arraybuffer' })
                    const buffer = await file.data

                    callback(null, new webdav.VirtualFileReadable([ buffer ]))
                } catch (error) {
                    logger.error(`WebFileSystem._openReadStream.retrieveSignedUrl.error: ${error.message} uid: ${user.uid}`, error)
                    callback(error)
                }
            } else {
                logger.warn(`WebFileSystem._openReadStream.permissions.read.false : Reading not allowed! uid: ${user.uid}`)
                callback(webdav.Errors.Forbidden)
            }
        } else {
            logger.warn(`WebFileSystem._openReadStream.context.user.false : ${webdav.Errors.BadAuthentication.message}`)
            callback(webdav.Errors.BadAuthentication)
        }
    }

    async _readDir(path: Path, info: ReadDirInfo, callback: ReturnCallback<string[] | Path[]>): Promise<void> {
        logger.info("Reading dir: " + path)

        if (info.context.user) {
            const user: User = <User> info.context.user
            this.createUserFileSystem(user.uid)
            if (path.isRoot()) {
                callback(null, await this.loadRootDirectories(user))
            } else {
                if (this.resourceExists(path, user)) {
                    try {
                        callback(null, await this.loadDirectory(path, user))
                    } catch (error) {
                        // Error callback doesn't seem to work here in _readDir (at least with Cyberduck)
                        // TODO: Fix this problem because otherwise you can open ghost directories which leads to problems
                        callback(error)
                    }
                } else {
                    if (await this.loadPath(path, user)) {
                        try {
                            callback(null, await this.loadDirectory(path, user))
                        } catch (error) {
                            callback(error)
                        }
                    } else {
                        logger.error(`WebFileSystem._readDir.loadPath.false : Directory could not be found! uid: ${user.uid} path: ${path.toString()}`)
                        callback(webdav.Errors.ResourceNotFound)
                    }
                }
            }
        } else {
            logger.error(`WebFileSystem._readDir.context.user.false : ${webdav.Errors.BadAuthentication.message} path: ${path.toString()}`)
            callback(webdav.Errors.BadAuthentication)
        }
    }

    async _type(path: Path, info: TypeInfo, callback: ReturnCallback<webdav.ResourceType>): Promise<void> {
        logger.info("Checking type: " + path)

        // For guest users
        if (path.isRoot()) {
            callback(null, webdav.ResourceType.Directory);
        } else if (info.context.user) {
            const user: User = <User> info.context.user
            this.createUserFileSystem(user.uid)

            if (this.resourceExists(path, user)) {
                callback(null, this.resources.get(user.uid).get(path.toString()).type)
            } else {
                if (await this.loadPath(path, user)) {
                    callback(null, this.resources.get(user.uid).get(path.toString()).type)
                } else {
                    logger.error(`WebFileSystem._type : File could not be found! uid: ${info.context.user.uid} path: ${path.toString()}`)
                    callback(webdav.Errors.ResourceNotFound)
                }
            }
        } else {
            logger.error(`WebFileSystem._type : ${webdav.Errors.BadAuthentication.message} path: ${path.toString()}`)
            callback(webdav.Errors.BadAuthentication)
        }
    }

    async _size(path: Path, ctx: SizeInfo, callback: ReturnCallback<number>): Promise<void> {
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
            logger.error(`WebFileSystem._size.user.false : ${webdav.Errors.BadAuthentication.message}`)
            callback(webdav.Errors.BadAuthentication)
        }
    }

    async _creationDate(path: Path, ctx: CreationDateInfo, callback: ReturnCallback<number>): Promise<void> {
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
            logger.error(`WebFileSystem._creationDate.user.false : ${webdav.Errors.BadAuthentication.message}`)
            callback(webdav.Errors.BadAuthentication)
        }
    }

    async _lastModifiedDate(path: Path, ctx: LastModifiedDateInfo, callback: ReturnCallback<number>): Promise<void> {
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
            logger.error(`WebFileSystem._lastModifiedDate.user.false : ${webdav.Errors.BadAuthentication.message}`)
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

        // checks if file already exists and if filename contains bad characters (e.g. "§%?&....")
        if (!this.validFileName(path.fileName())){
            logger.info(`Name ${path.fileName()} not allowed.`)
            return webdav.Errors.Forbidden
        } else if ((await this.loadDirectory(path.getParent(), user)).includes(path.fileName())) {
            logger.info(`Resource ${path} already exists.`)
            return webdav.Errors.ResourceAlreadyExists
        } else if (this.resourceExists(path, user)) {
            this.deleteResourceLocally(path, user)
        }

        if (!this.resources.get(user.uid).get(path.getParent().toString()).permissions || this.canCreate(path.getParent(), user)) {
            if (type.isDirectory || ['docx', 'pptx', 'xlsx'].includes(mime.extension(mime.lookup(path.fileName())))) {
                const owner = this.getOwnerID(path, user)
                const parent = this.getParentID(path.getParent(), user)

                const body = {
                    name: path.fileName(),
                    parent: (parent != owner) ? parent : undefined
                }

                if (owner !== user.uid) {
                    body['owner'] = owner
                }

                try {
                    const res = await api({user , json: true}).post('/fileStorage' + (type.isDirectory ? '/directories' : '/files/new'), body);

                    const data = res.data;

                    logger.info(data)

                    if (data._id) {
                        this.addFileToResources(path, user, data)
                    } else {
                        logger.error(webdav.Errors.Forbidden.message)
                        return webdav.Errors.Forbidden
                    }
                } catch (error) {
                    logger.error(`WebFileSystem.createResource.error.${error.response.data.code}: ${error.response.data.message} uid: ${user.uid}`, error)
                    return error
                }
            } else {
                try {
                    const data = await this.requestWritableSignedUrl(path, user)
                    await this.writeToSignedUrl(data.url, data.header, [])
                    const file = await this.writeToFileStorage(path, user, data.header, [])

                    logger.debug(`${file}`)

                    if (file._id) {
                        this.addFileToResources(path, user, file)
                    } else {
                        logger.error(webdav.Errors.Forbidden.message)
                        return webdav.Errors.Forbidden
                    }
                } catch (error) {
                    logger.error(`Failed to create Ressource: uid: ${user.uid} path: ${path.toString()}`, error)
                    return error
                }
            }
        } else {
            logger.error(`WebFileSystem.createResource.permissions.false : Creating resource not allowed! uid: ${user.uid} path: ${path.toString()}`)
            return webdav.Errors.Forbidden
        }


        return null
    }

    async _create(path: Path, ctx: CreateInfo, callback: SimpleCallback): Promise<void> {
        logger.info("Creating resource: " + path)

        if (ctx.context.user) {
            const user: User = <User> ctx.context.user

            this.createUserFileSystem(user.uid)

            if (!path.hasParent()) {
                if (this.rootPath === 'my') {
                    callback(await this.createResource(path, user, ctx.type))
                } else {
                    logger.error(`WebFileSystem._create.isAtRootLevel.true : Creating resource not allowed! path: ${path.toString()} uid: ${user.uid}`)
                    callback(webdav.Errors.Forbidden)
                }
            } else if (this.resourceExists(path.getParent(), user)) {
                callback(await this.createResource(path, user, ctx.type))
            } else {
                if (await this.loadPath(path.getParent(), user)) {
                    callback(await this.createResource(path, user, ctx.type))
                } else {
                    logger.error(`WebFileSystem._create.loadPath.false : Resource could not be found! path: ${path.toString()} uid: ${user.uid}`)
                    callback(webdav.Errors.ResourceNotFound)
                }
            }
        } else {
            logger.error(`WebFileSystem._create.context.user.false : ${webdav.Errors.BadAuthentication.message} path: ${path.toString()}`)
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
        // Web Client checks user permission instead of file permission, but SC-Server checks specific permission
        // if (this.canDelete(path, user)) {
        if (user.permissions.includes('FILE_DELETE')) {
            const type: webdav.ResourceType = this.resources.get(user.uid).get(path.toString()).type

            const res = await api({user}).delete('/fileStorage' + (type.isDirectory ? '/directories?_id=' : '?_id=') + this.getID(path, user));
            const data = res.data;

            // Server returns error if not allowed
            if (data.code) {
                logger.error(`WebFileSystem.deleteResource.data.code.${data.code}: ${data.message} uid: ${user.uid}`)
                if (data.code === 403 && data.errors?.code !== 404) {
                    return webdav.Errors.Forbidden
                }
            } else {
                logger.info(data)
            }

            this.deleteResourceLocally(path, user)

            return null
        } else {
            logger.error(`WebFileSystem.deleteResource.deletePermission.false : Deleting resource not allowed! uid: ${user.uid} path: ${path.toString()}`)
            return webdav.Errors.Forbidden
        }
    }

    async _delete(path: Path, ctx: DeleteInfo, callback: SimpleCallback): Promise<void> {
        logger.info("Deleting resource: " + path)

        if (ctx.context.user) {
            const user: User = <User> ctx.context.user
            this.createUserFileSystem(user.uid)

            if (this.resourceExists(path, user)) {
                callback(await this.deleteResource(path, user))
            } else {
                if (await this.loadPath(path, user)) {
                    callback(await this.deleteResource(path, user))
                } else {
                    logger.error(`WebFileSystem._delete : Resource could not be found! uid: ${user.uid} path: ${path.toString()}`)
                    callback(webdav.Errors.ResourceNotFound)
                }
            }
        } else {
            logger.error(`WebFileSystem._delete : ${webdav.Errors.BadAuthentication.message}`)
            callback(webdav.Errors.BadAuthentication)
        }
    }

    /*
     * Requests writable signed URL of SC file storage to a S3 bucket
     *
     * @param {Path} path               Path to resource
     * @param {User} user               Current user
     *
     * @return {Promise<WritableURLResponse>}   JSON-Response of SC-Server containing URL and header.
     */
    async requestWritableSignedUrl (path: Path, user: User): Promise<WritableURLResponse> {
        const filename = path.fileName()
        const contentType = mime.lookup(filename) || 'application/octet-stream'
        const parent = this.getParentID(path.getParent(), user)

        let res
        if (this.resourceExists(path, user)) {
            try {
                res = await api({user, json: true}).patch('/fileStorage/signedUrl/' + this.getID(path, user))
            } catch (error) {
                logger.error(`WebFileSystem.requestWritableSignedUrl.error.${error.response.data.code}: ${error.response.data.message} uid: ${user.uid}`)
                if (error.response.data.code === 404) {
                    this.deleteResourceLocally(path, user)
                    return this.requestWritableSignedUrl(path, user)
                } else {
                    throw webdav.Errors.Forbidden
                }
            }

            if (res.data.code) {
                logger.error(`WebFileSystem.requestWritableSignedUrl.error.${res.data.code}: ${res.data.message} uid: ${user.uid}`)
                throw webdav.Errors.Forbidden
            }
        } else {
            try {
                res = await api({user, json: true}).post('/fileStorage/signedUrl', {
                    filename,
                    fileType: contentType,
                    parent: this.getOwnerID(path, user) != parent ? parent : undefined
                })
            } catch (error) {
                logger.error(`WebFileSystem.requestWritableSignedUrl.error.${error.response.data.code}: ${error.response.data.message} uid: ${user.uid}`)
                throw webdav.Errors.Forbidden
            }
        }

        const data = res.data

        logger.info(data)

        return data
    }

    async writeToSignedUrl (url: string, header: S3Header, content: ReadonlyArray<Uint8Array>): Promise<void> {
        await api({}).put(url,
            Buffer.concat(content),
            {
            headers: {
                ...header
            },
        })
    }

    /*
     * Registers a file to the file storage of SC-Server
     *
     * @param {Path} path               Path to resource
     * @param {User} user               Current user
     * @param {S3Header} header              S3-Header returned by S3-Request
     * @param {ReadonlyArray<Uint8Array>} contents     Contents of stream
     *
     * @return {Promise<ResourceResponse>}   File Object of the new file
     */
    async writeToFileStorage (path: Path, user: User, header: S3Header, content: ReadonlyArray<Uint8Array>): Promise<ResourceResponse> {
        const owner = this.getOwnerID(path, user)
        const parent = this.getParentID(path.getParent(), user)

        const type = mime.lookup(path.fileName()) || 'application/octet-stream'

        const body = {
            name: path.fileName(),
            parent: parent != owner ? parent : undefined,
            type,
            size: Buffer.concat(content).byteLength,
            storageFileName: header['x-amz-meta-flat-name'],
            thumbnail: header['x-amz-meta-thumbnail']
        }

        if (owner !== user.uid) {
            body['owner'] = owner
        }

        try {
            const res = await api({user, json: true}).post('/fileStorage', body)

            return res.data
        } catch (error) {
            logger.error(`WebFileSystem.writeToFileStorage.error.${error.response.data.code}: ${error.response.data.message} uid: ${user.uid}`)
            throw webdav.Errors.Forbidden
        }
    }

    /*
     * Creates a write stream and stores file when finished
     *
     * @param {Path} path               Path to resource
     * @param {User} user               Current user
     *
     * @return {webdav.VirtualFileWritable}   Writable stream
     */
    processStream(path: Path, user: User): webdav.VirtualFileWritable {
        const contents = []
        const stream = new webdav.VirtualFileWritable(contents)

        stream.on('finish', async () => {
            try {
                const data = await this.requestWritableSignedUrl(path, user)
                if (data.url) {
                    await this.writeToSignedUrl(data.url, data.header, contents)

                    if (!this.resourceExists(path, user)) {
                        const file = await this.writeToFileStorage(path, user, data.header, contents)

                        logger.info(`Response Data on writeToFileStorage: ${file}`)

                        if (file._id) {
                            this.addFileToResources(path, user, file)
                        } else {
                            logger.error(`WebFileSystem.processStream.file._id.false: ${webdav.Errors.Forbidden.message} uid: ${user.uid}`)
                        }
                    } else {
                        const res = await api({user, json: true}).patch('/files/' + this.getID(path, user), {
                            size: Buffer.concat(contents).byteLength,
                            updatedAt: new Date().toISOString()
                        })

                        this.resources.get(user.uid).get(path.toString()).size = Buffer.concat(contents).byteLength
                        this.resources.get(user.uid).get(path.toString()).lastModifiedDate = Date.now()

                        logger.info(res.data)
                    }
                } else {
                    logger.error(`WebFileSystem.processStream.data.url.false: ${webdav.Errors.Forbidden.message} uid: ${user.uid}`)
                }
            } catch (error) {
                logger.error(`WebFileSystem.processStream.onFinish.error: ${error.message} uid: ${user.uid}`)
            }
        })

        return stream
    }

    async _openWriteStream(path: Path, ctx: OpenWriteStreamInfo, callback: ReturnCallback<Writable>): Promise<void> {
        logger.info("Writing file: " + path)

        if (ctx.context.user) {
            const user: User = <User> ctx.context.user
            this.createUserFileSystem(user.uid)

            // TODO: Uploading file leads to size == 0

            if (this.resourceExists(path, user)) {
                if (this.canWrite(path, user)) {
                    callback(null, await this.processStream(path, user))
                } else {
                    logger.error(`WebFileSystem._openWriteStream: Writing not allowed! uid: ${user.uid} path: ${path.toString()}`)
                    callback(webdav.Errors.Forbidden)
                }
            } else {
                if (!this.resources.get(user.uid).get(path.getParent().toString()).permissions || this.canCreate(path.getParent(), user)) {
                    callback(null, await this.processStream(path, user))
                }
            }
        } else {
            logger.error(`WebFileSystem._openWriteStream: ${webdav.Errors.BadAuthentication.message} path: ${path.toString()}`)
            callback(webdav.Errors.BadAuthentication)
        }
    }

    /*
     * Moves File to new Folder
     *
     * @param {string} resourceID      ID of the resource
     * @param {string} newParentID      ID of the new Parent
     * @param {User} user               Current user
     *
     * @return {Promise<Error>}   Error or null depending on success of moving
     */
    async moveResource(resourceID: string, newParentID: string, user: User, pathFrom: Path, pathTo: Path): Promise<Error> {
        return await api({user, json: true}).patch(
            `/fileStorage/${resourceID}`,
            {parent: newParentID})
            .then((res) => {
                logger.info(res.data)

                if (res.data.code === 403) {
                    logger.error(`WebFileSystem.moveResource.error.403: ${res.data.message} uid: ${user.uid}`)
                    return webdav.Errors.Forbidden
                }

                this.resources.get(user.uid).set(pathTo.toString(), this.resources.get(user.uid).get(pathFrom.toString()))
                this.deleteResourceLocally(pathFrom, user)

                return null
            }).catch(() => {
                logger.error('WebFileSystem.moveResource : File could not be moved', [user.uid, resourceID, newParentID]);
                return webdav.Errors.Forbidden
            })
    }

    async _move(pathFrom: Path, pathTo: Path, ctx: MoveInfo, callback: ReturnCallback<boolean>): Promise<void> {
        logger.info("Moving file: " + pathFrom + " --> " + pathTo)

        if (ctx.context.user) {
            const user: User = <User> ctx.context.user;

            if(!pathTo.hasParent()){
                logger.error(`WebFileSystem._move.hasParent.false : ${webdav.Errors.Forbidden.message} uid: ${user.uid} pathTo: ${pathTo.toString()}`)
                callback(webdav.Errors.Forbidden);
                return;
            }

            if (!await this.loadPath(pathFrom, user) || !await this.loadPath(pathTo.getParent(), user)){
                logger.error('Resource could not be found!')
                callback(webdav.Errors.ResourceNotFound);
                return ;
            }

            // renaming seems to be a move call in many clients but cannot be handled as such here:
            if(pathFrom.getParent().toString() === pathTo.getParent().toString() && pathFrom.fileName() !== pathTo.fileName()){
                callback(await this.renameResource(pathFrom, user, pathTo.fileName()));
                return;
            }

            if (this.resources.get(user.uid).get(pathFrom.toString()).owner) {
                const fileID: string = this.getID(pathFrom, user);
                const toParentID: string = this.getID(pathTo.getParent(), user);

                if(!this.validFileName(pathTo.fileName())){
                    logger.warn(`WebFileSystem._move : Name ${pathTo.fileName()} not allowed. pathFrom: ${pathFrom}`)
                    callback(webdav.Errors.Forbidden)
                    return
                } else if ((await this.loadDirectory(pathTo.getParent(), user)).includes(pathTo.fileName())) {
                    // a lot of clients are asking whether to override the file, that could be also implemented instead of an error
                    logger.warn(`WebFileSystem._move: Resource already exists at give path. pathTo: ${pathTo.toString()} uid: ${user.uid}`)
                    callback(webdav.Errors.ResourceAlreadyExists)
                    return
                }

                if (this.resourceExists(pathTo, user)) {
                    this.deleteResourceLocally(pathTo, user)
                }

                callback(await this.moveResource(fileID, toParentID, user, pathFrom, pathTo))
            } else {
                logger.error(`WebFileSystem._move.owner.false : ${webdav.Errors.Forbidden.message} uid: ${user.uid}`)
                callback(webdav.Errors.Forbidden)
            }
        } else {
            logger.error(`WebFileSystem._move : ${webdav.Errors.BadAuthentication.message} pathTo: ${pathTo.toString()} pathFrom: ${pathFrom.toString()}`)
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
        if (this.canWrite(path, user)) {
            if(!this.validFileName(newName)){
                logger.warn(`Name ${newName} not allowed.`)
                return webdav.Errors.Forbidden
            }

            const newPath = path.getParent().getChildPath(newName)
            if((await this.loadDirectory(path.getParent(), user)).includes(newName)){
                // a lot of clients are asking whether to override the file, that could be also implemented instead of an error
                logger.warn(`WebFileSystem.renameResource: Resource already exists at give path. path: ${path.toString()} newName: ${newName}`)
                return webdav.Errors.ResourceAlreadyExists
            } else if (this.resourceExists(newPath, user)) {
                this.deleteResourceLocally(newPath, user)
            }

            const type: webdav.ResourceType = this.resources.get(user.uid).get(path.toString()).type

            return await api({user,json:true}).post('/fileStorage' + (type.isDirectory ? '/directories' : '') + '/rename', {
                id: this.getID(path, user),
                newName
            }).then((res: AxiosResponse) => {
                if (res.data.code) {
                    logger.error(`WebFileSystem.renameResource.data.code.${res.data.code}: ${res.data.message} uid: ${user.uid}`)
                    if (res.data.code === 403 && res.data.errors?.code === 403) {
                        return webdav.Errors.Forbidden
                    } else if (res.data.code === 404 || res.data.errors?.code === 404) {
                        this.deleteResourceLocally(path, user)
                        return webdav.Errors.ResourceNotFound
                    }
                }

                this.resources.get(user.uid).set(path.getParent().getChildPath(newName).toString(), this.resources.get(user.uid).get(path.toString()))
                this.deleteResourceLocally(path, user)

                logger.info(`File at ${path.toString()} now named ${newName}`)

                return null
            }).catch((error) => {
                logger.error(error)
                return webdav.Errors.InvalidOperation
            })
        } else {
            logger.error(`WebFileSystem.renameResource : Writing not allowed! uid: ${user.uid} path: ${path.toString()}`)
            return webdav.Errors.Forbidden
        }
    }

   async _rename(pathFrom: Path, newName: string, ctx: RenameInfo, callback: ReturnCallback<boolean>): Promise<void> {
        logger.info("Renaming file: " + pathFrom + " --> " + newName)

        if (ctx.context.user) {
            const user: User = <User> ctx.context.user
            this.createUserFileSystem(user.uid)

            if (this.resourceExists(pathFrom, user)) {
                callback(await this.renameResource(pathFrom, user, newName))
            } else {
                if (await this.loadPath(pathFrom, user)) {
                    callback(await this.renameResource(pathFrom, user, newName))
                } else {
                    logger.error(`WebFileSystem._rename : Resource could not be found! pathFrom: ${pathFrom.toString()} newName: ${newName}`)
                    callback(webdav.Errors.ResourceNotFound)
                }
            }
        } else {
            logger.error(`WebFileSystem._rename : ${webdav.Errors.BadAuthentication.message} pathFrom: ${pathFrom.toString()} newName: ${newName}`)
            callback(webdav.Errors.BadAuthentication)
        }
    }
}

export default WebFileSystem;
