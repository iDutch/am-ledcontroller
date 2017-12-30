AUTOBAHN_DEBUG = false;
const autobahn = require('autobahn');
const wpi = require('wiringpi-node');
const moment = require('moment');
const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

const pins = {
    "redPin": 2,
    "greenPin": 0,
    "bluePin": 7,
    "warmwhitePin": 4,
    "coldwhitePin": 5
};

const oauth_data = {
    "grant_type": process.env.USER_GRANT_TYPE,
    "client_id": process.env.CLIENT_ID,
    "client_secret": process.env.CLIENT_SECRET,
    "username": process.env.USER_EMAIL,
    "password": process.env.USER_PASSWORD,
    "scope": process.env.SCOPE_INT
};

var LedController = {

    user: process.env.CLIENT_USER,
    key: process.env.CLIENT_KEY,
    api_tokens: null,

    schedule: null,
    scheduleInterval: 0,

    async loadSchedule(id) {
        try {
            clearInterval(this.scheduleInterval);

            wpi.softPwmWrite(pins.redPin, 0);
            wpi.softPwmWrite(pins.greenPin, 0);
            wpi.softPwmWrite(pins.bluePin, 0);
            wpi.softPwmWrite(pins.warmwhitePin, 0);
            wpi.softPwmWrite(pins.coldwhitePin, 0);

            // pinvaulues['redPin'] = 0;
            // pinvaulues['greenPin'] = 0;
            // pinvaulues['bluePin'] = 0;
            // pinvaulues['warmwhitePin'] = 0;
            // pinvaulues['coldwhitePin'] = 0;

            this.schedule = await this.apiCall('https://hoogstraaten.eu/api/schedule/' + id, 'get', null);
            fs.writeFile("/etc/systemd/system/RGBController/schedule.json", JSON.stringify(this.schedule), function(err) {
                if(err) {
                    return console.log(err);
                }
            });
        } catch (e) {
            fs.readFile('/etc/systemd/system/RGBController/schedule.json', 'utf8', function (err,data) {
                if (err) {
                    return console.log(err);
                }
                this.schedule = JSON.parse(data);
            });
        }
    },
    async apiCall(url, method, data) {
        if (this.api_tokens === null) {
            try {
                let tokenresponse = await axios.post('https://hoogstraaten.eu/oauth/token', oauth_data, {headers: {'content-type': 'application/json'}});
                this.api_tokens = tokenresponse.data;
                this.api_tokens.renew_on = moment().add(tokenresponse.data.expires_in, 'seconds');

                let response = await axios({
                    method: method,
                    url: url,
                    data: data,
                    headers: {
                        'authorization': 'Bearer '.concat(this.api_tokens.access_token),
                        'content-type': 'application/json'
                    }
                });
                return response.data;
            } catch (error) {
                console.log(error);
            }
        }
    }
}
console.log(LedController);
LedController.loadSchedule(1);