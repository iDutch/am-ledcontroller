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

var pinvaulues = {
    "redPin": 0,
    "greenPin": 0,
    "bluePin": 0,
    "warmwhitePin": 0,
    "coldwhitePin": 0
};

wpi.setup('wpi');

wpi.pinMode(pins.redPin, wpi.SOFT_PWM_OUTPUT);
wpi.pinMode(pins.greenPin, wpi.SOFT_PWM_OUTPUT);
wpi.pinMode(pins.bluePin, wpi.SOFT_PWM_OUTPUT);
wpi.pinMode(pins.warmwhitePin, wpi.SOFT_PWM_OUTPUT);
wpi.pinMode(pins.coldwhitePin, wpi.SOFT_PWM_OUTPUT);

wpi.softPwmWrite(pins.redPin, 0);
wpi.softPwmWrite(pins.greenPin, 0);
wpi.softPwmWrite(pins.bluePin, 0);
wpi.softPwmWrite(pins.warmwhitePin, 0);
wpi.softPwmWrite(pins.coldwhitePin, 0);

var user = process.env.CLIENT_USER;
var key = process.env.CLIENT_KEY;
var api_tokens = null;

const oauth_data = {
    "grant_type": process.env.USER_GRANT_TYPE,
    "client_id": process.env.CLIENT_ID,
    "client_secret": process.env.CLIENT_SECRET,
    "username": process.env.USER_EMAIL,
    "password": process.env.USER_PASSWORD,
    "scope": process.env.SCOPE_INT
};

function api_call(url, method, data) {
    return new Promise(function(resolve, reject) {
        if (api_tokens === null) {
            axios.post(
                'https://hoogstraaten.eu/oauth/token', oauth_data, {
                    headers: {
                        'content-type': 'application/json'
                    }
                })
                .then(function (response) {
                    api_tokens = response.data;
                    api_tokens.renew_on = moment().add(response.data.expires_in, 'seconds');

                    axios({
                        method: method,
                        url: url,
                        data: data,
                        headers: {
                            'authorization': 'Bearer '.concat(api_tokens.access_token),
                            'content-type': 'application/json'
                        }
                    }).then(function (response) {
                        resolve(response.data);
                    }).catch(function (error) {
                        reject(error);
                    });
                })
                .catch(function (error) {
                    reject(error);
                });
        } else if (api_tokens.renew_on < moment()) {
            axios.post(
                'https://hoogstraaten.eu/oauth/token', {
                    "grant_type": 'refresh_token',
                    "refresh_token": api_tokens.refresh_token,
                    "client_id": process.env.CLIENT_ID,
                    "client_secret": process.env.CLIENT_SECRET,
                    "scope": process.env.SCOPE_INT
                },
                {
                    headers: {
                        'content-type': 'application/json'
                    }
                })
                .then(function (response) {
                    api_tokens = response;
                    api_tokens.renew_on = moment().add(response.expires_in, 'seconds');

                    axios({
                        method: method,
                        url: url,
                        data: data,
                        headers: {
                            'authorization': 'Bearer '.concat(api_tokens.access_token),
                            'content-type': 'application/json'
                        }
                    }).then(function (response) {
                        resolve(response.data);
                    }).catch(function (error) {
                        reject(error);
                    });
                })
                .catch(function (error) {
                    reject(error);
                });
        } else {
            axios({
                method: method,
                url: url,
                data: data,
                headers: {
                    'authorization': 'Bearer '.concat(api_tokens.access_token),
                    'content-type': 'application/json'
                }
            }).then(function (response) {
                resolve(response.data);
            }).catch(function (error) {
                reject(error);
            });
        }
    });
}

var scheduleInterval, clockInterval = null;
var schedule = null;

function onchallenge (session, method, extra) {
    //console.log("onchallenge", method, extra);
    if (method === "wampcra") {
        return autobahn.auth_cra.sign(key, extra.challenge);
    } else {
        throw "don't know how to authenticate using '" + method + "'";
    }
}

function loadSchedule(id) {
    clearInterval(scheduleInterval);
    api_call('https://hoogstraaten.eu/api/schedule/' + id, 'get', null)
        .then(function (response) {
            schedule = response.data;
            fs.writeFile("/etc/systemd/system/RGBController/schedule.json", JSON.stringify(response.data), function(err) {
                if(err) {
                    return console.log(err);
                }
                //console.log("The file was saved!");
            });
            calculateSchedule(schedule, moment());
            scheduleInterval = setInterval(function () {
                calculateSchedule(schedule, moment());
            }, 60000);
        })
        .catch(function (error) {
            fs.readFile('/etc/systemd/system/RGBController/schedule.json', 'utf8', function (err,data) {
                if (err) {
                    return console.log(err);
                }
                schedule = JSON.parse(data);
                calculateSchedule(schedule, moment());
                scheduleInterval = setInterval(function () {
                    calculateSchedule(schedule, moment());
                }, 60000);
            });
        });
}

/**
 * Calculate the interpolation of loaded schedule
 *
 * @param schedule
 * @param currenttime
 */
function calculateSchedule(schedule, currenttime) {
    var max = schedule.entries.length - 1;
    for (var index in schedule.entries) {
        var index2 = parseInt(index) + 1;
        var first = moment(schedule.entries[index].time, 'HH:mm');
        //If last index then compare it with the first one
        if (index == max) {
            index2 = 0;
            var second = moment(schedule.entries[index2].time, 'HH:mm').add(1, 'days');
        } else {
            var second = moment(schedule.entries[index2].time, 'HH:mm');
        }
        //Get the two schedule entries where the current time is in between.
        if(currenttime.isBetween(first, second, 'minutes', '[)')){
            //Determine maxdiff and currentdiff to calculate the percentage
            //of how far the progression is between the two entries
            var maxdiff = second.diff(first, 'minutes');
            var currentdiff = currenttime.diff(first, 'minutes');
            var percentage = (currentdiff / maxdiff) * 100;
            //console.log(first, second, maxdiff, currentdiff, percentage, schedule[index2]);
            //Calculate PWM level for each channel based on difference between level values of the two entries
            //and percentage of the progress
            for (var i in schedule.entries[index].colors) {
                if (parseInt(schedule.entries[index].colors[i]) !== parseInt(schedule.entries[index2].colors[i])) {
                    var powerdiff =  parseInt(schedule.entries[index2].colors[i]) - parseInt(schedule.entries[index].colors[i]);
                    var ledpower = parseInt(schedule.entries[index].colors[i]) + (Math.round(powerdiff * (percentage / 100)));
                    if(pinvaulues[i + 'Pin'] !== ledpower) {
                        wpi.softPwmWrite(pins[i + 'Pin'], ledpower);
                        pinvaulues[i + 'Pin'] = ledpower;
                    }
                } else {
                    if(pinvaulues[i + 'Pin'] !== parseInt(schedule.entries[index2].colors[i])) {
                        wpi.softPwmWrite(pins[i + 'Pin'], parseInt(schedule.entries[index2].colors[i]));
                        pinvaulues[i + 'Pin'] = parseInt(schedule.entries[index2].colors[i]);
                    }
                }
            }
        }
    }
}

var connection = new autobahn.Connection({
    url: 'wss://cb.hoogstraaten.eu/ws',
    realm: 'eu.hoogstraaten.fishtank',
    authid: user,
    authmethods: ["wampcra"],
    onchallenge: onchallenge
});

connection.onopen = function (session) {
    //Subscribe to topic for notification about updated schedules
    function onevent(args) {
        var data = args[0];
        if(schedule.id === data.schedule_id) {
            loadSchedule(data.schedule_id);
        }

    }
    session.subscribe('eu.hoogstraaten.fishtank.publish', onevent);

    //Register a procedure for setting a new schedule
    function setSchedule(args) {
        loadSchedule(args[0]);
    }
    session.register('eu.hoogstraaten.fishtank.' + session.id + '.setschedule', setSchedule);

    clockInterval = setInterval(function () {
        session.publish('eu.hoogstraaten.fishtank.time.' + session.id, [moment()]);
    }, 1000);

    console.log('Client connected to cb.hoogstraaten.eu!');
};

connection.onclose = function (reason, details) {
    console.log("Connection lost:", reason, details);
}

loadSchedule(1);
connection.open();
