AUTOBAHN_DEBUG = false;
const autobahn = require('autobahn');
const pigpio = require('pigpio');
const Gpio = pigpio.Gpio;
const moment = require('moment');
const axios = require('axios');
const fs = require('mz/fs');
const LCD = require('lcdi2c');

require('dotenv').config();

class LCDController {
    constructor(lcd) {
        this.lcd = lcd;
    };
    _pad(pad, str, padLeft) {
        if (typeof str === 'undefined')
            return pad;
        if (padLeft) {
            return (pad + str).slice(-pad.length);
        } else {
            return (str + pad).substring(0, pad.length);
        }
    };
    print(message, line){
        message = this._pad(new Array(21).join(' '), message, false);
        this.lcd.println(message, line);
    }
}

class Timer {
    constructor(func, wait, times) {
        this.times = times;
        this.wait = wait;
        this.func = func;
        let interv = () => {
            if (typeof this.times === "undefined" || this.times-- > 0) {
                setTimeout(interv, this.wait);
                try {
                    this.func.call(null);
                }
                catch(e) {
                    this.times = 0;
                    throw e.toString();
                }
            }
        };
        setTimeout(interv, this.wait);
    };
    clear() {
        this.times = 0;
    };
};

class LedController {
    constructor(lcd) {

        pigpio.configureClock(1, pigpio.CLOCK_PCM);

        this.lcdcontroller = lcd;

        this.PWMRange = 500;
        this.PWMFrequency = 2000;
        this.channels = {
            redLed: new Gpio(4, {mode: Gpio.OUTPUT}),
            greenLed: new Gpio(17, {mode: Gpio.OUTPUT}),
            blueLed: new Gpio(27, {mode: Gpio.OUTPUT}),
            wwhiteLed: new Gpio(5, {mode: Gpio.OUTPUT}),
            cwhiteLed: new Gpio(6, {mode: Gpio.OUTPUT}),
        };
        this.channelValues = {
            redLed: 0,
            greenLed: 0,
            blueLed: 0,
            wwhiteLed: 0,
            cwhiteLed: 0
        };

        this.oauth_password = {
            grant_type: 'password',
            client_id: process.env.CLIENT_ID,
            client_secret: process.env.CLIENT_SECRET,
            username: process.env.USER_EMAIL,
            password: process.env.USER_PASSWORD,
            scope: process.env.SCOPE
        };
        this.oauth_refresh = {
            grant_type: 'refresh_token',
            refresh_token: null,
            client_id: process.env.CLIENT_ID,
            client_secret: process.env.CLIENT_SECRET,
            scope: process.env.SCOPE
        };

        this.channels.redLed.pwmRange(this.PWMRange);
        this.channels.greenLed.pwmRange(this.PWMRange);
        this.channels.blueLed.pwmRange(this.PWMRange);
        this.channels.wwhiteLed.pwmRange(this.PWMRange);
        this.channels.cwhiteLed.pwmRange(this.PWMRange);

        this.channels.redLed.pwmFrequency(this.PWMFrequency);
        this.channels.greenLed.pwmFrequency(this.PWMFrequency);
        this.channels.blueLed.pwmFrequency(this.PWMFrequency);
        this.channels.wwhiteLed.pwmFrequency(this.PWMFrequency);
        this.channels.cwhiteLed.pwmFrequency(this.PWMFrequency);

        this.api_tokens = null;

        this.schedule = null;
        this.crossbarsession = null;

        this.scheduleInterval = 0;
        this.clockInterval = 0;
        this.blinkInterval = 0;
        this.cycleInterval = 0;
    };
    _clearChannels() {
        this.channels.redLed.digitalWrite(0);
        this.channels.greenLed.digitalWrite(0);
        this.channels.blueLed.digitalWrite(0);
        this.channels.wwhiteLed.digitalWrite(0);
        this.channels.cwhiteLed.digitalWrite(0);

        this.channelValues.redLed = 0;
        this.channelValues.greenLed = 0;
        this.channelValues.blueLed = 0;
        this.channelValues.wwhiteLed = 0;
        this.channelValues.cwhiteLed = 0;
    };
    _clearInterval(interval) {
        if (interval instanceof Timer) {
            interval.clear();
        }
    };
    _startClock() {
        this.lcdcontroller.print('Time: ' + moment().format('HH:mm:ss'), 4);
        this.clockInterval = new Timer(() => {
            this.lcdcontroller.print('Time: ' + moment().format('HH:mm:ss'), 4);
            if (this.crossbarsession !== null) {
                this.crossbarsession.publish('eu.hoogstraaten.fishtank.time.' + this.crossbarsession.id, [moment()]);
            }
        }, 1000);
    };
    _stopClock() {
        this._clearInterval(this.clockInterval);
    };
    init() {
        this._clearChannels();
        this.lcdcontroller.lcd.clear();
        this.lcdcontroller.print(process.env.CLIENT_USER, 1);
    };
    cycleSchedule(speed) {
        this._clearInterval(this.scheduleInterval);
        this._stopClock();
        let start = moment("00:00", "HH:mm");
        this.cycleInterval = new Timer(() => {
            this.calculateLedValues(start.add(1, 'minutes'));
            if (this.crossbarsession !== null) {
                this.crossbarsession.publish('eu.hoogstraaten.fishtank.time.' + this.crossbarsession.id, [start]);
            }
        }, parseInt(speed));
    };
    calculateLedValues(time) {
        let factor = this.PWMRange / 100;
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
                    let maxdiff = secondentry.diff(firstentry, 'seconds');
                    let diff = time.diff(firstentry, 'seconds');
                    let percentage = (diff / maxdiff) * 100;
                    //console.log(firstentry, secondentry, maxdiff, diff, percentage);
                    //Calculate PWM level for each channel based on difference between level values of the two entries
                    //and percentage of the progress
                    for (let i in this.schedule.data.entries[index].colors) {
                        //console.log(i, parseInt(this.schedule.data.entries[index].colors[i]) !== parseInt(this.schedule.data.entries[index2].colors[i]));
                        if (parseInt(this.schedule.data.entries[index].colors[i]) !== parseInt(this.schedule.data.entries[index2].colors[i])) {
                            let powerdiff = parseInt(this.schedule.data.entries[index2].colors[i] * factor) - parseInt(this.schedule.data.entries[index].colors[i] * factor);
                            let ledpower = parseInt(this.schedule.data.entries[index].colors[i] * factor) + (Math.round(powerdiff * (percentage / 100)));
                            if (this.channelValues[i + 'Led'] !== ledpower) {
                                this.channels[i + 'Led'].pwmWrite(ledpower);
                                this.channelValues[i + 'Led'] = ledpower;
                            }
                        } else {
                            if (this.channelValues[i + 'Led'] !== parseInt(this.schedule.data.entries[index2].colors[i])) {
                                this.channels[i + 'Led'].pwmWrite(parseInt(this.schedule.data.entries[index2].colors[i] * factor));
                                this.channelValues[i + 'Led'] = parseInt(this.schedule.data.entries[index2].colors[i]);
                            }
                        }
                    }
                }
            }
        } else if (this.schedule.data.entries.length === 1) {
            for (let i in this.schedule.data.entries[0].colors) {
                if(this.channelValues[i + 'Led'] !== parseInt(this.schedule.data.entries[0].colors[i]) ) {
                    this.channels[i + 'Led'].pwmWrite(parseInt(this.schedule.data.entries[0].colors[i] * factor));
                    this.channelValues[i + 'Led'] = parseInt(this.schedule.data.entries[0].colors[i]);
                }
            }
        } else {

        }
    };
    loadSchedule(id) {
        this._clearInterval(this.scheduleInterval);
        this._clearInterval(this.cycleInterval);
        this._stopClock();
        this._startClock();

        this.apiCall('https://hoogstraaten.eu/api/schedule/' + id, 'get', null).then(data => {
            this.schedule = data;
            fs.writeFile("/opt/ledcontroller/schedule.json", JSON.stringify(this.schedule), function(err) {
                if(err) {
                    return console.log(err);
                }
            });
            this.lcdcontroller.print('Schedule: ' + this.schedule.data.name, 2);
            this._clearChannels();

            this.calculateLedValues(moment());
            this.scheduleInterval = new Timer(() => {
                this.calculateLedValues(moment());
            }, 1000);
        }).catch(error => {
            console.log(error);
            fs.readFile('/opt/ledcontroller/schedule.json', 'utf8').then(content => {
                console.log(content);
                this.schedule = JSON.parse(content);
            }).catch(error => console.log(error));
            this.lcdcontroller.print('Schedule: ' + this.schedule.data.name, 2);
            this.calculateLedValues(moment());
            this.scheduleInterval = new Timer(() => {
                this.calculateLedValues(moment());
            }, 1000);
        });
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
                //console.log(error);
                return Promise.reject(error);
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
                //console.log(error);
                return Promise.reject(error);
            }
        } else {
            try {
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
                //console.log(error);
                return Promise.reject(error);
            }
        }
    };
}

function onchallenge (session, method, extra) {
    if (method === "wampcra") {
        return autobahn.auth_cra.sign(process.env.CLIENT_KEY, extra.challenge);
    } else {
        throw "don't know how to authenticate using '" + method + "'";
    }
};

let LCDControl = new LCDController(new LCD(1, 0x3f, 20, 4 ));
let LedControl = new LedController(LCDControl);
LedControl.init();

//Load schedule from last known schedule's id
fs.readFile('/opt/ledcontroller/schedule.json', 'utf8').then(content => {
    LedControl.schedule = JSON.parse(content);
    LedControl.loadSchedule(LedControl.schedule.data.id);
}).catch(error => console.log(error));

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
    LCDControl.print('Status: Online', 3);
    //Subscribe to topic for notification about updated schedules
    function onevent(args) {
        var data = args[0];
        //If updated schedule has the same id as our loaded schedule then retreive it's updated content from the API
        if(LedControl.schedule.data.id === data.schedule_id) {
            LedControl.loadSchedule(data.schedule_id);
        }

    }
    session.subscribe('eu.hoogstraaten.fishtank.publish', onevent);

    //Register procedure for setting a new schedule
    function setSchedule(args) {
        try {
            console.log(args[0]);
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
    LCDControl.print('Status: Online', 3);
    LedControl.crossbarsession = null;
    console.log("Connection lost:", reason, details);
};

//Start crossbar
connection.open();
