# webdav

This POC / MVP aims at integrating Files and Folders into other clouds or to have offline synchronsation available. It will also allow us to build our future frontend using webdav protocol instead of custom APIs.

![Demo](demo.gif)

## Installation

1. Clone Repository
1. Set `BASE_URL` in `.env` file
1. Run `npm install`
1. Run `npm run start`
1. Connect to `http://localhost:1900`

## TODO for MVP

- [x] Handle user auth
- [x] List users courses
- [x] List users directories in a course
- [x] List users files in a course
- [x] List subdirectories and files in a course
- [x] Open files in a course

## TODO for In App MVP

- [ ] Hide Feature behing Feature Flipper
- [ ] Move code to server (?)
- [ ] Documentation
- [ ] Tests

## More TODOs

- [X] NextCloud / OwnCloud status info
- [ ] NextCloud / OwnCloud custom attributes
- [ ] NextCloud / OwnCloud handle HTTP-Requests
- [ ] Have updatedAt available on directories (must be done in SC Server, this will require performant handling or different data schemas, like storing all parents on files and folders)
- [ ] Populate Permissions directly on SC-server
- [X] Handle Permissions
- [x] Handle available metadata
- [X] Create Files
- [X] Create Dirs
- [x] Upload Files
- [x] Move Files
- [x] Move Dir
- [X] Delete Files
- [X] Delete Dir
- [x] Write Files
- [X] Error handling edge cases
- [X] Handle teams data
- [X] handle my files
- [X] Handle shared files
- [X] Add Dockerfile
- [X] Add API req handler/helper
