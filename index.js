
const webdav = require('webdav-server').v2;

// User manager (tells who are the users)
const userManager = new webdav.SimpleUserManager();
const user = userManager.addUser('username', 'password', false);

// Privilege manager (tells which users can access which files/folders)
const privilegeManager = new webdav.SimplePathPrivilegeManager();
privilegeManager.setRights(user, '/', [ 'all' ]);

// const server = new webdav.WebDAVServer({
//     // HTTP Digest authentication with the realm 'Default realm'
//     httpAuthentication: new webdav.HTTPDigestAuthentication(userManager, 'Default realm'),
//     privilegeManager: privilegeManager,
//     port: 1900, // Load the server on the port 2000 (if not specified, default is 1900)
//     // autoSave: { // Will automatically save the changes in the 'data.json' file
//     //     treeFilePath: 'data.json'
//     // }
// });
// Serializer
function WebFileSystemSerializer()
{
    return {
        uid()
        {
            return "WebFileSystemSerializer_1.0.0";
        },
        serialize(fs, callback)
        {
            console.log(fs.url);
            callback(null, {
                url: fs.url,
                props: fs.props
            });
        },
        unserialize(serializedData, callback)
        {
            const fs = new WebFileSystem(serializedData.url);
            fs.props = serializedData.props;
            callback(null, fs);
        },
        constructor: WebFileSystemSerializer
    }
}
function WebFileSystem()
{
    const r = new webdav.FileSystem(new WebFileSystemSerializer());
    r.constructor = WebFileSystem;
    r.props = new webdav.LocalPropertyManager();
    r.locks = new webdav.LocalLockManager();
    r.url = url;

    r._fastExistCheck = function(ctx, path, callback)
    {
        callback(path.isRoot());
    }

    r._openReadStream = function(path, info, callback)
    {
        const stream = request.get(this.url);
        stream.end();
        callback(null, stream);
    }

    r._propertyManager = function(path, info, callback)
    {
        callback(null, this.props);
    }

    r._lockManager = function(path, info, callback)
    {
        callback(null, this.locks);
    }

    r._type = function(path, info, callback)
    {
        callback(null, webdav.ResourceType.File);
    }

    return r;
}


const server = new webdav.WebDAVServer({
    httpAuthentication: new webdav.HTTPDigestAuthentication(userManager, 'Default realm'),
    privilegeManager: privilegeManager
});
server.rootFileSystem().addSubTree(server.createExternalContext(), {
    'test': {
        'file1.txt': webdav.ResourceType.File,  // /folder1/file1.txt
        'file2.txt': webdav.ResourceType.File   // /folder1/file2.txt                     // /folder1
    },
    'kurse': {
        'k1': webdav.ResourceType.Directory,  // /folder1/file1.txt
        'k2': webdav.ResourceType.Directory   // /folder1/file2.txt                     // /folder1
    },
    'teams': {
        't1': webdav.ResourceType.Directory,  // /folder1/file1.txt
        't2': webdav.ResourceType.Directory   // /folder1/file2.txt                     // /folder1
    },
});
server.setFileSystem('courses', new WebFileSystem());

server.start((s) => console.log('Ready on port', s.address().port));