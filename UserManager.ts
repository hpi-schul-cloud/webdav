import {ITestableUserManager} from "webdav-server/lib/user/v2/userManager/ITestableUserManager";
import {IListUserManager} from "webdav-server/lib/user/v2/userManager/IListUserManager";
import {IUser} from "webdav-server/lib/user/v2/IUser";
import User from "./User";
import {v2 as webdav} from "webdav-server";
import * as fetch from 'node-fetch'
import {environment} from './config/globals';
import logger from './logger';

export default class UserManager implements ITestableUserManager, IListUserManager {

    users: Map<string, User>

    constructor() {
        this.users = new Map()
    }

    getDefaultUser(callback: (user: IUser) => void): any {
        logger.info('Retrieving default user...')

        callback(null)
    }

    getUserByName(name: string, callback: (error: Error, user?: IUser) => void): any {
        logger.info('Retrieving user by name...')
        // relevant for HTTPDigestAuthentication
    }

    async getUserByNamePassword(name: string, password: string, callback: (error: Error, user?: IUser) => void): Promise<any> {
        // Currently this method isn't called due to a missing authorisation header, probably because MacOS doesn't send an Authorization header to unsecured sites

        logger.info('Retrieving user by name and password...')
        // relevant for HTTPBasicAuthentication

        if (this.users.has(name)) {
            if (this.users.get(name).password === password) {
                callback(null, this.users.get(name))
                return
            } else {
                logger.info('Access denied!')
                callback(webdav.Errors.BadAuthentication)
                return
            }
        }

        const res = await fetch(environment.BASE_URL + '/authentication', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                strategy: 'local',
                username: name,
                password,
                privateDevice: true
            })
        })

        const data = await res.json()

        if (data.accessToken) {
            const user = new User(data.account.userId, name, password, data.accessToken)
            await user.loadRoles()
            this.users.set(name, user)
            callback(null, user)
        } else {
            logger.error('Access denied!')
            callback(webdav.Errors.BadAuthentication)
        }
    }

    getUsers(callback: (error: Error, users?: IUser[]) => void): any {
        logger.info('Retrieving users...')

        callback(null, [...this.users.values()])
    }
}
