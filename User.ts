import {IUser} from "webdav-server/lib/user/v2/IUser";
import {environment} from "./config/globals";
import * as fetch from 'node-fetch'
import api from './api';

export default class User implements IUser {
    uid: string;
    username: string;
    password: string;
    jwt: string;
    roles: Array<string>

    constructor(uid: string, username: string, password: string, jwt: string) {
        this.uid = uid
        this.username = username
        this.password = password
        this.jwt = jwt
        this.roles = []
    }

    /*
     * Loads the roles of the user
     */
    async loadRoles() : Promise<void> {

        // TODO: Implement logic on SC-server instead of webdav with a specific flag

        const res = await api({jwt : this.jwt}).get('/roles/user/' + this.uid);

        for (const role of res.data) {
            this.roles.push(role.id)
            const nestedRoles = role.roles
            for (const nestedRole of nestedRoles) {
                this.roles.push(nestedRole)
                await this.getNestedRoles(nestedRole)
            }
        }
    }

    /*
     * Searches the complete role-tree until every nested role is found
     */
    async getNestedRoles (id: string) : Promise<void> {
        const res = await api({jwt: this.jwt}).get('/roles/' + id);

        for (const role of res.data.roles) {
            this.roles.push(role)
            await this.getNestedRoles(role)
        }
    }
}
