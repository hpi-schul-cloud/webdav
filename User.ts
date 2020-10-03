import {IUser} from "webdav-server/lib/user/v2/IUser";

export default class User implements IUser {
    uid: string;
    username: string;
    jwt: string;

    constructor(jwt: string) {
        this.jwt = jwt
    }

}
