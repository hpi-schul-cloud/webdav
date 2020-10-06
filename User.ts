import {IUser} from "webdav-server/lib/user/v2/IUser";

export default class User implements IUser {
    uid: string;
    username: string;
    jwt: string;

    constructor(uid: string, username: string, jwt: string) {
        this.uid = uid
        this.username = username
        this.jwt = jwt
    }
}
