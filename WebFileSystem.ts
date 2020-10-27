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
    rootPath: string

    constructor (rootPath?: string) {
        super(new WebFileSystemSerializer());

        this.props = new webdav.LocalPropertyManager();
        this.locks = new webdav.LocalLockManager();
        this.resources = new Map();
        this.rootPath = rootPath ? rootPath : 'courses'
    }

    _propertyManager (path: Path, info: PropertyManagerInfo, callback: ReturnCallback<IPropertyManager>) : void {
        logger.info("Calling Property Manager: " + path)
        callback(null, this.props)
    }

    _lockManager (path: Path, info:LockManagerInfo, callback:ReturnCallback<ILockManager>) : void {
        logger.info("Calling Lock Manager: " + path)
        callback(null, this.locks)
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
                    qs = `?$or[0][userIds]=${user.uid}&$or[1][teacherIds]=${user.uid}&$or[2][substiutionIds]=${user.uid}`;
                    url = `${environment.BASE_URL}/courses/${qs}`
                    break
                case 'teams':
                    url = `${environment.BASE_URL}/teams`
                    break
                default:
                    return []
            }

            const res = await fetch(url, {
                headers: {
                    'Authorization': 'Bearer ' + user.jwt
                }
            })
            const data = await res.json()

            for (const directory of data['data']) {
                this.resources.get(user.uid).set(new Path([directory.name]).toString(), {
                    type: webdav.ResourceType.Directory,
                    id: directory._id
                });
            }

            return data['data'].map((directory) => directory.name)
        }
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
        const filePermissions = {
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
        let ownerID
        let parentID
        if (this.rootPath === 'my') {
            ownerID = user.uid
            parentID = this.resources.get(user.uid).has(path.toString()) ? this.resources.get(user.uid).get(path.toString()).id : user.uid
        } else {
            ownerID = this.resources.get(user.uid).get('/' + path.rootName()).id;
            parentID = this.resources.get(user.uid).get(path.toString()).id;
        }

        const res = await fetch(environment.BASE_URL + '/fileStorage?owner=' + ownerID + (parentID != ownerID ? '&parent=' + parentID : ''), {
            headers: {
                'Authorization': 'Bearer ' + user.jwt
            }
        })

        const data = await res.json()

        logger.info(data)

        for (const resource of data) {
            // TODO: Check read permissions and handle accordingly
            this.addFileToResources(path.getChildPath(resource.name), user, resource)
        }
        return data.map((resource) => resource.name)
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
    createUserFileSystem(uid: string): void {
        if (!this.resources.has(uid)) {
            this.resources.set(uid, new Map())
        }
    }

    /*
     * Gets ID by path and user.
     * ! Assumes that resource is loaded in this.resource !
     *
     * @param {Path} path         Path to resource
     * @param {User} user           Current user
     *
     * @return {string}   ID of resource
     */
    getID(path: Path, user: User) : string{
        return this.resources.get(user.uid).get(path.toString()).id
    }

    /*
     * Adds a file object returned by SC-Server to this.resources
     *
     * @param {Path} path         Path to resource
     * @param {User} user           Current user
     * @param {any} file           File JSON-Object returned by server
     *
     */
    addFileToResources (path: Path, user: User, file: any): void {
        const creationDate = new Date(file.createdAt)
        const lastModifiedDate = new Date(file.updatedAt)
        const permissions = this.populatePermissions(file.permissions, user)

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

        this.resources.get(user.uid).set(path.toString(), {
            type: file.isDirectory ? webdav.ResourceType.Directory : webdav.ResourceType.File,
            id: file._id,
            size: file.size,
            creationDate: creationDate.getTime(),
            lastModifiedDate: lastModifiedDate.getTime(),
            permissions
        });
    }

    /*
     * Retrieves a download-URL of an existing S3-file
     *
     * @param {Path} path               Path to resource
     * @param {User} user               Current user
     * @param {User} user               Current user
     * @param {Array<any>} contents     Contents of stream
     *
     * @return {webdav.VirtualFileWritable}   Writable stream
     */
    async retrieveSignedUrl (path: Path, user: User): Promise<string> {
        const res = await fetch(environment.BASE_URL + '/fileStorage/signedUrl?file=' + this.resources.get(user.uid).get(path.toString()).id, {
            headers: {
                'Authorization': 'Bearer ' + user.jwt
            }
        })

        const data = await res.json()

        return data.url
    }

    async _openReadStream (path: Path, info: OpenReadStreamInfo, callback: ReturnCallback<Readable>) : Promise<void> {
        logger.info("Reading file: " + path)

        if (info.context.user) {
            const user: User = <User> info.context.user

            this.createUserFileSystem(user.uid)

            if (this.resources.get(user.uid).get(path.toString()).permissions.read) {
                const url = await this.retrieveSignedUrl(path, user)

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
                callback(webdav.Errors.Forbidden)
            }
        } else {
            callback(webdav.Errors.BadAuthentication)
        }
    }

    async _readDir(path: Path, info: ReadDirInfo, callback: ReturnCallback<string[] | Path[]>): Promise<void> {
        logger.info("Reading dir: " + path)

        if (info.context.user) {
            const user: User = <User> info.context.user
            this.createUserFileSystem(user.uid)
            if (path.isRoot()) {
                if (this.rootPath === 'my') {
                    callback(null, await this.loadDirectory(path, user))
                } else {
                    callback(null, await this.loadRootDirectories(user))
                }
            } else {
                if (this.resources.get(user.uid).has(path.toString())) {
                    const resources = await this.loadDirectory(path, user)

                    callback(null, resources)
                } else {
                    if (await this.loadPath(path, user)) {
                        const resources = await this.loadDirectory(path, user)

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

    async _type(path: Path, info: TypeInfo, callback: ReturnCallback<ReturnType<any>>): Promise<void> {
        logger.info("Checking type: " + path)

        // For guest users
        if (!path.hasParent()) {
            callback(null, webdav.ResourceType.Directory);
        } else if (info.context.user) {
            const user: User = <User> info.context.user
            this.createUserFileSystem(user.uid)

            if (this.resources.get(user.uid).has(path.toString())) {
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
        const contentType = mime.lookup(path.fileName()) || 'application/octet-stream'

        // TODO: Handle permissions

        if (type.isDirectory || mime.extension(contentType) in ['docx', 'pptx', 'xlsx']) {
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

            logger.info(data)

            this.addFileToResources(path, user, data)
        } else {
            const data = await this.requestWritableSignedUrl(path, user)
            await this.writeToSignedUrl(data.url, data.header, [])
            const file = await this.writeToFileStorage(path, user, data.header, [])

            logger.info(file)

            this.addFileToResources(path, user, file)
        }

        return null
    }

    async _create(path: Path, ctx: CreateInfo, callback: SimpleCallback): Promise<void> {
        logger.info("Creating resource: " + path)

        if (ctx.context.user) {
            const user: User = <User> ctx.context.user

            this.createUserFileSystem(user.uid)
            if (this.resources.get(user.uid).has(path.getParent().toString())) {
                callback(await this.createResource(path, user, ctx.type))
            } else {
                if (await this.loadPath(path.getParent(), user)) {
                    callback(await this.createResource(path, user, ctx.type))
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
        if (this.resources.get(user.uid).get(path.toString()).permissions?.delete) {
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

    async _delete(path: Path, ctx: DeleteInfo, callback: SimpleCallback): Promise<void> {
        logger.info("Deleting resource: " + path)

        if (ctx.context.user) {
            this.createUserFileSystem(ctx.context.user.uid)
            if (this.resources.get(ctx.context.user.uid).has(path.toString())) {
                callback(await this.deleteResource(path, <User> ctx.context.user))
            } else {
                if (await this.loadPath(path, <User> ctx.context.user)) {
                    callback(await this.deleteResource(path, <User> ctx.context.user))
                } else {
                    callback(webdav.Errors.ResourceNotFound)
                }
            }
        } else {
            callback(webdav.Errors.BadAuthentication)
        }
    }

    /*
     * Requests writable signed URL of SC file storage to a S3 bucket
     *
     * @param {Path} path               Path to resource
     * @param {User} user               Current user
     *
     * @return {Promise<any>}   JSON-Response of SC-Server containing URL and header.
     */
    async requestWritableSignedUrl (path: Path, user: User): Promise<any> {
        const filename = path.fileName()
        const contentType = mime.lookup(filename) || 'application/octet-stream'
        const parent = this.resources.get(user.uid).get(path.getParent().toString()).id

        let res
        if (this.resources.get(user.uid).has(path.toString())) {
            res = await fetch(environment.BASE_URL + '/fileStorage/signedUrl/' + this.getID(path, user), {
                method: 'PATCH',
                headers: {
                    'Authorization': 'Bearer ' + user.jwt,
                    'Content-Type': 'application/json'
                }
            })
        } else {
            res = await fetch(environment.BASE_URL + '/fileStorage/signedUrl', {
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
        }

        const data = await res.json()

        logger.info(data)

        return data
    }

    async writeToSignedUrl (url: string, header: any, content: Array<any>): Promise<void> {
        await fetch(url, {
            method: 'PUT',
            headers: {
                ...header
            },
            body: Buffer.concat(content),
        })
    }

    /*
     * Registers a file to the file storage of SC-Server
     *
     * @param {Path} path               Path to resource
     * @param {User} user               Current user
     * @param {any} header              S3-Header returned by S3-Request
     * @param {Array<any>} contents     Contents of stream
     *
     * @return {Promise<any>}   File Object of the new file
     */
    async writeToFileStorage (path: Path, user: User, header: any, content: Array<any>): Promise<any> {
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

    /*
     * Creates a write stream and stores file when finished
     *
     * @param {Path} path               Path to resource
     * @param {User} user               Current user
     * @param {User} user               Current user
     * @param {Array<any>} contents     Contents of stream
     *
     * @return {webdav.VirtualFileWritable}   Writable stream
     */
    processStream(path: Path, user: User, contents: Array<any>): webdav.VirtualFileWritable {
        const stream = new webdav.VirtualFileWritable(contents)

        stream.on('finish', async () => {
            const data = await this.requestWritableSignedUrl(path, user)
            logger.info(Buffer.concat(contents).toString())
            await this.writeToSignedUrl(data.url, data.header, contents)

            if (!this.resources.get(user.uid).has(path.toString())) {
                const file = await this.writeToFileStorage(path, user, data.header, contents)

                if (!this.resources.get(user.uid).has(path.toString())) {
                    this.addFileToResources(path, user, file)
                }
            }
        })

        return stream
    }

    async _openWriteStream(path: Path, ctx: OpenWriteStreamInfo, callback: ReturnCallback<Writable>): Promise<void> {
        logger.info("Writing file: " + path)

        if (ctx.context.user) {
            const user: User = <User> ctx.context.user
            this.createUserFileSystem(user.uid)

            if (this.resources.get(user.uid).has(path.toString())) {
                if (this.resources.get(user.uid).get(path.toString()).permissions?.write) {

                    // This part causes some problems by only appending to the content and not editing, so I will comment it for now (maybe it's not needed at all)
                    /*
                    const url = await this.retrieveSignedUrl(path, user)

                    const file = await fetch(url)
                    const buffer = await file.buffer()
                     */

                    callback(null, await this.processStream(path, user, [ ]))
                } else {
                    callback(webdav.Errors.Forbidden)
                }
            } else {
                callback(null, await this.processStream(path, user, []))
            }
        } else {
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
    async moveResource(resourceID: string, newParentID: string, user: User) : Promise<Error> {
        return await fetch(`${environment.BASE_URL}/fileStorage/${resourceID}`,{
            method: 'PATCH',
            headers: {
                'Authorization': 'Bearer ' + user.jwt,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                parent: newParentID,
            }),
        }).then(() => {
            //TODO: some error handling?
            return null
        }).catch(() => {
            logger.error('File at moveResource() could not be moved', user.uid,resourceID,newParentID);
            return webdav.Errors.Forbidden
        } )
    }

    async _move(pathFrom: Path, pathTo: Path, ctx: MoveInfo, callback: ReturnCallback<boolean>): Promise<void> {
        logger.info("Moving file: " + pathFrom + " --> " + pathTo)

        if (ctx.context.user) {
            const user: User = <User> ctx.context.user;

            if(!pathTo.hasParent()){
                callback(webdav.Errors.Forbidden);
                return;
            }

            // renaming seems to be a move call in many clients but cannot be handled as such here:
            if(pathFrom.getParent().toString() === pathTo.getParent().toString() && pathFrom.fileName() !== pathTo.fileName()){
                callback(await this.renameResource(pathFrom, user, pathTo.fileName()));
                return;
            }

            if (!await this.loadPath(pathFrom, user) || !await this.loadPath(pathTo.getParent(), user)){
                callback(webdav.Errors.ResourceNotFound);
                return ;
            }

            const fileID: string = this.getID(pathFrom, user);
            const toParentID: string = this.getID(pathTo.getParent(), user);

            callback(await this.moveResource(fileID, toParentID, user))
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

            // TODO: Check new name for unallowed characters (for example question mark)

            const type: webdav.ResourceType = this.resources.get(user.uid).get(path.toString()).type
            const res = await fetch(environment.BASE_URL + '/fileStorage' + (type.isDirectory ? '/directories' : '') + '/rename', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + user.jwt,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    id: this.resources.get(user.uid).get(path.toString()).id,
                    newName
                })
            }).then((res) => res.json())

            if(res.ok){
                logger.info(`File at ${path.toString()} now named ${newName}`);
                return null
            }else{
                logger.error(res)
                return webdav.Errors.InvalidOperation
            }
        } else {
            return webdav.Errors.Forbidden
        }
    }

   async _rename(pathFrom: Path, newName: string, ctx: RenameInfo, callback: ReturnCallback<boolean>): Promise<void> {
        logger.info("Renaming file: " + pathFrom + " --> " + newName)

        if (ctx.context.user) {
            this.createUserFileSystem(ctx.context.user.uid)
            if (this.resources.get(ctx.context.user.uid).has(pathFrom.toString())) {
                callback(await this.renameResource(pathFrom, <User> ctx.context.user, newName))
            } else {
                if (await this.loadPath(pathFrom, <User> ctx.context.user)) {
                    callback(await this.renameResource(pathFrom, <User> ctx.context.user, newName))
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
