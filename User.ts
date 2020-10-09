import {IUser} from "webdav-server/lib/user/v2/IUser";
import {environment} from "./config/globals";
import * as fetch from 'node-fetch'

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
    async loadRoles() {
        const res = await fetch(environment.BASE_URL + '/roles/user/' + this.uid, {
            headers: {
                'Authorization': 'Bearer ' + this.jwt
            }
        })

        const data = await res.json()

        for (const role of data) {
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
    async getNestedRoles (id: string) {
        const res = await fetch(environment.BASE_URL + '/roles/' + id, {
            headers: {
                'Authorization': 'Bearer ' + this.jwt
            }
        })

        const data = await res.json()

        for (const role of data.roles) {
            this.roles.push(role)
            await this.getNestedRoles(role)
        }
    }
}
