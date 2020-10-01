import {ITestableUserManager} from "webdav-server/lib/user/v2/userManager/ITestableUserManager";
import {IListUserManager} from "webdav-server/lib/user/v2/userManager/IListUserManager";
import {IUser} from "webdav-server/lib/user/v2/IUser";

export default class UserManager implements ITestableUserManager, IListUserManager {

    // TODO: Implement User Manager

    getDefaultUser(callback: (user: IUser) => void): any {
        // relevant for HTTPDigestAuthentication
    }

    getUserByName(name: string, callback: (error: Error, user?: IUser) => void): any {
        // relevant for HTTPDigestAuthentication
    }

    getUserByNamePassword(name: string, password: string, callback: (error: Error, user?: IUser) => void): any {

    }

    getUsers(callback: (error: Error, users?: IUser[]) => void): any {

    }
}
