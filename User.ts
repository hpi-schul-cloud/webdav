import {IUser} from "webdav-server/lib/user/v2/IUser";
import api from './api';
import logger from "./logger";

export default class User implements IUser {
    uid: string;
    username: string;
    password: string;
    jwt: string;
    roles: Array<string>
    permissions: Array<string>

    constructor(uid: string, username: string, password: string, jwt: string) {
        this.uid = uid
        this.username = username
        this.password = password
        this.jwt = jwt
        this.roles = []
        this.permissions = []
    }

    /*
     * Loads the roles of the user
     */
    async loadRoles() : Promise<void> {

        // TODO: Implement logic on SC-server instead of webdav with a specific flag

        const res = await api({user : this}).get('/roles/user/' + this.uid);

        logger.info(res.data)

        for (const role of res.data) {
            this.roles.push(role.id)
            role.permissions.forEach((permission) => {
                if (!this.permissions.includes(permission)) {
                    this.permissions.push(permission)
                }
            })
            for (const nestedRole of role.roles) {
                this.roles.push(nestedRole)
                await this.getNestedRoles(nestedRole)
            }
        }
    }

    /*
     * Searches the complete role-tree until every nested role is found
     */
    async getNestedRoles (id: string) : Promise<void> {
        const res = await api({user: this}).get('/roles/' + id);

        for (const role of res.data.roles) {
            this.roles.push(role)
            await this.getNestedRoles(role)
        }

        res.data.permissions.forEach((permission) => {
            if (!this.permissions.includes(permission)) {
                this.permissions.push(permission)
            }
        })
    }
}
