import * as qs from 'qs';
import axios, { AxiosInstance } from 'axios';
import {environment} from './config/globals';
import User from './User';

interface API_req {
    user? : User;
    jwt? : string;
    json? : boolean;
}
const api = (req : API_req): AxiosInstance => {
    const headers = {};
    if (req.user){
        headers['Authorization'] = ' Bearer ' + req.user.jwt;
    } else if (req.jwt){
        headers['Authorization'] = ' Bearer ' + req.jwt;
    } 
	if (req.json) {
        headers['Content-Type'] = 'application/json';
    }
    
	return axios.create({
        timeout: 30000,
        baseURL: environment.BASE_URL,
        headers: headers,
        paramsSerializer: (params) => qs.stringify(params, { indices: true }),
	});
};

export default api;