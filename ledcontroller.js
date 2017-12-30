AUTOBAHN_DEBUG = false;
const autobahn = require('autobahn');
const wpi = require('wiringpi-node');
const moment = require('moment');
const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

class LedController {
    constructor() {
        this.pins = {
            redPin: 2,
            greenPin: 0,
            bluePin: 7,
            warmwhitePin: 4,
            coldwhitePin: 5
        };
        this.pinvalues = {
            redPin: 0,
            greenPin: 0,
            bluePin: 0,
            warmwhitePin: 0,
            coldwhitePin: 0
        };
        this.oauth_password = {
            grant_type: process.env.USER_GRANT_TYPE,
            client_id: process.env.CLIENT_ID,
            client_secret: process.env.CLIENT_SECRET,
            username: process.env.USER_EMAIL,
            password: process.env.USER_PASSWORD,
            scope: process.env.SCOPE_INT
        };
        this.oauth_refresh = {
            grant_type: 'refresh_token',
            refresh_token: null,
            client_id: process.env.CLIENT_ID,
            client_secret: process.env.CLIENT_SECRET,
            scope: process.env.SCOPE_INT
        };

        this.api_tokens = null;

        wpi.setup('wpi');

        wpi.pinMode(this.pins.redPin, wpi.SOFT_PWM_OUTPUT);
        wpi.pinMode(this.pins.greenPin, wpi.SOFT_PWM_OUTPUT);
        wpi.pinMode(this.pins.bluePin, wpi.SOFT_PWM_OUTPUT);
        wpi.pinMode(this.pins.warmwhitePin, wpi.SOFT_PWM_OUTPUT);
        wpi.pinMode(this.pins.coldwhitePin, wpi.SOFT_PWM_OUTPUT);

        this.schedule = null;
        this.crossbarsession = null;

        this.scheduleInterval = 0;
        this.blinkInterval = 0;
        this.cycleInterval = 0;
    };
    cycleSchedule(speed) {
        clearInterval(this.scheduleInterval);
        let start = moment("00:00", "HH:mm");
        this.cycleInterval = setInterval(() => {
            this.calculateLedValues(start.add(1, 'minutes'));
            if (this.crossbarsession !== null) {
                this.crossbarsession.publish('eu.hoogstraaten.fishtank.time.' + this.crossbarsession.id, [start]);
            }
        }, parseInt(speed));
    };
    calculateLedValues(time) {
        clearInterval(this.blinkInterval);
        if (this.schedule.data.entries.length > 1) {
            let max = this.schedule.data.entries.length - 1;
            for (let x in this.schedule.data.entries) {
                let index = parseInt(x);
                let index2 = index + 1;
                let firstentry = moment(this.schedule.data.entries[index].time, 'HH:mm');
                let secondentry = null;
                //If last index then compare it with the first one
                if (index === max) {
                    index2 = 0;
                    secondentry = moment(this.schedule.data.entries[index2].time, 'HH:mm').add(1, 'days');
                } else {
                    secondentry = moment(this.schedule.data.entries[index2].time, 'HH:mm');
                }
                //Get the two schedule entries where the current time is in between.
                if (time.isBetween(firstentry, secondentry, 'minutes', '[)')) {
                    //Determine maxdiff and currentdiff to calculate the percentage
                    //of how far the progression is between the two entries
                    let maxdiff = secondentry.diff(firstentry, 'minutes');
                    let diff = time.diff(firstentry, 'minutes');
                    let percentage = (diff / maxdiff) * 100;
                    // console.log(firstentry, secondentry, maxdiff, diff, percentage);
                    //Calculate PWM level for each channel based on difference between level values of the two entries
                    //and percentage of the progress
                    for (let i in this.schedule.data.entries[index].colors) {
                        //console.log(i, parseInt(this.schedule.data.entries[index].colors[i]) !== parseInt(this.schedule.data.entries[index2].colors[i]));
                        if (parseInt(this.schedule.data.entries[index].colors[i]) !== parseInt(this.schedule.data.entries[index2].colors[i])) {
                            let powerdiff = parseInt(this.schedule.data.entries[index2].colors[i]) - parseInt(this.schedule.data.entries[index].colors[i]);
                            let ledpower = parseInt(this.schedule.data.entries[index].colors[i]) + (Math.round(powerdiff * (percentage / 100)));
                            if (this.pinvalues[i + 'Pin'] !== ledpower) {
                                console.log(this.pins[i + 'Pin'], ledpower);
                                wpi.softPwmWrite(this.pins[i + 'Pin'], ledpower);
                                this.pinvalues[i + 'Pin'] = ledpower;
                            }
                        } else {
                            if (this.pinvalues[i + 'Pin'] !== parseInt(this.schedule.data.entries[index2].colors[i])) {
                                console.log(this.pinvalues[i + 'Pin'] !== parseInt(this.schedule.data.entries[index2].colors[i]), this.pins[i + 'Pin'], parseInt(this.schedule.data.entries[index2].colors[i]));
                                wpi.softPwmWrite(this.pins[i + 'Pin'], parseInt(this.schedule.data.entries[index2].colors[i]));
                                this.pinvalues[i + 'Pin'] = parseInt(this.schedule.data.entries[index2].colors[i]);
                            }
                        }
                    }
                }
            }
        } else if (this.schedule.data.entries.length === 1) {
            clearInterval(this.blinkInterval);
            for (let i in this.schedule.data.entries[0].colors) {
                if(this.pinvalues[i + 'Pin'] !== parseInt(this.schedule.data.entries[0].colors[i])) {
                    wpi.softPwmWrite(pins[i + 'Pin'], parseInt(this.schedule.data.entries[0].colors[i]));
                    this.pinvalues[i + 'Pin'] = parseInt(this.schedule.data.entries[0].colors[i]);
                }
            }
        } else {
            let value = 0;
            this.blinkInterval = setInterval(() => {
                value = !value ? 100 : 0;
                let colors = {red: 0, green: 0, blue: 0};
                for (let i in colors) {
                    wpi.softPwmWrite(this.pins[i + 'Pin'], value);
                }
            }, 500);
        }
    };
    async loadSchedule(id) {
        try {
            clearInterval(this.scheduleInterval);
            clearInterval(this.cycleInterval);
            wpi.softPwmWrite(this.pins.redPin, 0);
            wpi.softPwmWrite(this.pins.greenPin, 0);
            wpi.softPwmWrite(this.pins.bluePin, 0);
            wpi.softPwmWrite(this.pins.warmwhitePin, 0);
            wpi.softPwmWrite(this.pins.coldwhitePin, 0);

            this.pinvalues.redPin = 0;
            this.pinvalues.greenPin = 0;
            this.pinvalues.bluePin = 0;
            this.pinvalues.warmwhitePin = 0;
            this.pinvalues.coldwhitePin = 0;

            this.schedule = await this.apiCall('https://hoogstraaten.eu/api/schedule/' + id, 'get', null);
            fs.writeFile("/etc/systemd/system/RGBController/schedule.json", JSON.stringify(this.schedule), function(err) {
                if(err) {
                    return console.log(err);
                }
            });
            this.calculateLedValues(moment());
            this.scheduleInterval = setInterval(() => {
                this.calculateLedValues(moment());
                if (this.crossbarsession !== null) {
                    this.crossbarsession.publish('eu.hoogstraaten.fishtank.time.' + this.crossbarsession.id, [moment()]);
                }
            }, 1000);
        } catch (error) {
            console.log(error);
            fs.readFile('/etc/systemd/system/RGBController/schedule.json', 'utf8', (err, data) => {
                if (err) {
                    return console.log(err);
                }
                this.schedule = JSON.parse(data);
            });
            this.calculateLedValues(moment());
            this.scheduleInterval = setInterval(() => {
                this.calculateLedValues(moment());
                if (this.crossbarsession !== null) {
                    this.crossbarsession.publish('eu.hoogstraaten.fishtank.time.' + this.crossbarsession.id, [moment()]);
                }
            }, 1000);
        }
    };
    async apiCall(url, method, data) {
        if (this.api_tokens === null) {
            try {
                let tokenresponse = await axios.post('https://hoogstraaten.eu/oauth/token', this.oauth_password, {headers: {'content-type': 'application/json'}});
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
        } else if (this.api_tokens.renew_on < moment()) {
            try {
                this.oauth_refresh.refresh_token = this.api_tokens.refresh_token;
                let tokenresponse = await axios.post('https://hoogstraaten.eu/oauth/token', this.oauth_refresh, {headers: {'content-type': 'application/json'}});
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
        } else {
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
        }
    };
}

let LedControl = new LedController();
LedControl.loadSchedule(1);

function onchallenge (session, method, extra) {
    if (method === "wampcra") {
        return autobahn.auth_cra.sign(process.env.CLIENT_KEY, extra.challenge);
    } else {
        throw "don't know how to authenticate using '" + method + "'";
    }
};

//Define crossbar stuff
let connection = new autobahn.Connection({
    url: 'wss://cb.hoogstraaten.eu/ws',
    realm: 'eu.hoogstraaten.fishtank',
    authid: process.env.CLIENT_USER,
    authmethods: ["wampcra"],
    onchallenge: onchallenge
});

connection.onopen = function (session) {
    LedControl.crossbarsession = session;

    //Subscribe to topic for notification about updated schedules
    function onevent(args) {
        var data = args[0];
        //If updated schedule has the same id as our loaded schedule then retreive it's updated content from the API
        if(this.schedule.data.id === data.schedule_id) {
            LedControl.loadSchedule(data.schedule_id);
        }

    }
    session.subscribe('eu.hoogstraaten.fishtank.publish', onevent);

    //Register procedure for setting a new schedule
    function setSchedule(args) {
        try {
            LedControl.loadSchedule(args[0]);
        } catch (error) {
            console.log(error);
        }
    }
    session.register('eu.hoogstraaten.fishtank.setschedule.' + session.id, setSchedule);

    //Register procedure for getting the loaded schedule's id
    session.register('eu.hoogstraaten.fishtank.getactivescheduleid.' + session.id, function () {
        return LedControl.schedule.data.id;
    });

    //Register procedure for cycleing through loaded schedule
    function cycle(args) {
        LedControl.cycleSchedule(args[0]);
    }
    session.register('eu.hoogstraaten.fishtank.cycleschedule.' + session.id, cycle)

    console.log('Client connected to cb.hoogstraaten.eu!');
};

connection.onclose = function (reason, details) {
    LedControl.crossbarsession = null;
    console.log("Connection lost:", reason, details);
}

//Start crossbar
connection.open();