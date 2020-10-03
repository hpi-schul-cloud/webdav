import {ITestableUserManager} from "webdav-server/lib/user/v2/userManager/ITestableUserManager";
import {IListUserManager} from "webdav-server/lib/user/v2/userManager/IListUserManager";
import {IUser} from "webdav-server/lib/user/v2/IUser";
import User from "./User";
import {v2 as webdav} from "webdav-server";

export default class UserManager implements ITestableUserManager, IListUserManager {

    // TODO: Implement User Manager

    getDefaultUser(callback: (user: IUser) => void): any {
        console.log('Retrieving default user...')

        callback(new User(process.env.JWT))
    }

    getUserByName(name: string, callback: (error: Error, user?: IUser) => void): any {
        console.log('Retrieving user by name...')
        // relevant for HTTPDigestAuthentication
    }

    async getUserByNamePassword(name: string, password: string, callback: (error: Error, user?: IUser) => void): Promise<any> {
        // Currently this method isn't called due to a missing authorisation header, probably because MacOS doesn't send an Authorization header to unsecured sites

        console.log('Retrieving user by name and password...')
        // relevant for HTTPBasicAuthentication
        const res = await fetch(process.env.BASE_URL + '/authentication', {
            method: 'POST',
            body: JSON.stringify({
                    username: name,
                    password
                })
        })

        const data = await res.json()

        console.log(data)

        callback(webdav.Errors.BadAuthentication)
    }

    getUsers(callback: (error: Error, users?: IUser[]) => void): any {
        console.log('Retrieving users...')
    }
}
